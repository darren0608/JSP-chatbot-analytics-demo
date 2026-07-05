/**
 * build-preview.js — bundles the Apps Script project into a single standalone
 * HTML that runs entirely in the browser. It reuses the SAME Google-service
 * mocks as the tests, seeds them with the mock dataset, and shims
 * google.script.run so every action (add/complete/delete, habit check-in, IBKR
 * refresh, search, settings) works live — no server, no credentials.
 *
 * Output: preview/index.html   (open it in any browser)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const { FILES } = require('../tests/harness');

// 1. App source (all .gs concatenated, manifest/html excluded)
const appSrc = FILES.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');

// 2. Browser-side mocks (reuse tests/mocks.js, minus the Node export line)
const mocksSrc = fs.readFileSync(path.join(__dirname, '..', 'tests', 'mocks.js'), 'utf8')
  .replace(/module\.exports[\s\S]*$/, '');

// 3. Seeding + google.script.run shim (runs in the browser after app source)
const API_NAMES = ['apiAddTask','apiCompleteTask','apiReopenTask','apiDeleteTask','apiQuickCapture','apiCheckInHabit','apiRefreshIbkr','apiSearch','apiSaveSetting','apiDiagnose','apiGetState'];
const glue = `
/* ---- instantiate mocks as globals (mirrors the Apps Script runtime) ---- */
var __m = createMocks();
var PropertiesService = __m.services.PropertiesService;
var SpreadsheetApp   = __m.services.SpreadsheetApp;
var CalendarApp      = __m.services.CalendarApp;
var UrlFetchApp      = __m.services.UrlFetchApp;
var LockService      = __m.services.LockService;
var CacheService     = __m.services.CacheService;
var ScriptApp        = __m.services.ScriptApp;
var Utilities        = __m.services.Utilities;
var Logger           = __m.services.Logger;
var Session          = __m.services.Session;
`;

const seed = `
/* ---- seed the mock store with the demo dataset so it renders "live" ---- */
(function () {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', 'preview');
  props.setProperty('CALENDAR_PERSONAL_IDS', 'personal');
  props.setProperty('CALENDAR_BUSY_IDS', 'work');
  var md = getMockData();
  function seedTab(tab, headers, rows) {
    var arr = [headers.slice()];
    rows.forEach(function (r) { arr.push(headers.map(function (h) { return r[h] === undefined ? '' : r[h]; })); });
    __m.store.sheets[tab] = arr;
  }
  seedTab('tasks', TASK_HEADERS, md.tasks);
  seedTab('holdings', HOLDING_HEADERS, md.holdings);
  seedTab('dividends', DIVIDEND_HEADERS, md.dividends);
  seedTab('habits', HABIT_HEADERS, md.habits.map(function (h) { return { id: h.id, title: h.title, cadence: h.cadence, target_per_week: h.target_per_week, checkins: (h.checkins || []).join(','), updated_at: h.updated_at }; }));
  seedTab('bills', BILL_HEADERS, md.bills);
  seedTab('goals', GOAL_HEADERS, md.goals);
  seedTab('notes', NOTE_HEADERS, md.notes);
  seedTab('countdowns', COUNTDOWN_HEADERS, md.countdowns);
  // Calendars: owned personal events in full; the work event shows only as "Busy".
  __m.store.calendars['personal'] = md.events.filter(function (e) { return e.owned; })
    .map(function (e) { return { id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay }; });
  __m.store.calendars['work'] = md.events.filter(function (e) { return !e.owned; })
    .map(function (e) { return { id: e.id, title: 'CONFIDENTIAL — should never render', start: e.start, end: e.end, allDay: e.allDay }; });
})();
`;

const shim = `
/* ---- google.script.run shim (async, mirrors success/failure handlers) ---- */
function Builder(s, f) { this._s = s || function () {}; this._f = f || function () {}; }
Builder.prototype.withSuccessHandler = function (fn) { return new Builder(fn, this._f); };
Builder.prototype.withFailureHandler = function (fn) { return new Builder(this._s, fn); };
${JSON.stringify(API_NAMES)}.forEach(function (n) {
  Builder.prototype[n] = function () {
    var a = arguments, self = this;
    setTimeout(function () {
      var r; try { r = window[n].apply(null, a); } catch (e) { return self._f(e); }
      self._s(r);
    }, 40);
    return self;
  };
});
var google = { script: { run: new Builder() } };
`;

const bundle = `<script>\n${mocksSrc}\n${glue}\n${appSrc}\n${seed}\n${shim}\n</script>`;

// 4. Splice into the dashboard HTML
let html = fs.readFileSync(path.join(SRC, 'dashboard.html'), 'utf8');
html = html.replace('var STATE = <?!= bootState ?> || null;', 'var STATE = getDashboardState();');
html = html.replace('<script>\n// Boot state injected', bundle + '\n<script>\n// Boot state injected');
// drop the <base target="_top"> (Apps Script-only) so it opens cleanly as a file
html = html.replace('<base target="_top">', '');

// 5. Honesty layer: this file is a self-contained DEMO — it must never claim to
// be "Live". Relabel the mode chip and add a dismissible explainer banner so
// nobody expects real TickTick/IBKR data from a static page.
const demoOverlay = `
<script>
(function(){
  var chip=document.querySelector('#modeChip');
  if(chip){chip.className='chip mock';chip.querySelector('.lbl').textContent='Demo';
    chip.title='Standalone preview with sample data. TickTick, IBKR, Calendar and Telegram connect only in the deployed Apps Script app (see docs/DEPLOY.md).';}
  var seen=null;try{seen=localStorage.getItem('ld_demo_banner');}catch(e){}
  if(!seen){
    var b=document.createElement('div');
    b.setAttribute('style','position:sticky;top:0;z-index:60;background:var(--warning-weak);color:var(--warning);font-size:var(--fs-cap);font-weight:600;padding:10px 14px;display:flex;gap:10px;align-items:center');
    b.innerHTML='<span>🧪</span><span style="flex:1">Demo preview — the data here is sample data and edits stay in this page. Live TickTick / IBKR / Calendar / Telegram connections work in the deployed Apps Script app (docs/DEPLOY.md).</span><button style="font:inherit;border:none;background:none;color:inherit;cursor:pointer;font-weight:700" aria-label="Dismiss">✕</button>';
    b.querySelector('button').addEventListener('click',function(){b.remove();try{localStorage.setItem('ld_demo_banner','1');}catch(e){}});
    document.body.insertBefore(b,document.body.firstChild);
  }
})();
</script>`;
html = html.replace('</body>', demoOverlay + '\n</body>');

const outDir = path.join(ROOT, 'preview');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

// 6. Verify the data path in Node (no DOM) — assert state assembles correctly.
const ctx = Object.assign({ console, JSON, Math, Date, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error, encodeURIComponent, decodeURIComponent, setTimeout: () => {}, window: {} });
vm.createContext(ctx);
vm.runInContext(mocksSrc + glue + appSrc + seed, ctx, { filename: 'preview-bundle.js' });
const st = ctx.getDashboardState();
const checks = {
  mode: st.mode,
  tasks: st.sections.tasks.data.items.length,
  holdings: st.sections.finances.data.holdings.length,
  timelineEvents: st.sections.time.data.timeline.filter(t => t.kind === 'event').length,
  busyLeak: st.sections.time.data.timeline.some(t => /CONFIDENTIAL/.test(t.title)),
  habits: st.sections.habits.data.items.length,
  briefing: st.home.summary
};
if (checks.busyLeak) throw new Error('PRIVACY FAIL: work calendar title leaked into timeline');
console.log('preview/index.html written. Data-path check:');
console.log(JSON.stringify(checks, null, 2));
