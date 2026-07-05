/**
 * harness.js — loads the .gs modules into an isolated vm sandbox with mocked
 * Google services. Each loadApp() call is a clean slate (fresh props, sheets,
 * clock) so tests never bleed into each other.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createMocks } = require('./mocks');

const SRC = path.join(__dirname, '..', 'src');

// Load order matters only for readability — all become globals in one context.
const FILES = [
  'util.gs', 'cache.gs', 'config.gs', 'log.gs', 'store.gs', 'fx.gs', 'errors.gs',
  'tasks.gs', 'ticktick.gs', 'calendar.gs', 'ibkr.gs', 'finances.gs',
  'habits.gs', 'bills.gs', 'goals.gs', 'notes.gs', 'countdowns.gs',
  'nlp.gs', 'ai.gs', 'capture.gs', 'telegram.gs', 'briefing.gs',
  'search.gs', 'settings.gs', 'diagnose.gs', 'maintenance.gs', 'triggers.gs', 'Code.gs'
];

// Fixed clock: 2026-06-22 08:00 Asia/Singapore.
const FIXED_NOW = Date.parse('2026-06-22T00:00:00Z');

function loadApp(seed) {
  const { store, services } = createMocks();
  const ctx = Object.assign({}, services, {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean,
    isNaN, parseInt, parseFloat, RegExp, Error, encodeURIComponent, decodeURIComponent
  });
  vm.createContext(ctx);
  FILES.forEach(function (f) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });
  ctx.setClockForTests(FIXED_NOW);

  if (seed) seed(ctx, store);
  return { ctx, store };
}

// Convenience seeders ------------------------------------------------------
function setProps(store, obj) { Object.keys(obj).forEach(function (k) { store.props[k] = String(obj[k]); }); }

// Configure a live Sheet with the given tabs. tab -> array-of-objects; we infer
// headers from the supplied HEADERS map or object keys.
function seedSheet(store, tab, headers, records) {
  store.props.SHEET_ID = store.props.SHEET_ID || 'mock-sheet';
  var rows = [headers.slice()];
  (records || []).forEach(function (rec) {
    rows.push(headers.map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
  });
  store.sheets[tab] = rows;
}

module.exports = { loadApp, setProps, seedSheet, FIXED_NOW, FILES };
