/**
 * briefing.gs — AI daily/weekly briefing (with a templated fallback).
 *
 * buildBriefing() pulls counts from every section and produces a one-line
 * summary ("3 meetings, 2 overdue tasks, rent due Friday"). If AI is configured
 * it phrases it; otherwise a deterministic template is used. pushDailyBriefing()
 * is the time-trigger entrypoint that sends it to Telegram.
 */

function gatherBriefingFacts() {
  var timeline = tryOr({ timeline: [], followUps: [] }, function () { return getTimeSection().data; }).value;
  var todayItems = timeline.timeline.filter(function (it) { return isSameDay(it.start, now()); });
  var meetings = todayItems.filter(function (it) { return it.kind === 'event'; }).length;
  var open = tryOr([], listOpenTasks).value;
  var overdue = open.filter(function (t) { return t.overdue; }).length;
  var bills = tryOr({ next_bill: null }, function () { return getBillsSection().data; }).value;
  var habits = tryOr({ items: [] }, function () { return getHabitsSection().data; }).value;

  return {
    meetings: meetings,
    todayItems: todayItems,
    openTasks: open.length,
    overdue: overdue,
    nextBill: bills.next_bill,
    habitsDoneToday: habits.items.filter(function (h) { return h.done_today; }).length,
    habitsTotal: habits.items.length
  };
}

function _templateBriefing(f) {
  var parts = [];
  parts.push(f.meetings + (f.meetings === 1 ? ' meeting' : ' meetings') + ' today');
  if (f.overdue) parts.push(f.overdue + ' overdue task' + (f.overdue === 1 ? '' : 's'));
  else parts.push(f.openTasks + ' open task' + (f.openTasks === 1 ? '' : 's'));
  if (f.nextBill) parts.push(f.nextBill.name + ' due ' + f.nextBill.relative);
  return parts.join(', ') + '.';
}

// Cached for 30 min so the (paid) AI call doesn't fire on every dashboard load.
// pushDailyBriefing() forces a fresh one for the morning Telegram message.
function buildBriefing() {
  return cached('briefing', 1800, _buildBriefingUncached);
}

function _buildBriefingUncached() {
  var f = gatherBriefingFacts();
  var template = _templateBriefing(f);
  if (isConfigured('ai')) {
    var ai = tryOr(null, function () {
      return aiSummarize('Write a single warm, concise sentence summarising my day from these facts. No preamble. Facts: ' + JSON.stringify(f));
    });
    if (ai.ok && ai.value) return { text: String(ai.value).trim(), facts: f, source: 'ai', generatedAt: now().toISOString() };
  }
  return { text: template, facts: f, source: 'template', generatedAt: now().toISOString() };
}

// Time-trigger entrypoint: push the morning briefing to Telegram.
function pushDailyBriefing() {
  cacheRemove('briefing');           // force a fresh, up-to-date briefing
  var b = buildBriefing();
  var greeting = _greeting() + '! ' + b.text;
  if (isConfigured('telegram')) {
    tryOr(null, function () { return telegramSend(greeting); });
  }
  auditLog('briefing.push', null, { source: b.source });
  return b;
}

function _greeting() {
  var h = now().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
