/**
 * store.gs — thin, header-driven wrapper over the one canonical Google Sheet.
 *
 * Tabs are treated as tables: row 1 is the header, every other row is a record.
 * Reads return arrays of plain objects; writes locate rows by `id`. This is the
 * ONLY module that touches SpreadsheetApp, so the test harness mocks a single
 * surface and every higher module stays pure/testable.
 *
 * Constraints honoured here: one canonical Sheet (never duplicated), writes are
 * guarded by LockService, soft-delete only (callers set a status flag — store
 * never removes rows except for the explicit append-only audit pattern).
 */

function _openSheet() {
  var id = getSheetId();
  if (!id) throw new Error('SHEET_ID not configured');
  return SpreadsheetApp.openById(id);
}

function _getOrCreateTab(name, headers) {
  var ss = _openSheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) sh.appendRow(headers);
  }
  return sh;
}

// Read an entire tab as array-of-objects. Unknown/missing tab → [].
function storeReadAll(tabName, headers) {
  var ss = _openSheet();
  var sh = ss.getSheetByName(tabName);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < head.length; c++) {
      if (head[c]) obj[head[c]] = values[r][c];
    }
    obj.__row = r + 1; // 1-based sheet row, for updates
    out.push(obj);
  }
  return out;
}

// Append a record (object keyed by header name). Returns the appended object.
function storeAppend(tabName, headers, record) {
  return withLock(function () {
    var sh = _getOrCreateTab(tabName, headers);
    var existingHead = sh.getLastRow() > 0
      ? sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
      : [];
    var head = (existingHead && existingHead.join('') !== '') ? existingHead : headers;
    var row = head.map(function (h) { return record[h] === undefined ? '' : record[h]; });
    sh.appendRow(row);
    return record;
  });
}

// Update the first row whose `id` matches, applying `patch`. Returns updated
// object or null if not found. Never inserts.
function storeUpdateById(tabName, headers, id, patch) {
  return withLock(function () {
    var ss = _openSheet();
    var sh = ss.getSheetByName(tabName);
    if (!sh) return null;
    var values = sh.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).trim(); });
    var idCol = head.indexOf('id');
    if (idCol < 0) return null;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][idCol]) === String(id)) {
        var merged = {};
        for (var c = 0; c < head.length; c++) merged[head[c]] = values[r][c];
        Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        var rowVals = head.map(function (h) { return merged[h] === undefined ? '' : merged[h]; });
        sh.getRange(r + 1, 1, 1, head.length).setValues([rowVals]);
        merged.__row = r + 1;
        return merged;
      }
    }
    return null;
  });
}

// Replace every row whose `account` column equals `account` with `records`,
// leaving all other rows (e.g. manual CPF/SRS) untouched. Used by IBKR refresh.
function storeReplaceWhere(tabName, headers, matchCol, matchVal, records) {
  return withLock(function () {
    var sh = _getOrCreateTab(tabName, headers);
    var values = sh.getDataRange().getValues();
    var head = (values.length ? values[0].map(function (h) { return String(h).trim(); }) : headers);
    var matchIdx = head.indexOf(matchCol);
    var kept = [];
    for (var r = 1; r < values.length; r++) {
      if (matchIdx < 0 || String(values[r][matchIdx]) !== String(matchVal)) {
        kept.push(values[r]);
      }
    }
    var newRows = records.map(function (rec) {
      return head.map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
    });
    // Rewrite the whole data area: header + kept + new.
    sh.clearContents();
    var all = [head].concat(kept).concat(newRows);
    sh.getRange(1, 1, all.length, head.length).setValues(all);
    return records.length;
  });
}

// Overwrite a fully-managed tab (header + records). Use only for tables the app
// owns entirely (e.g. fx rates) — never for tabs holding manual user rows.
function storeWriteAll(tabName, headers, records) {
  return withLock(function () {
    var sh = _getOrCreateTab(tabName, headers);
    sh.clearContents();
    var all = [headers.slice()].concat((records || []).map(function (rec) {
      return headers.map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
    }));
    sh.getRange(1, 1, all.length, headers.length).setValues(all);
    return records ? records.length : 0;
  });
}

// LockService guard. Falls back to a plain call when LockService is absent
// (the mock provides one; this keeps store usable in degraded environments).
function withLock(fn) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
  } catch (e) {
    lock = null;
  }
  try {
    return fn();
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e2) {} }
  }
}
