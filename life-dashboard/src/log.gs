/**
 * log.gs — append-only audit log.
 *
 * Every write (task edit, IBKR refresh, bot action, setting change) appends one
 * row to the `audit` tab. Never updates or deletes existing rows. If the Sheet
 * is unavailable, logging degrades to Logger so it never throws into a caller.
 */

var AUDIT_TAB = 'audit';
var AUDIT_HEADERS = ['ts', 'actor', 'action', 'target', 'detail'];

function auditLog(action, target, detail, actor) {
  var row = {
    ts: now().toISOString(),
    actor: actor || 'dashboard',
    action: action,
    target: target == null ? '' : String(target),
    detail: detail == null ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail))
  };
  try {
    storeAppend(AUDIT_TAB, AUDIT_HEADERS, row);
  } catch (e) {
    try { Logger.log('[audit-fallback] ' + JSON.stringify(row)); } catch (e2) {}
  }
  return row;
}

function readAuditLog(limit) {
  var rows = storeReadAll(AUDIT_TAB, AUDIT_HEADERS);
  rows.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  return limit ? rows.slice(0, limit) : rows;
}
