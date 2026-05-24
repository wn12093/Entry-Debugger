/**
 * settings.js - Entry Debugger shared settings normalization.
 *
 * Loaded in the background worker, popup page, and content script.
 */
(function (global) {
  'use strict';

  var DEFAULT_SETTINGS = {
    enabled: true,
    debuggerTabEnabled: true,
    functionUsageEnabled: true,
    consoleDebuggingEnabled: true,
    boostModeEnabled: false,
    labTabEnabled: false,
    eoUploaderEnabled: false,
    turboModeEnabled: false
  };

  var MAIN_FEATURE_KEYS = [
    'debuggerTabEnabled',
    'functionUsageEnabled',
    'consoleDebuggingEnabled',
    'boostModeEnabled',
    'labTabEnabled'
  ];

  function getDefaultSettings() {
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function normalizeSettings(data) {
    data = data || {};

    var enabled = data.enabled !== false;
    var debuggerTabEnabled = typeof data.debuggerTabEnabled === 'boolean'
      ? data.debuggerTabEnabled
      : enabled;
    var functionUsageEnabled = typeof data.functionUsageEnabled === 'boolean'
      ? data.functionUsageEnabled
      : enabled;
    var consoleDebuggingEnabled = typeof data.consoleDebuggingEnabled === 'boolean'
      ? data.consoleDebuggingEnabled
      : enabled;
    var boostModeEnabled = typeof data.boostModeEnabled === 'boolean'
      ? data.boostModeEnabled
      : false;
    var labTabEnabled = typeof data.labTabEnabled === 'boolean'
      ? data.labTabEnabled
      : false;
    var eoUploaderEnabled = typeof data.eoUploaderEnabled === 'boolean'
      ? data.eoUploaderEnabled
      : false;
    var turboModeEnabled = typeof data.turboModeEnabled === 'boolean'
      ? data.turboModeEnabled
      : false;

    if (!debuggerTabEnabled) {
      labTabEnabled = false;
      eoUploaderEnabled = false;
    }

    if (!labTabEnabled) {
      eoUploaderEnabled = false;
      turboModeEnabled = false;
    }

    enabled = !!(
      enabled &&
      (
        debuggerTabEnabled ||
        functionUsageEnabled ||
        consoleDebuggingEnabled ||
        boostModeEnabled ||
        labTabEnabled ||
        turboModeEnabled
      )
    );

    if (!enabled) {
      debuggerTabEnabled = false;
      functionUsageEnabled = false;
      consoleDebuggingEnabled = false;
      boostModeEnabled = false;
      labTabEnabled = false;
      eoUploaderEnabled = false;
      turboModeEnabled = false;
    }

    return {
      enabled: enabled,
      debuggerTabEnabled: enabled && debuggerTabEnabled,
      functionUsageEnabled: enabled && functionUsageEnabled,
      consoleDebuggingEnabled: enabled && consoleDebuggingEnabled,
      boostModeEnabled: enabled && boostModeEnabled,
      labTabEnabled: enabled && labTabEnabled,
      eoUploaderEnabled: enabled && eoUploaderEnabled,
      turboModeEnabled: enabled && turboModeEnabled
    };
  }

  function getEnabledMainFeatureCount(settings) {
    settings = normalizeSettings(settings);
    return MAIN_FEATURE_KEYS.reduce(function (count, key) {
      return count + (settings[key] ? 1 : 0);
    }, 0);
  }

  global.EntryDebuggerSettings = {
    DEFAULT_SETTINGS: Object.freeze(getDefaultSettings()),
    MAIN_FEATURE_KEYS: MAIN_FEATURE_KEYS.slice(),
    getDefaultSettings: getDefaultSettings,
    normalize: normalizeSettings,
    getEnabledMainFeatureCount: getEnabledMainFeatureCount
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
