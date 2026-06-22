/**
 * goals.gs — tracked goals / OKRs with progress bars and target dates.
 * Data in the `goals` tab. Progress = current / target, clamped 0..1.
 */

var GOALS_TAB = 'goals';
var GOAL_HEADERS = ['id', 'title', 'target', 'current', 'unit', 'due', 'updated_at'];

function _decorateGoal(g) {
  var target = Number(g.target) || 0;
  var current = Number(g.current) || 0;
  return {
    id: String(g.id),
    title: g.title,
    target: target,
    current: current,
    unit: g.unit || '',
    due: isoOf(g.due),
    progress: target > 0 ? Math.max(0, Math.min(1, current / target)) : 0,
    days_until: g.due ? daysBetween(now(), g.due) : null
  };
}

function getGoalsSection() {
  var rows = isConfigured('sheet') ? storeReadAll(GOALS_TAB, GOAL_HEADERS) : getMockData().goals;
  return { live: isConfigured('sheet'), data: { items: rows.map(_decorateGoal) } };
}

function updateGoalProgress(id, current) {
  if (!isConfigured('sheet')) throw new Error('Sheet not configured');
  var updated = storeUpdateById(GOALS_TAB, GOAL_HEADERS, id, { current: Number(current) || 0, updated_at: now().toISOString() });
  if (!updated) throw new Error('Goal not found: ' + id);
  auditLog('goal.update', id, { current: current });
  return { ok: true, goal: _decorateGoal(updated) };
}
