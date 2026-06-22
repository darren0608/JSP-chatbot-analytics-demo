/**
 * ticktick.gs — TickTick Open API client.
 *
 * OAuth access token lives in Script Property TICKTICK_ACCESS_TOKEN (never the
 * frontend). The Open API only returns UNDONE tasks; completed ones vanish from
 * the feed, which is why tasks.gs keeps local overrides. All calls go through
 * _ttFetch so the test harness mocks one UrlFetchApp surface.
 */

var TICKTICK_BASE = 'https://api.ticktick.com/open/v1';

function _ttToken() {
  var t = cfgGet('TICKTICK_ACCESS_TOKEN');
  if (!t) throw new Error('TICKTICK_ACCESS_TOKEN not configured');
  return t;
}

function _ttFetch(method, path, payload) {
  var opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + _ttToken() },
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(TICKTICK_BASE + path, opts);
  var code = resp.getResponseCode();
  if (code >= 400) throw new Error('TickTick API ' + code + ': ' + resp.getContentText());
  var body = resp.getContentText();
  return body ? JSON.parse(body) : {};
}

// Returns undone tasks across the user's projects, flattened to a simple shape.
function tickTickListTasks() {
  var projects = _ttFetch('get', '/project') || [];
  var tasks = [];
  projects.forEach(function (p) {
    var data = _ttFetch('get', '/project/' + p.id + '/data') || {};
    (data.tasks || []).forEach(function (t) {
      tasks.push({ id: t.id, projectId: p.id, title: t.title, dueDate: t.dueDate || null, content: t.content || '' });
    });
  });
  return tasks;
}

function tickTickComplete(id) {
  // TickTick completes via the project/task pair; we look up the project lazily.
  var task = _ttFindTask(id);
  if (!task) return { ok: true, note: 'already gone' };
  return _ttFetch('post', '/project/' + task.projectId + '/task/' + id + '/complete');
}

function tickTickDelete(id) {
  var task = _ttFindTask(id);
  if (!task) return { ok: true, note: 'already gone' };
  return _ttFetch('delete', '/project/' + task.projectId + '/task/' + id);
}

function tickTickReopen(id) {
  // Open API has no reopen; surfaced as a no-op so callers don't break.
  return { ok: true, note: 'reopen unsupported by TickTick Open API' };
}

function _ttFindTask(id) {
  var all = tryOr([], tickTickListTasks).value;
  for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
  return null;
}

// Live connectivity check for diagnose().
function tickTickTestCall() {
  var projects = _ttFetch('get', '/project') || [];
  return { ok: true, projects: projects.length };
}
