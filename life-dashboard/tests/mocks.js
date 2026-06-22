/**
 * mocks.js — in-memory fakes for the Google Apps Script services the app uses.
 *
 * One createMocks() call returns a fresh, isolated store plus the service
 * objects to inject into the vm sandbox. Tests seed data via the returned
 * `store` (props, sheets, calendars, fetch handler) and assert against side
 * effects (appended rows, sent Telegram messages, audit log).
 */

function createMocks() {
  var store = {
    props: {},
    sheets: {},          // name -> rows (array of arrays; row 0 = header)
    calendars: {},       // id -> [{id,title,start,end,allDay}]
    fetch: null,         // function(url, opts) -> { code, body }
    fetchLog: [],
    telegram: [],        // sent messages
    logs: [],
    lockAcquired: 0
  };

  // ---- PropertiesService ----
  var PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return store.props.hasOwnProperty(k) ? store.props[k] : null; },
        setProperty: function (k, v) { store.props[k] = String(v); return this; },
        deleteProperty: function (k) { delete store.props[k]; return this; }
      };
    }
  };

  // ---- SpreadsheetApp ----
  function makeSheet(name) {
    if (!store.sheets[name]) store.sheets[name] = [];
    function rows() { return store.sheets[name]; }
    function lastCol() { return rows().reduce(function (m, r) { return Math.max(m, r.length); }, 0); }
    return {
      getName: function () { return name; },
      appendRow: function (arr) { rows().push(arr.slice()); return this; },
      getLastRow: function () { return rows().length; },
      getLastColumn: function () { return lastCol(); },
      clearContents: function () { store.sheets[name] = []; return this; },
      getDataRange: function () { return makeRange(name, 1, 1, Math.max(rows().length, 1), Math.max(lastCol(), 1)); },
      getRange: function (r, c, nr, nc) { return makeRange(name, r, c, nr || 1, nc || 1); }
    };
  }
  function makeRange(name, r, c, nr, nc) {
    function rows() { return store.sheets[name]; }
    return {
      getValues: function () {
        var out = [];
        for (var i = 0; i < nr; i++) {
          var row = rows()[r - 1 + i] || [];
          var slice = [];
          for (var j = 0; j < nc; j++) slice.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(slice);
        }
        return out;
      },
      setValues: function (vals) {
        for (var i = 0; i < vals.length; i++) {
          var ri = r - 1 + i;
          if (!rows()[ri]) rows()[ri] = [];
          for (var j = 0; j < vals[i].length; j++) rows()[ri][c - 1 + j] = vals[i][j];
        }
        return this;
      }
    };
  }
  var SpreadsheetApp = {
    openById: function (id) {
      if (!id) throw new Error('bad sheet id');
      return {
        getSheetByName: function (n) { return store.sheets.hasOwnProperty(n) ? makeSheet(n) : null; },
        insertSheet: function (n) { store.sheets[n] = []; return makeSheet(n); }
      };
    }
  };

  // ---- CalendarApp ----
  function makeEvent(ev) {
    return {
      getId: function () { return ev.id; },
      getTitle: function () { return ev.title; },
      getStartTime: function () { return new Date(ev.start); },
      getEndTime: function () { return new Date(ev.end); },
      isAllDayEvent: function () { return !!ev.allDay; }
    };
  }
  var CalendarApp = {
    getCalendarById: function (id) {
      if (!store.calendars.hasOwnProperty(id)) return null;
      return {
        getEvents: function (start, end) {
          return store.calendars[id]
            .filter(function (e) { var s = new Date(e.start).getTime(); return s >= start.getTime() && s < end.getTime(); })
            .map(makeEvent);
        }
      };
    }
  };

  // ---- UrlFetchApp ----
  var UrlFetchApp = {
    fetch: function (url, opts) {
      store.fetchLog.push({ url: url, opts: opts });
      var res = store.fetch ? store.fetch(url, opts) : { code: 200, body: '{}' };
      if (res === undefined || res === null) res = { code: 200, body: '{}' };
      return {
        getResponseCode: function () { return res.code === undefined ? 200 : res.code; },
        getContentText: function () { return res.body === undefined ? '' : res.body; }
      };
    }
  };

  // ---- LockService ----
  var LockService = {
    getScriptLock: function () {
      return {
        waitLock: function () { store.lockAcquired++; return true; },
        releaseLock: function () { return true; }
      };
    }
  };

  // ---- CacheService (in-memory; TTL ignored — fine for deterministic tests) ----
  store.cache = {};
  var CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { return store.cache.hasOwnProperty(k) ? store.cache[k] : null; },
        put: function (k, v) { store.cache[k] = String(v); },
        remove: function (k) { delete store.cache[k]; }
      };
    }
  };

  // ---- ScriptApp / Utilities / Logger ----
  var ScriptApp = { getOAuthToken: function () { return 'test-oauth-token'; } };
  var Utilities = { sleep: function () {} };
  var Logger = { log: function (m) { store.logs.push(m); } };

  // ---- HtmlService / ContentService (only used at call-time) ----
  var HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: function () {
      var t = { evaluate: function () { return { setTitle: function () { return this; }, addMetaTag: function () { return this; }, setXFrameOptionsMode: function () { return this; } }; } };
      return t;
    },
    createHtmlOutputFromFile: function () { return { getContent: function () { return ''; } }; }
  };
  var ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (s) { return { _s: s, setMimeType: function () { return this; }, getContent: function () { return s; } }; }
  };

  return {
    store: store,
    services: {
      PropertiesService: PropertiesService,
      SpreadsheetApp: SpreadsheetApp,
      CalendarApp: CalendarApp,
      UrlFetchApp: UrlFetchApp,
      LockService: LockService,
      CacheService: CacheService,
      ScriptApp: ScriptApp,
      Utilities: Utilities,
      Logger: Logger,
      HtmlService: HtmlService,
      ContentService: ContentService
    }
  };
}

module.exports = { createMocks: createMocks };
