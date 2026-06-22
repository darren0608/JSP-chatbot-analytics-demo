/**
 * run.js — fast, deterministic regression suite. `npm test` runs this; it exits
 * non-zero on any failure. No live network or credentials: every external
 * service is mocked (tests/mocks.js) inside a fresh vm sandbox per test.
 */

process.env.TZ = 'UTC'; // deterministic date math regardless of host TZ
const fs = require('fs');
const path = require('path');
const { loadApp, setProps, seedSheet, FIXED_NOW } = require('./harness');

// ---- micro test framework --------------------------------------------------
let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; failures.push({ name, e }); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(v, m) { assert(!!v, m); }
function throws(fn, m) { let t = false; try { fn(); } catch (e) { t = true; } assert(t, m || 'expected throw'); }

// date helper aligned with the app's UTC clock
function dAt(offset, h, m) {
  const base = new Date(FIXED_NOW); base.setHours(0, 0, 0, 0);
  const d = new Date(base.getTime() + offset * 86400000); d.setHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}

// ===========================================================================
// Rendering & state
// ===========================================================================
test('zero credentials → renders full mock dataset, mode = mock', () => {
  const { ctx } = loadApp();
  const st = ctx.getDashboardState();
  eq(st.mode, 'mock');
  ok(st.sections.tasks.data.items.length > 0, 'tasks present');
  ok(st.sections.finances.data.holdings.length > 0, 'holdings present');
  ok(st.home.summary.length > 0, 'home summary present');
});

test('creds present but source empty → stays live, empty, no mock fallback', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 'sheet1' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, []); // configured but empty
  });
  const st = ctx.getDashboardState();
  eq(st.sources.tasks, 'live');
  eq(st.sections.tasks.data.items.length, 0, 'live empty, not mock');
  eq(st.mode, 'live');
});

test('a throwing source degrades to a warning, others intact', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 'sheet1', TICKTICK_ACCESS_TOKEN: 'tok' });
    store.fetch = () => ({ code: 500, body: 'boom' }); // TickTick errors
  });
  const st = ctx.getDashboardState();
  eq(st.sources.tasks, 'degraded');
  ok(st.warnings.length >= 1, 'has warning');
  ok(st.sections.finances.data.summary, 'finances still intact');
  eq(st.mode, 'degraded');
});

test('server entrypoint that throws still returns a valid object', () => {
  const { ctx } = loadApp((c, store) => { setProps(store, { SHEET_ID: 'sheet1' }); seedSheet(store, 'tasks', c.TASK_HEADERS, []); });
  const res = ctx.apiAddTask(''); // empty title throws inside addTask
  eq(typeof res, 'object');
  eq(res.ok, false);
  ok(res.error, 'error message present');
});

// ===========================================================================
// Tasks
// ===========================================================================
function sheetApp() {
  return loadApp((c, store) => { setProps(store, { SHEET_ID: 's' }); seedSheet(store, 'tasks', c.TASK_HEADERS, []); });
}

test('sheet task: add / complete / reopen / soft-delete lifecycle', () => {
  const { ctx } = sheetApp();
  const add = ctx.addTask('Pay rent');
  eq(add.status, 'open');
  const id = add.task.id;
  eq(ctx.getTasksSection().data.items.length, 1);
  eq(ctx.completeTask(id, 'sheet').status, 'done');
  eq(ctx.getTasksSection().data.items.length, 0, 'done hidden from open list');
  eq(ctx.reopenTask(id, 'sheet').status, 'open');
  eq(ctx.getTasksSection().data.items.length, 1);
  eq(ctx.softDeleteTask(id, 'sheet').status, 'deleted');
  eq(ctx.getTasksSection().data.items.length, 0);
});

test('TickTick task appears in merged list', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', TICKTICK_ACCESS_TOKEN: 'tok' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, []);
    store.fetch = (url) => {
      if (/\/project$/.test(url)) return { code: 200, body: JSON.stringify([{ id: 'p1' }]) };
      if (/\/project\/p1\/data/.test(url)) return { code: 200, body: JSON.stringify({ tasks: [{ id: 'tt1', title: 'TT task' }] }) };
      return { code: 200, body: '{}' };
    };
  });
  const items = ctx.getTasksSection().data.items;
  ok(items.some(t => t.id === 'tt1' && t.source === 'ticktick'), 'ticktick task merged');
});

test('REGRESSION: complete a TickTick task then delete it → no error, status deleted', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', TICKTICK_ACCESS_TOKEN: 'tok' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, []);
    // TickTick no longer lists the (now completed) task — feed is empty.
    store.fetch = (url) => {
      if (/\/project$/.test(url)) return { code: 200, body: JSON.stringify([{ id: 'p1' }]) };
      if (/\/project\/p1\/data/.test(url)) return { code: 200, body: JSON.stringify({ tasks: [] }) };
      return { code: 200, body: '{}' };
    };
  });
  eq(ctx.completeTask('ttX', 'ticktick').status, 'done');
  const del = ctx.softDeleteTask('ttX', 'ticktick'); // must not throw
  eq(del.status, 'deleted');
});

test('soft-delete keeps the row + writes an audit entry (never hard-deletes)', () => {
  const { ctx, store } = sheetApp();
  const id = ctx.addTask('Keepable').task.id;
  ctx.softDeleteTask(id, 'sheet');
  eq(ctx.storeReadAll(ctx.TASKS_TAB, ctx.TASK_HEADERS).length, 1, 'row still present');
  const audit = ctx.readAuditLog();
  ok(audit.some(a => a.action === 'task.delete'), 'audit row written');
});

test('concurrency: two writes both land + lock honoured', () => {
  const { ctx, store } = sheetApp();
  ctx.addTask('One'); ctx.addTask('Two');
  eq(ctx.storeReadAll(ctx.TASKS_TAB, ctx.TASK_HEADERS).length, 2, 'no overwrite');
  ok(store.lockAcquired >= 2, 'LockService used per write');
});

// ===========================================================================
// Time / timeline
// ===========================================================================
test('calendar + timed tasks merge chronologically; overdue flagged', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', CALENDAR_PERSONAL_IDS: 'personal@x' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, [
      { id: 't1', title: 'Morning task', source: 'sheet', due: dAt(0, 9, 30), status: 'open', updated_at: dAt(-1) },
      { id: 't2', title: 'Late task', source: 'sheet', due: dAt(-1, 9, 0), status: 'open', updated_at: dAt(-2) }
    ]);
    store.calendars['personal@x'] = [{ id: 'e1', title: 'Dentist', start: dAt(0, 14, 0), end: dAt(0, 15, 0) }];
  });
  const tl = ctx.getTimeSection().data.timeline;
  for (let i = 1; i < tl.length; i++) ok(tl[i - 1].start <= tl[i].start, 'sorted ascending');
  ok(tl.some(it => it.overdue === true), 'an overdue item is flagged');
});

test('work/gov calendar contributes ONLY "Busy" — no title leak', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', CALENDAR_PERSONAL_IDS: 'personal@x', CALENDAR_BUSY_IDS: 'work@gov' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, []);
    store.calendars['personal@x'] = [];
    store.calendars['work@gov'] = [{ id: 'w1', title: 'TOP SECRET CABINET MEETING', start: dAt(1, 10, 0), end: dAt(1, 11, 0) }];
  });
  const tl = ctx.getTimeSection().data.timeline;
  const busy = tl.filter(it => it.owned === false);
  ok(busy.length === 1 && busy[0].title === 'Busy', 'rendered as Busy');
  ok(!tl.some(it => /SECRET/i.test(it.title)), 'no title leaked');
});

test('untimed tasks land in follow-ups, sorted by age', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, [
      { id: 'a', title: 'Newer', source: 'sheet', due: '', status: 'open', updated_at: dAt(-1) },
      { id: 'b', title: 'Older', source: 'sheet', due: '', status: 'open', updated_at: dAt(-5) }
    ]);
  });
  const fu = ctx.getTimeSection().data.followUps;
  eq(fu.length, 2);
  eq(fu[0].title, 'Older', 'oldest first');
});

// ===========================================================================
// Finances
// ===========================================================================
test('summary cards compute; SRS remaining = cap − balance', () => {
  const { ctx } = loadApp(); // mock
  const s = ctx.getFinancesSection().data.summary;
  eq(s.srs_balance.value, 8200);
  eq(s.srs_topup_remaining.value, 15300 - 8200);
  eq(s.cpf_total.value, 142300);
  ok(s.total_portfolio_value.value > 0, 'total computed');
});

test('IBKR refresh: replaces only IBKR rows, preserves manual rows, audits', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', IBKR_FLEX_TOKEN: 'tok', IBKR_FLEX_QUERY_ID: 'q1' });
    seedSheet(store, 'holdings', c.HOLDING_HEADERS, [
      { account: 'CPF', instrument: 'CPF', type: 'Retirement', units: 1, current_value: 100000, currency: 'SGD' },
      { account: 'IBKR', instrument: 'OLD', type: 'Stock', units: 1, current_value: 1, currency: 'USD' }
    ]);
    store.fetch = (url) => {
      if (/SendRequest/.test(url)) return { code: 200, body: '<FlexStatementResponse><Status>Success</Status><ReferenceCode>REF1</ReferenceCode><Url>https://x/GetStatement</Url></FlexStatementResponse>' };
      return { code: 200, body: '<FlexQueryResponse><OpenPositions><OpenPosition accountId="U1" symbol="AAPL" assetCategory="STK" position="10" costBasisPrice="150" positionValue="2000" currency="USD" /></OpenPositions></FlexQueryResponse>' };
    };
  });
  const res = ctx.refreshIbkr();
  eq(res.ok, true);
  const holdings = ctx.storeReadAll(ctx.HOLDINGS_TAB, ctx.HOLDING_HEADERS);
  ok(holdings.some(h => h.account === 'CPF'), 'CPF preserved');
  ok(holdings.some(h => h.instrument === 'AAPL'), 'IBKR row inserted');
  ok(!holdings.some(h => h.instrument === 'OLD'), 'old IBKR row replaced');
  ok(ctx.readAuditLog().some(a => a.action === 'ibkr.refresh'), 'audited');
});

test('overlapping IBKR refresh returns a friendly busy message', () => {
  const { ctx } = loadApp((c, store) => {
    // A fresh in-progress timestamp blocks a concurrent run.
    setProps(store, { SHEET_ID: 's', IBKR_FLEX_TOKEN: 't', IBKR_FLEX_QUERY_ID: 'q', IBKR_REFRESH_INPROGRESS: String(FIXED_NOW) });
  });
  const res = ctx.refreshIbkr();
  eq(res.ok, false); ok(res.busy === true, 'flagged busy'); ok(/already running/i.test(res.message));
});

test('stale IBKR in-progress flag does NOT block a new refresh', () => {
  const { ctx } = loadApp((c, store) => {
    // Timestamp from ~10 min ago → treated as a dead run, not "busy".
    setProps(store, { SHEET_ID: 's', IBKR_FLEX_TOKEN: 't', IBKR_FLEX_QUERY_ID: 'q', IBKR_REFRESH_INPROGRESS: String(FIXED_NOW - 10 * 60 * 1000) });
    seedSheet(store, 'holdings', c.HOLDING_HEADERS, []);
    store.fetch = (url) => /SendRequest/.test(url)
      ? { code: 200, body: '<x><Status>Success</Status><ReferenceCode>R</ReferenceCode><Url>https://x/GetStatement</Url></x>' }
      : { code: 200, body: '<FlexQueryResponse><OpenPositions><OpenPosition symbol="VOO" assetCategory="ETF" position="1" costBasisPrice="1" positionValue="1" currency="USD"/></OpenPositions></FlexQueryResponse>' };
  });
  eq(ctx.refreshIbkr().ok, true, 'stale lock cleared');
});

test('missing IBKR creds → plain-language error, not a stack trace', () => {
  const { ctx } = loadApp();
  const res = ctx.refreshIbkr();
  eq(res.ok, false); ok(/IBKR not connected/i.test(res.message));
});

// ===========================================================================
// Telegram bot
// ===========================================================================
function tgApp(seedExtra) {
  return loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', TELEGRAM_BOT_TOKEN: 'bt', TELEGRAM_CHAT_ID: '999', TELEGRAM_URL_SECRET: 'shh' });
    seedSheet(store, 'tasks', c.TASK_HEADERS, [{ id: 'r1', title: 'Pay rent', source: 'sheet', due: dAt(2), status: 'open', updated_at: dAt(-1) }]);
    store.fetch = (url) => ({ code: 200, body: '{}' });
    if (seedExtra) seedExtra(c, store);
  });
}

test('rejects non-whitelisted chat_id and bad URL secret', () => {
  const { ctx } = tgApp();
  eq(ctx.handleIncoming('111', 'today').rejected, true);
  eq(ctx.telegramWebhook({ parameter: { secret: 'wrong' }, postData: { contents: '{}' } }).ok, false);
});

test('update_id dedup: a repeated update is ignored', () => {
  const { ctx } = tgApp((c, store) => {
    store.fetch = (url) => {
      if (/getUpdates/.test(url)) return { code: 200, body: JSON.stringify({ result: [{ update_id: 7, message: { chat: { id: 999 }, text: 'today' } }] }) };
      return { code: 200, body: '{}' };
    };
  });
  eq(ctx.telegramPoll().processed, 1);
  eq(ctx.telegramPoll().processed, 0, 'same update_id not reprocessed');
  eq(Number(ctx.cfgGet('TELEGRAM_LAST_UPDATE_ID')), 7, 'offset advanced');
});

test('NL parse → structured command (regex fallback when no AI)', () => {
  const { ctx } = loadApp();
  const c = ctx.parseCommand('add task Buy milk due tomorrow');
  eq(c.action, 'add_task'); eq(c.params.title, 'Buy milk'); ok(c.params.due, 'due parsed');
  eq(ctx.parseCommand('overdue').target, 'overdue');
});

test('AI parser failure falls back to regex', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { GCP_PROJECT_ID: 'proj' });          // AI "configured"
    store.fetch = () => ({ code: 500, body: 'vertex down' }); // but failing
  });
  const c = ctx.parseCommand('tasks');
  eq(c.action, 'query'); eq(c.target, 'tasks'); eq(c.source, 'regex');
});

test('destructive action requires yes/no; "no" cancels with no write', () => {
  const { ctx } = tgApp();
  const r1 = ctx.handleIncoming('999', 'delete Pay rent');
  eq(r1.kind, 'confirm');
  ctx.handleIncoming('999', 'no');
  ok(ctx.listOpenTasks().some(t => t.title === 'Pay rent'), 'task untouched after no');
});

test('destructive action: "yes" executes after confirm', () => {
  const { ctx } = tgApp();
  ctx.handleIncoming('999', 'delete Pay rent');
  ctx.handleIncoming('999', 'yes');
  ok(!ctx.listOpenTasks().some(t => t.title === 'Pay rent'), 'task deleted after yes');
});

test('unknown input → clarifying question, never a guessed action', () => {
  const { ctx } = tgApp();
  const r = ctx.handleIncoming('999', 'asdf qwerty zzz');
  eq(r.kind, 'clarify');
  ok(!ctx.cfgGet('TELEGRAM_PENDING'), 'no pending destructive action queued');
});

test('query handlers each return sensible text', () => {
  const { ctx } = loadApp();
  ['today', 'tomorrow', 'week', 'overdue', 'tasks', 'birthdays', 'portfolio', 'srs', 'cpf', 'dividends', 'bills', 'habits'].forEach(t => {
    const txt = ctx.answerQuery(t);
    ok(typeof txt === 'string' && txt.length > 0, 'answer for ' + t);
  });
});

// ===========================================================================
// New modules
// ===========================================================================
test('habits: check-off toggles + streak math', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's' });
    seedSheet(store, 'habits', c.HABIT_HEADERS, [
      { id: 'h1', title: 'Run', cadence: 'daily', target_per_week: 5, checkins: dAt(-1) + ',' + dAt(-2), updated_at: dAt(-1) }
    ]);
  });
  eq(ctx.getHabitsSection().data.items[0].streak, 2, 'streak holds via yesterday');
  const r = ctx.checkInHabit('h1');
  eq(r.done_today, true);
  eq(ctx.getHabitsSection().data.items[0].streak, 3, 'today extends streak');
  ctx.checkInHabit('h1'); // toggle off
  eq(ctx.getHabitsSection().data.items[0].done_today, false);
});

test('bills: next due rolls forward + totals computed', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's' });
    seedSheet(store, 'bills', c.BILL_HEADERS, [
      { id: 'b1', name: 'Rent', amount: 2000, currency: 'SGD', cadence: 'monthly', next_due: dAt(-10), category: 'Housing', updated_at: dAt(-30) }
    ]);
  });
  const d = ctx.getBillsSection().data;
  ok(d.items[0].days_until >= 0, 'past due rolled forward');
  ok(d.monthly_total >= 2000, 'monthly total includes rent');
  ok(d.annual_total >= 24000, 'annual total amortised');
});

test('countdowns: days_until math + ascending sort', () => {
  const { ctx } = loadApp();
  const items = ctx.getCountdownsSection().data.items;
  for (let i = 1; i < items.length; i++) ok(items[i - 1].days_until <= items[i].days_until, 'sorted by soonest');
  ok(items.every(c => c.days_until >= 0), 'no past dates');
});

test('goals: progress = current / target', () => {
  const { ctx } = loadApp();
  const g = ctx.getGoalsSection().data.items.find(x => x.title === 'Emergency fund');
  ok(Math.abs(g.progress - 19500 / 30000) < 1e-9, 'progress computed');
});

test('quick-capture routing: task / note / query / confirm', () => {
  const { ctx } = loadApp((c, store) => { setProps(store, { SHEET_ID: 's' }); seedSheet(store, 'tasks', c.TASK_HEADERS, []); seedSheet(store, 'notes', c.NOTE_HEADERS, []); });
  eq(ctx.quickCapture('add task Foo').kind, 'task');
  eq(ctx.quickCapture('note: remember the milk').kind, 'note');
  eq(ctx.quickCapture('portfolio').kind, 'query');
  eq(ctx.quickCapture('delete Foo').kind, 'confirm'); // execute defaults off
});

// ===========================================================================
// Caching / cost controls
// ===========================================================================
test('briefing is cached — AI is not called on every dashboard build', () => {
  const { ctx, store } = loadApp((c, s) => {
    setProps(s, { GCP_PROJECT_ID: 'proj' });
    s.fetch = (url) => /aiplatform/.test(url)
      ? { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A calm day ahead.' }] } }] }) }
      : { code: 200, body: '{}' };
  });
  ctx.buildBriefing();
  ctx.buildBriefing();
  const vertexCalls = store.fetchLog.filter(f => /aiplatform/.test(f.url)).length;
  eq(vertexCalls, 1, 'second build served from cache');
});

test('a write busts the dashboard-state cache (fresh after mutation)', () => {
  const { ctx } = loadApp((c, store) => { setProps(store, { SHEET_ID: 's' }); seedSheet(store, 'tasks', c.TASK_HEADERS, []); });
  eq(ctx.getDashboardState().sections.tasks.data.items.length, 0); // populates cache
  ctx.addTask('New thing');                                        // busts cache
  eq(ctx.getDashboardState().sections.tasks.data.items.length, 1, 'reflects the write');
});

test('free-text inputs are length-guarded', () => {
  const { ctx } = sheetApp();
  throws(() => ctx.addTask('x'.repeat(5000)), 'over-long title rejected');
});

// ===========================================================================
// Meta
// ===========================================================================
test('manifest is valid (V8 runtime, scopes, webapp config)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'));
  eq(m.runtimeVersion, 'V8');
  ok(m.oauthScopes.indexOf('https://www.googleapis.com/auth/cloud-platform') >= 0, 'cloud-platform scope present');
  ok(m.webapp && m.webapp.access, 'webapp config present');
});

test('diagnose() returns structured per-integration status', () => {
  const { ctx } = loadApp((c, store) => {
    setProps(store, { SHEET_ID: 's', TELEGRAM_BOT_TOKEN: 'bt', TELEGRAM_CHAT_ID: '1' });
    store.fetch = (url) => /getMe/.test(url) ? { code: 200, body: '{"ok":true}' } : { code: 200, body: '{}' };
  });
  const rep = ctx.diagnose();
  ok(Array.isArray(rep.integrations) && rep.integrations.length >= 5, 'all integrations reported');
  rep.integrations.forEach(i => { ok(i.key && i.status, 'structured entry'); });
  ok(rep.integrations.find(i => i.key === 'telegram').status === 'ok', 'telegram live-tested ok');
  ok(rep.integrations.find(i => i.key === 'ai').status === 'not_configured', 'unconfigured flagged');
  ok(/integrations OK/.test(rep.summary), 'summary text');
});

// ===========================================================================
// Report
// ===========================================================================
console.log('\n  Life Dashboard — regression suite');
console.log('  ' + '-'.repeat(40));
if (failures.length) {
  failures.forEach(f => {
    console.log('  ✗ ' + f.name);
    console.log('      ' + (f.e && f.e.message ? f.e.message : f.e));
  });
}
console.log('\n  ' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)\n');
process.exit(failed ? 1 : 0);
