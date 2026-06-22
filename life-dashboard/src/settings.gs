/**
 * settings.gs — settings screen backend + credential status (read-only secrets).
 *
 * getSettingsState() returns editable settings plus a per-integration status
 * (configured? which keys missing?) WITHOUT exposing any secret value. The
 * frontend renders this; saveSetting() validates against DEFAULT_SETTINGS.
 */

function getSettingsState() {
  var integrations = Object.keys(CREDENTIAL_REGISTRY).map(function (key) {
    var reg = CREDENTIAL_REGISTRY[key];
    var missing = reg.keys.filter(function (k) { return !cfgIsSet(k); });
    return {
      key: key,
      label: reg.label,
      configured: missing.length === 0,
      // Names only — never values.
      keys: reg.keys,
      missing: missing
    };
  });
  return { settings: getSettings(), defaults: DEFAULT_SETTINGS, integrations: integrations };
}

function saveSetting(key, value) {
  var updated = setSetting(key, value);
  auditLog('setting.save', key, { value: value });
  return { ok: true, settings: updated };
}
