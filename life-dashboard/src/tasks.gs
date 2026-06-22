/**
 * tasks.gs — task capture + triage across the Sheet and TickTick.
 *
 * Sources:
 *   - sheet:    the `tasks` tab (manual/local). Soft-delete only (status flag).
 *   - ticktick: TickTick Open API (returns UNDONE tasks only). Because TickTick
 *               drops completed tasks from its feed, we keep a local
 *               `task_overrides` tab so "complete then delete" never errors.
 *
 * Every write is audited and guarded by the store's LockService. Reads fall
 * back to the mock dataset only when NO task source is configured.
 */

var TASKS_TAB = 'tasks';
var TASK_HEADERS = ['id', 'title', 'source', 'due', 'reminder_at', 'status', 'notes', 'updated_at'];
var OVERRIDES_TAB = 'task_overrides';
var OVERRIDE_HEADERS = ['id', 'status', 'updated_at'];

function _normalizeTask(t) {
  return {
    id: String(t.id),
    title: String(t.title || ''),
    source: t.source === 'ticktick' ? 'ticktick' : 'sheet',
    due: isoOf(t.due),
    reminder_at: isoOf(t.reminder_at),
    status: t.status || 'open',
    notes: t.notes ? String(t.notes) : '',
    updated_at: isoOf(t.updated_at) || now().toISOString()
  };
}

// Live + mock-aware read of all tasks (any status). Used by the section build.
// The expensive part — TickTick's N+1 fetches — is memoised inside
// tickTickListTasks(), so this re-applies cheap Sheet reads + local overrides
// fresh on every call (correct even after a write within one execution).
function _readAllTasks() {
  var hasSheet = isConfigured('sheet');
  var hasTT = isConfigured('ticktick');

  if (!hasSheet && !hasTT) {
    return { live: false, items: getMockData().tasks.map(_normalizeTask) };
  }

  var items = [];
  if (hasSheet) {
    storeReadAll(TASKS_TAB, TASK_HEADERS).forEach(function (r) { items.push(_normalizeTask(r)); });
  }
  if (hasTT) {
    var overrides = {};
    if (hasSheet) {
      storeReadAll(OVERRIDES_TAB, OVERRIDE_HEADERS).forEach(function (o) { overrides[String(o.id)] = o.status; });
    }
    tickTickListTasks().forEach(function (t) {
      var nt = _normalizeTask({ id: t.id, title: t.title, source: 'ticktick', due: t.dueDate, status: 'open', notes: t.content });
      if (overrides[nt.id]) nt.status = overrides[nt.id];
      items.push(nt);
    });
  }
  return { live: true, items: items };
}

// Section payload for the dashboard: open tasks (excludes done/deleted),
// sorted by due then update time.
function getTasksSection() {
  var all = _readAllTasks();
  var open = all.items.filter(function (t) { return t.status === 'open'; });
  open.sort(function (a, b) {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return String(b.updated_at).localeCompare(String(a.updated_at));
  });
  var withMeta = open.map(function (t) {
    return Object.assign({}, t, { overdue: !!overdueLabel(t.due), overdueLabel: overdueLabel(t.due) });
  });
  return { live: all.live, data: { items: withMeta } };
}

// --- Writes -----------------------------------------------------------------
function _requireWritable() {
  if (!isConfigured('sheet')) throw new Error('Sheet not configured — add SHEET_ID to enable editing.');
}

function addTask(title, opts) {
  _requireWritable();
  opts = opts || {};
  var cleanTitle = requireText(title, 'Task title');
  var task = _normalizeTask({
    id: genId('t'),
    title: cleanTitle,
    source: 'sheet',
    due: opts.due || null,
    reminder_at: opts.reminder_at || null,
    status: 'open',
    notes: opts.notes || '',
    updated_at: now().toISOString()
  });
  storeAppend(TASKS_TAB, TASK_HEADERS, task);
  auditLog('task.add', task.id, { title: task.title, due: task.due }, opts.actor);
  return { ok: true, status: 'open', task: task };
}

function completeTask(id, source) {
  return _setTaskStatus(id, source, 'done', 'task.complete');
}

function reopenTask(id, source) {
  return _setTaskStatus(id, source, 'open', 'task.reopen');
}

function softDeleteTask(id, source) {
  return _setTaskStatus(id, source, 'deleted', 'task.delete');
}

// Unified status mutation. For TickTick we record a local override and make a
// BEST-EFFORT API call — a completed task that TickTick no longer lists must
// still "delete" cleanly (returns status, never throws). Soft-delete only.
function _setTaskStatus(id, source, status, action) {
  _requireWritable();
  if (!id) throw new Error('Task id required');
  source = source === 'ticktick' ? 'ticktick' : 'sheet';

  if (source === 'sheet') {
    var updated = storeUpdateById(TASKS_TAB, TASK_HEADERS, id, { status: status, updated_at: now().toISOString() });
    if (!updated) throw new Error('Task not found: ' + id);
    auditLog(action, id, { source: source, status: status });
    return { ok: true, status: status, id: id };
  }

  // TickTick: best-effort remote change, authoritative local override.
  tryOr(null, function () {
    if (status === 'done') return tickTickComplete(id);
    if (status === 'deleted') return tickTickDelete(id);
    return tickTickReopen(id);
  });
  storeAppend(OVERRIDES_TAB, OVERRIDE_HEADERS, { id: id, status: status, updated_at: now().toISOString() });
  auditLog(action, id, { source: 'ticktick', status: status });
  return { ok: true, status: status, id: id };
}

// Convenience for the bot / quick capture: returns open tasks only.
function listOpenTasks() {
  return getTasksSection().data.items;
}
