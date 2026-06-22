/**
 * fx.gs — FX rates to SGD, sourced as DATA rather than hardcoded constants.
 *
 * Resolution order (all free):
 *   1. CacheService (6h) — avoids re-fetching within a day.
 *   2. The `fx` Sheet tab (currency, rate_to_sgd, updated_at) — survives across
 *      runs and lets the owner override a rate manually.
 *   3. Built-in fallback constants — so totals still compute offline / unconfigured.
 *
 * refreshFxRates() pulls from frankfurter.app (free, keyless) and writes the
 * `fx` tab. Headline totals are labelled "est." in the UI because rates and
 * manual rows are approximate.
 */

var FX_TAB = 'fx';
var FX_HEADERS = ['currency', 'rate_to_sgd', 'updated_at'];
var FX_FALLBACK = { SGD: 1, USD: 1.35, EUR: 1.45, GBP: 1.70 };
var FX_FRANKFURTER = 'https://api.frankfurter.app/latest';

// Returns a map { CUR: rateToSgd, ... }. Always includes SGD:1.
function getFxRates() {
  return cached('fx_rates', 6 * 3600, _resolveFxRates);
}

function _resolveFxRates() {
  var rates = { SGD: 1 };
  if (isConfigured('sheet')) {
    tryOr([], function () { return storeReadAll(FX_TAB, FX_HEADERS); }).value.forEach(function (r) {
      var cur = String(r.currency || '').toUpperCase();
      var rate = Number(r.rate_to_sgd);
      if (cur && rate > 0) rates[cur] = rate;
    });
  }
  // Backfill anything missing from the fallback table so conversions never NaN.
  Object.keys(FX_FALLBACK).forEach(function (cur) {
    if (!rates[cur]) rates[cur] = FX_FALLBACK[cur];
  });
  return rates;
}

function fxToSgd(amount, currency) {
  var rates = getFxRates();
  var cur = String(currency || 'SGD').toUpperCase();
  var rate = rates[cur] || FX_FALLBACK[cur] || 1;
  return (Number(amount) || 0) * rate;
}

// Time-trigger / Settings-button entrypoint: refresh rates from the free API.
function refreshFxRates() {
  if (!isConfigured('sheet')) return { ok: false, message: 'Sheet not configured — cannot store FX rates.' };
  var symbols = ['USD', 'EUR', 'GBP']; // currencies we hold besides SGD
  var resp = UrlFetchApp.fetch(FX_FRANKFURTER + '?from=SGD&to=' + symbols.join(','), { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) return { ok: false, message: 'FX provider error ' + resp.getResponseCode() };
  var body = JSON.parse(resp.getContentText() || '{}');
  var sgdTo = body.rates || {};
  var rows = [{ currency: 'SGD', rate_to_sgd: 1, updated_at: now().toISOString() }];
  symbols.forEach(function (cur) {
    if (sgdTo[cur] > 0) rows.push({ currency: cur, rate_to_sgd: round2(1 / sgdTo[cur]), updated_at: now().toISOString() });
  });
  storeWriteAll(FX_TAB, FX_HEADERS, rows);
  cacheRemove('fx_rates');
  auditLog('fx.refresh', null, { currencies: rows.length });
  return { ok: true, rates: rows.length };
}

function fxTestCall() {
  var resp = UrlFetchApp.fetch(FX_FRANKFURTER + '?from=SGD&to=USD', { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) throw new Error('FX provider unreachable');
  return { ok: true };
}
