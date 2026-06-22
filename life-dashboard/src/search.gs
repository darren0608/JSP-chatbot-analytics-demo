/**
 * search.gs — global search across tasks, events, notes, and holdings.
 * Case-insensitive substring match; returns a flat, typed result list.
 */

function globalSearch(query) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return { query: query, results: [] };
  var results = [];

  tryOr([], listOpenTasks).value.forEach(function (t) {
    if (t.title.toLowerCase().indexOf(q) >= 0) results.push({ type: 'task', title: t.title, meta: t.due ? relativeTime(t.due) : 'no due date', id: t.id, source: t.source });
  });
  tryOr({ timeline: [] }, function () { return getTimeSection().data; }).value.timeline.forEach(function (it) {
    if (it.kind === 'event' && it.title.toLowerCase().indexOf(q) >= 0) results.push({ type: 'event', title: it.title, meta: relativeTime(it.start), source: 'calendar' });
  });
  tryOr({ items: [] }, function () { return getNotesSection().data; }).value.items.forEach(function (n) {
    if (n.text.toLowerCase().indexOf(q) >= 0) results.push({ type: 'note', title: n.text, meta: n.relative, id: n.id, source: 'sheet' });
  });
  tryOr({ holdings: [] }, function () { return getFinancesSection().data; }).value.holdings.forEach(function (h) {
    if (String(h.instrument).toLowerCase().indexOf(q) >= 0) results.push({ type: 'holding', title: h.instrument, meta: formatMoney(h.current_value, h.currency), source: 'ibkr' });
  });

  return { query: query, results: results };
}
