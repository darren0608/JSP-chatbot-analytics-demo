/**
 * util.gs — shared, dependency-free helpers.
 *
 * Pure functions only. No Google service calls live here so the test harness
 * can exercise this module without any mocks. Everything that needs "now" goes
 * through nowMs()/now() so tests can pin the clock deterministically.
 */

// --- Injectable clock -------------------------------------------------------
// Apps Script has no way to freeze time; tests set __CLOCK__ to a fixed epoch
// (ms) so relative-time math and mock fixtures are deterministic.
var __CLOCK__ = null;

function nowMs() {
  return __CLOCK__ === null ? Date.now() : __CLOCK__;
}

function now() {
  return new Date(nowMs());
}

function setClockForTests(ms) {
  __CLOCK__ = ms;
}

// --- Date helpers -----------------------------------------------------------
var MS_DAY = 24 * 60 * 60 * 1000;

function toDate(v) {
  if (v instanceof Date) return v;
  if (v === null || v === undefined || v === '') return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isoOf(v) {
  var d = toDate(v);
  return d ? d.toISOString() : null;
}

function addDays(date, n) {
  var d = toDate(date) || now();
  return new Date(d.getTime() + n * MS_DAY);
}

function startOfDay(date) {
  var d = toDate(date) || now();
  var x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  var da = startOfDay(a), db = startOfDay(b);
  return Math.round((db.getTime() - da.getTime()) / MS_DAY);
}

function isSameDay(a, b) {
  return daysBetween(a, b) === 0;
}

// Human-readable relative time, e.g. "in 2h", "3 days overdue", "just now".
function relativeTime(target, ref) {
  var t = toDate(target);
  if (!t) return '';
  var base = toDate(ref) || now();
  var diff = t.getTime() - base.getTime(); // +future / -past
  var past = diff < 0;
  var secs = Math.abs(diff) / 1000;
  var label;
  if (secs < 45) label = 'just now';
  else if (secs < 3600) label = Math.round(secs / 60) + 'm';
  else if (secs < 86400) label = Math.round(secs / 3600) + 'h';
  else label = Math.round(secs / 86400) + (Math.round(secs / 86400) === 1 ? ' day' : ' days');
  if (label === 'just now') return label;
  return past ? label + ' ago' : 'in ' + label;
}

// "3 days overdue" framing for tasks/bills.
function overdueLabel(due, ref) {
  var d = toDate(due);
  if (!d) return null;
  var base = toDate(ref) || now();
  if (d.getTime() >= base.getTime()) return null;
  var days = Math.max(1, Math.round((base.getTime() - d.getTime()) / MS_DAY));
  return days === 1 ? '1 day overdue' : days + ' days overdue';
}

// --- Money / numbers --------------------------------------------------------
function formatMoney(value, currency) {
  var n = Number(value) || 0;
  var cur = currency || 'SGD';
  var s = n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur + ' ' + s;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// --- Ids & strings ----------------------------------------------------------
function genId(prefix) {
  return (prefix || 'id') + '_' + nowMs().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Safe wrapper: run fn, return its value, or a fallback + structured error.
// Used by section assembly so one throwing source never blanks the page.
function tryOr(fallback, fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, value: fallback, error: (e && e.message) ? e.message : String(e) };
  }
}

// Per-execution memo. Apps Script gives each invocation a fresh global scope, so
// this safely de-dupes expensive reads (e.g. the TickTick N+1) within a single
// request — getTasksSection and getTimeSection both need the task list.
var __REQUEST_MEMO__ = {};
function memoExec(key, fn) {
  if (__REQUEST_MEMO__.hasOwnProperty(key)) return __REQUEST_MEMO__[key];
  var v = fn();
  __REQUEST_MEMO__[key] = v;
  return v;
}
function clearExecMemo() { __REQUEST_MEMO__ = {}; }

// Guard free-text inputs so we never try to write a value larger than a Sheets
// cell allows (~50k chars) and to blunt accidental/abusive huge payloads.
var MAX_TEXT = 2000;
function requireText(value, label) {
  var s = String(value == null ? '' : value).trim();
  if (!s) throw new Error((label || 'Value') + ' required');
  if (s.length > MAX_TEXT) throw new Error((label || 'Value') + ' too long (max ' + MAX_TEXT + ' chars)');
  return s;
}
