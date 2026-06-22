/**
 * Code.gs — web entrypoints + state assembly.
 *
 * doGet serves the templated dashboard HTML. doPost is a JSON router for edit
 * actions and NEVER throws (an uncaught throw makes Apps Script 302-redirect,
 * breaking JSON callers). getDashboardState() assembles every section in its
 * own try/catch so one failing source degrades to a warning chip while the rest
 * of the page stays intact — and keeps the last good state per section.
 *
 * Client bridge note: the sandboxed HTML talks to the server ONLY via
 * google.script.run (it cannot fetch its own doPost). Every client-callable
 * here returns a valid object even on failure, so a bad response never wipes
 * the previous good state (we also null-guard on the client).
 */

// --- Web app entrypoints ----------------------------------------------------
function doGet(e) {
  var tpl = HtmlService.createTemplateFromFile('dashboard');
  tpl.bootState = JSON.stringify(getDashboardState());
  // Default (SAMEORIGIN) X-Frame protection — a private personal dashboard has
  // no reason to be embeddable cross-origin (avoids clickjacking).
  return tpl.evaluate()
    .setTitle('Life Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// JSON router for any external/webhook caller. Wrapped so it can never throw.
function doPost(e) {
  var out;
  try {
    var body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
    var action = body.action || (e && e.parameter && e.parameter.action);
    if (action === 'telegram_webhook') out = telegramWebhook(e);
    else out = { ok: false, error: 'unknown action' };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out || { ok: false })).setMimeType(ContentService.MimeType.JSON);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// --- Last-good cache (per section) ------------------------------------------
function getLastGood(name) {
  var raw = cfgGet('LASTGOOD_' + name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function setLastGood(name, data) {
  tryOr(null, function () { cfgSet('LASTGOOD_' + name, JSON.stringify(data)); });
}

// Build one section: live/mock on success, degraded (last-good or fallback) on
// throw. Never lets one source blank the page or flip the whole app to mock.
function buildSection(name, fn, emptyFallback) {
  var r = tryOr(null, fn);
  if (r.ok && r.value) {
    setLastGood(name, r.value.data);
    return { source: r.value.live ? 'live' : 'mock', data: r.value.data };
  }
  var cached = getLastGood(name);
  return { source: 'degraded', warning: r.error || 'unavailable', data: cached !== null ? cached : emptyFallback };
}

// --- Full dashboard state ---------------------------------------------------
// Cached briefly (CacheService) so repeated page loads / refreshes don't re-hit
// Calendar, TickTick and Vertex AI. Mutations bust the cache via auditLog.
function getDashboardState() {
  clearExecMemo();
  return cached('dash_state', 30, _buildDashboardState);
}

function _buildDashboardState() {
  var sections = {
    time:       buildSection('time', getTimeSection, { timeline: [], followUps: [] }),
    tasks:      buildSection('tasks', getTasksSection, { items: [] }),
    finances:   buildSection('finances', getFinancesSection, { summary: {}, holdings: [], dividends: [] }),
    habits:     buildSection('habits', getHabitsSection, { items: [] }),
    bills:      buildSection('bills', getBillsSection, { items: [], monthly_total: 0, annual_total: 0, next_bill: null }),
    goals:      buildSection('goals', getGoalsSection, { items: [] }),
    notes:      buildSection('notes', getNotesSection, { items: [] }),
    countdowns: buildSection('countdowns', getCountdownsSection, { items: [] })
  };

  var sourceMap = {}, warnings = [];
  Object.keys(sections).forEach(function (k) {
    sourceMap[k] = sections[k].source;
    if (sections[k].warning) warnings.push({ section: k, message: sections[k].warning });
  });

  var mode = _resolveMode(sourceMap);
  var home = _buildHome(sections);

  return {
    mode: mode,
    generatedAt: now().toISOString(),
    sources: sourceMap,
    warnings: warnings,
    settings: getSettings(),
    home: home,
    sections: sections
  };
}

function _resolveMode(sourceMap) {
  var vals = Object.keys(sourceMap).map(function (k) { return sourceMap[k]; });
  if (vals.indexOf('degraded') >= 0) return 'degraded';
  if (vals.every(function (v) { return v === 'mock'; })) return 'mock';
  return 'live';
}

// Home / command center: the 5 things checked daily, above the tabs.
function _buildHome(sections) {
  var tasks = sections.tasks.data.items || [];
  var overdue = tasks.filter(function (t) { return t.overdue; });
  var timeline = (sections.time.data.timeline || []);
  var today = timeline.filter(function (it) { return isSameDay(it.start, now()); });
  var briefing = tryOr({ text: '', facts: {} }, buildBriefing).value;

  return {
    greeting: _greeting(),
    date: now().toISOString(),
    summary: briefing.text,
    todayAgenda: today,
    topTasks: tasks.slice(0, 3),
    overdueCount: overdue.length,
    nextBill: sections.bills.data.next_bill || null,
    habits: sections.habits.data.items || [],
    countdowns: (sections.countdowns.data.items || []).slice(0, 3)
  };
}

// --- Client-callable action wrappers (always return a valid object) ---------
// google.script.run delivers null to the success handler if a server fn throws,
// so we wrap each so the client always gets {ok:...} and never a null wipe.
function _safe(fn) {
  try { var v = fn(); return v && typeof v === 'object' ? v : { ok: true, value: v }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function apiAddTask(title, opts)            { return _safe(function () { return addTask(title, opts); }); }
function apiCompleteTask(id, source)        { return _safe(function () { return completeTask(id, source); }); }
function apiReopenTask(id, source)          { return _safe(function () { return reopenTask(id, source); }); }
function apiDeleteTask(id, source)          { return _safe(function () { return softDeleteTask(id, source); }); }
function apiQuickCapture(text)              { return _safe(function () { return quickCapture(text, { actor: 'dashboard', execute: true }); }); }
function apiCheckInHabit(id)                { return _safe(function () { return checkInHabit(id); }); }
function apiRefreshIbkr()                   { return _safe(function () { return refreshIbkr(); }); }
function apiSearch(q)                       { return _safe(function () { return globalSearch(q); }); }
function apiSaveSetting(key, value)         { return _safe(function () { return saveSetting(key, value); }); }
function apiDiagnose()                      { return _safe(function () { return diagnose(); }); }
function apiGetState()                      { return _safe(function () { return getDashboardState(); }); }
