/**
 * calendar.gs — Google Calendar reads + timeline merge.
 *
 * Personal/owned calendars (CALENDAR_PERSONAL_IDS, comma-separated) are read in
 * full. A work/gov calendar (CALENDAR_BUSY_IDS) is read as FREE/BUSY ONLY and
 * rendered as title-less "Busy" blocks — we never read its event titles,
 * attendees, or details. This is a hard privacy constraint (§2).
 *
 * The Time tab shows a merged, time-sorted timeline of events + timed tasks,
 * plus a follow-ups list of untimed tasks.
 */

function _personalCalIds() {
  return cfgGet('CALENDAR_PERSONAL_IDS').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function _busyCalIds() {
  return cfgGet('CALENDAR_BUSY_IDS').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Reads calendar events within the look-ahead window.
function _readCalendarEvents(days) {
  var start = startOfDay(now());
  var end = addDays(start, days);
  var events = [];

  _personalCalIds().forEach(function (calId) {
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) return;
    cal.getEvents(start, end).forEach(function (ev) {
      events.push({
        id: ev.getId(),
        title: ev.getTitle(),
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        owned: true,
        calendar: 'personal'
      });
    });
  });

  // Free/busy ONLY for work/gov calendars. We deliberately discard ev.getTitle().
  _busyCalIds().forEach(function (calId) {
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) return;
    cal.getEvents(start, end).forEach(function (ev) {
      if (ev.isAllDayEvent()) return; // ignore all-day OOO markers
      events.push({
        id: 'busy_' + ev.getStartTime().getTime(),
        title: 'Busy',            // hard-coded; never the real title
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: false,
        owned: false,
        calendar: 'work'
      });
    });
  });

  return events;
}

// Builds the Time tab: timeline (events + timed tasks) + follow-ups (untimed).
function getTimeSection() {
  var days = getSettings().timeViewDays;
  var hasCal = isConfigured('calendar');
  var taskRead = _readAllTasks();

  var events;
  if (hasCal) {
    events = _readCalendarEvents(days);
  } else if (!taskRead.live) {
    events = getMockData().events.slice();
  } else {
    events = []; // tasks live but no calendar configured → empty calendar, stay live
  }

  var live = hasCal || taskRead.live;
  var openTasks = taskRead.items.filter(function (t) { return t.status === 'open'; });
  var windowEnd = addDays(startOfDay(now()), days).getTime();

  var timeline = [];
  events.forEach(function (ev) {
    timeline.push({ kind: 'event', source: 'calendar', title: ev.title, start: ev.start, end: ev.end, allDay: !!ev.allDay, owned: ev.owned });
  });

  var followUps = [];
  openTasks.forEach(function (t) {
    if (t.due) {
      var dueMs = toDate(t.due).getTime();
      var overdue = !!overdueLabel(t.due);
      if (overdue || dueMs <= windowEnd) {
        timeline.push({ kind: 'task', source: t.source, title: t.title, start: t.due, end: null, overdue: overdue, overdueLabel: overdueLabel(t.due), id: t.id });
      }
    } else {
      followUps.push({ id: t.id, title: t.title, source: t.source, updated_at: t.updated_at });
    }
  });

  timeline.sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
  followUps.sort(function (a, b) { return String(a.updated_at).localeCompare(String(b.updated_at)); });

  return { live: live, data: { timeline: timeline, followUps: followUps } };
}

function calendarTestCall() {
  var ids = _personalCalIds();
  if (!ids.length) throw new Error('No CALENDAR_PERSONAL_IDS configured');
  var cal = CalendarApp.getCalendarById(ids[0]);
  if (!cal) throw new Error('Calendar not accessible: ' + ids[0]);
  return { ok: true, calendar: ids[0] };
}
