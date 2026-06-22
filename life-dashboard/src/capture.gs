/**
 * capture.gs — universal quick capture + query answering.
 *
 * quickCapture() takes one free-text input (dashboard box or Telegram message),
 * parses it (nlp.gs), and routes to the right module. answerQuery() turns a
 * query target into human text reused by the bot and the Home view.
 *
 * Destructive routing (complete/delete) is gated by the caller (Telegram asks
 * yes/no first). quickCapture executes non-destructive captures directly and
 * returns a structured result for destructive ones so the UI can confirm.
 */

function quickCapture(text, opts) {
  opts = opts || {};
  var cmd = parseCommand(text);
  return routeCommand(cmd, opts);
}

function routeCommand(cmd, opts) {
  opts = opts || {};
  switch (cmd.action) {
    case 'add_task':
      var t = addTask(cmd.params.title, { due: cmd.params.due, actor: opts.actor });
      return { ok: true, kind: 'task', message: 'Added task: ' + t.task.title, result: t };
    case 'add_note':
      var n = addNote(cmd.params.text);
      return { ok: true, kind: 'note', message: 'Noted.', result: n };
    case 'add_bill':
      var b = addBill(cmd.params.name, cmd.params.amount, {});
      return { ok: true, kind: 'bill', message: 'Added bill: ' + b.bill.name, result: b };
    case 'complete_task':
    case 'soft_delete_task':
      var match = findTaskByTitle(cmd.params.title || cmd.target);
      if (!match) return { ok: false, kind: 'clarify', message: 'No open task matches "' + (cmd.params.title || cmd.target) + '". Which one?' };
      if (opts.execute) {
        var res = cmd.action === 'complete_task'
          ? completeTask(match.id, match.source)
          : softDeleteTask(match.id, match.source);
        return { ok: true, kind: cmd.action, message: (cmd.action === 'complete_task' ? 'Completed: ' : 'Deleted: ') + match.title, result: res };
      }
      return { ok: true, kind: 'confirm', action: cmd.action, target: match, message: 'Confirm ' + (cmd.action === 'complete_task' ? 'complete' : 'delete') + ' "' + match.title + '"? (yes/no)' };
    case 'query':
      return { ok: true, kind: 'query', message: answerQuery(cmd.target), target: cmd.target };
    default:
      return { ok: false, kind: 'clarify', message: "I didn't quite get that. Try: \"add task X due tomorrow\", \"today\", \"overdue\", or \"portfolio\"." };
  }
}

function findTaskByTitle(title) {
  if (!title) return null;
  var needle = String(title).toLowerCase().trim();
  var open = listOpenTasks();
  // Prefer exact, then substring.
  for (var i = 0; i < open.length; i++) if (open[i].title.toLowerCase() === needle) return open[i];
  for (var j = 0; j < open.length; j++) if (open[j].title.toLowerCase().indexOf(needle) >= 0) return open[j];
  return null;
}

// Turn a query target into a friendly text answer.
function answerQuery(target) {
  switch (target) {
    case 'today':    return _agendaText(0);
    case 'tomorrow': return _agendaText(1);
    case 'week':     return _weekText();
    case 'overdue':  return _overdueText();
    case 'tasks':    return _openTasksText();
    case 'birthdays': return _birthdaysText();
    case 'portfolio': return _portfolioText();
    case 'srs':      return _srsText();
    case 'cpf':      return _cpfText();
    case 'dividends': return _dividendsText();
    case 'bills':    return _billsText();
    case 'habits':   return _habitsText();
    default:         return "Ask me about today, tomorrow, this week, overdue, tasks, bills, birthdays, portfolio, SRS, CPF, or dividends.";
  }
}

function _agendaText(dayOffset) {
  var timeline = getTimeSection().data.timeline;
  var target = startOfDay(addDays(now(), dayOffset));
  var items = timeline.filter(function (it) { return isSameDay(it.start, target); });
  if (!items.length) return (dayOffset === 0 ? 'Nothing scheduled today.' : 'Nothing scheduled.');
  return (dayOffset === 0 ? 'Today:' : 'Then:') + '\n' + items.map(function (it) {
    var when = toDate(it.start);
    var hhmm = when ? ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2) : '';
    return '• ' + hhmm + ' ' + it.title + (it.overdue ? ' (overdue)' : '');
  }).join('\n');
}

function _weekText() {
  var timeline = getTimeSection().data.timeline;
  return timeline.length ? 'This week you have ' + timeline.length + ' items. Next: ' + timeline[0].title : 'Your week is clear.';
}

function _overdueText() {
  var overdue = listOpenTasks().filter(function (t) { return t.overdue; });
  if (!overdue.length) return 'No overdue tasks. 🎉';
  return 'Overdue (' + overdue.length + '):\n' + overdue.map(function (t) { return '• ' + t.title + ' — ' + t.overdueLabel; }).join('\n');
}

function _openTasksText() {
  var open = listOpenTasks();
  if (!open.length) return 'No open tasks.';
  return 'Open tasks (' + open.length + '):\n' + open.slice(0, 10).map(function (t) {
    return '• ' + t.title + (t.due ? ' (' + relativeTime(t.due) + ')' : '');
  }).join('\n');
}

function _birthdaysText() {
  var b = getUpcomingBirthdays(30);
  if (!b.length) return 'No birthdays in the next 30 days.';
  return 'Birthdays (30d):\n' + b.map(function (c) { return '• ' + c.title + ' — ' + c.relative; }).join('\n');
}

function _portfolioText() {
  var s = getFinancesSection().data.summary;
  return 'Portfolio: ' + formatMoney(s.total_portfolio_value.value, 'SGD') +
    '\nEst. annual dividends: ' + formatMoney(s.annual_dividends_est.value, 'SGD');
}
function _srsText() {
  var s = getFinancesSection().data.summary;
  return 'SRS balance: ' + formatMoney(s.srs_balance.value, 'SGD') +
    '\nTop-up room left: ' + formatMoney(s.srs_topup_remaining.value, 'SGD') + ' (cap ' + formatMoney(s.srs_topup_remaining.cap, 'SGD') + ')';
}
function _cpfText() {
  var s = getFinancesSection().data.summary;
  return 'CPF total: ' + formatMoney(s.cpf_total.value, 'SGD');
}
function _dividendsText() {
  var divs = getFinancesSection().data.dividends;
  if (!divs.length) return 'No upcoming dividends recorded.';
  return 'Dividends:\n' + divs.map(function (d) { return '• ' + d.instrument + ': ' + formatMoney(d.amount, d.currency); }).join('\n');
}
function _billsText() {
  var b = getBillsSection().data;
  if (!b.next_bill) return 'No bills recorded.';
  return 'Next bill: ' + b.next_bill.name + ' ' + formatMoney(b.next_bill.amount, b.next_bill.currency) + ' ' + b.next_bill.relative +
    '\nMonthly total: ' + formatMoney(b.monthly_total, 'SGD');
}
function _habitsText() {
  var items = getHabitsSection().data.items;
  if (!items.length) return 'No habits tracked.';
  return 'Habits:\n' + items.map(function (h) { return '• ' + h.title + ' — ' + h.streak + ' day streak' + (h.done_today ? ' ✓' : ''); }).join('\n');
}
