/**
 * maintenance.gs — periodic housekeeping (time-trigger entrypoints).
 *
 * dailyMaintenance(): compact the append-only TickTick override tab, prune old
 * error rows, and refresh FX rates. Each step is best-effort and isolated so one
 * failure never aborts the rest.
 */

// Collapse the append-only `task_overrides` tab to one (latest) row per id so it
// can't grow unbounded over years. Last status wins (matches read semantics).
function compactTaskOverrides() {
  if (!isConfigured('sheet')) return { ok: false };
  var rows = storeReadAll(OVERRIDES_TAB, OVERRIDE_HEADERS);
  if (rows.length < 2) return { ok: true, compacted: 0 };
  var latest = {};
  rows.forEach(function (r) { latest[String(r.id)] = { id: r.id, status: r.status, updated_at: r.updated_at }; });
  var kept = Object.keys(latest).map(function (k) { return latest[k]; });
  storeWriteAll(OVERRIDES_TAB, OVERRIDE_HEADERS, kept);
  return { ok: true, before: rows.length, after: kept.length };
}

// Drop error rows older than maxAgeDays (default 60).
function pruneErrors(maxAgeDays) {
  if (!isConfigured('sheet')) return { ok: false };
  var cutoff = nowMs() - (maxAgeDays || 60) * 24 * 3600 * 1000;
  var rows = storeReadAll(ERRORS_TAB, ERROR_HEADERS);
  var kept = rows.filter(function (r) { var t = toDate(r.ts); return t && t.getTime() >= cutoff; });
  if (kept.length !== rows.length) storeWriteAll(ERRORS_TAB, ERROR_HEADERS, kept);
  return { ok: true, removed: rows.length - kept.length };
}

function dailyMaintenance() {
  var result = {
    overrides: tryOr(null, compactTaskOverrides).value,
    errors: tryOr(null, function () { return pruneErrors(60); }).value,
    fx: tryOr(null, refreshFxRates).value
  };
  auditLog('maintenance.daily', null, result);
  return result;
}
