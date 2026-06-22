/**
 * cache.gs — short-lived caching via the built-in (free) CacheService, plus a
 * per-execution memo. This is the main cost/quota lever: without it every page
 * load and every post-action refresh would re-hit Calendar, TickTick (N+1
 * fetches!) and Vertex AI. All helpers degrade gracefully (tryOr) so a cache
 * outage never breaks a request — it just recomputes.
 *
 * TTLs are deliberately short; mutations call cacheBust() to stay correct.
 */

var CACHE_NS = 'ld_';

function _cache() {
  return CacheService.getScriptCache();
}

function cacheGet(key) {
  return tryOr(null, function () {
    var raw = _cache().get(CACHE_NS + key);
    return raw ? JSON.parse(raw) : null;
  }).value;
}

function cachePut(key, value, ttlSeconds) {
  tryOr(null, function () {
    _cache().put(CACHE_NS + key, JSON.stringify(value), ttlSeconds || 60);
  });
}

function cacheRemove(key) {
  tryOr(null, function () { _cache().remove(CACHE_NS + key); });
}

// Compute-through helper: serve cache, else run fn and cache the result.
function cached(key, ttlSeconds, fn) {
  var hit = cacheGet(key);
  if (hit !== null && hit !== undefined) return hit;
  var val = fn();
  cachePut(key, val, ttlSeconds);
  return val;
}

// Invalidate everything affected by a write. Cheap and conservative: drop the
// assembled state and the volatile source caches so the next read is fresh.
function cacheBust() {
  ['dash_state', 'ticktick_tasks'].forEach(cacheRemove);
}
