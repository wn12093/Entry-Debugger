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
    boostModeControlVisible: true,
    boostModeEnabled: false,
    labTabEnabled: false,
    eoUploaderEnabled: false,
    turboModeEnabled: false,
    dropdownSearchEnabled: true,
    dropdownSearchBlockMenuEnabled: true,
    dropdownSearchPropertyPanelEnabled: true,
    blockTextCopyEnabled: true,
    pictureToolsEnabled: false,
    frameProfilerEnabled: false,
    singleBlockDragEnabled: false,
    highQualityBlockImageEnabled: false,
    highQualityBlockImageScale: 1000,
    functionLibraryEnabled: false,
    functionPrivateVariablesEnabled: true
  };

  var MAIN_FEATURE_KEYS = [
    'debuggerTabEnabled',
    'functionUsageEnabled',
    'consoleDebuggingEnabled',
    'boostModeControlVisible',
    'singleBlockDragEnabled',
    'pictureToolsEnabled',
    'frameProfilerEnabled',
    'functionPrivateVariablesEnabled',
    'labTabEnabled'
  ];

  function getDefaultSettings() {
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function normalizeHighQualityBlockImageScale(value) {
    var scale = Number(value);
    if (!Number.isFinite(scale)) {
      scale = DEFAULT_SETTINGS.highQualityBlockImageScale;
    }
    scale = Math.round(scale);
    if (scale < 200) return 200;
    if (scale > 2000) return 2000;
    return scale;
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
    var boostModeControlVisible = typeof data.boostModeControlVisible === 'boolean'
      ? data.boostModeControlVisible
      : DEFAULT_SETTINGS.boostModeControlVisible;
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
    var dropdownSearchEnabled = typeof data.dropdownSearchEnabled === 'boolean'
      ? data.dropdownSearchEnabled
      : DEFAULT_SETTINGS.dropdownSearchEnabled;
    var dropdownSearchBlockMenuEnabled = typeof data.dropdownSearchBlockMenuEnabled === 'boolean'
      ? data.dropdownSearchBlockMenuEnabled
      : true;
    var dropdownSearchPropertyPanelEnabled = typeof data.dropdownSearchPropertyPanelEnabled === 'boolean'
      ? data.dropdownSearchPropertyPanelEnabled
      : true;
    var blockTextCopyEnabled = typeof data.blockTextCopyEnabled === 'boolean'
      ? data.blockTextCopyEnabled
      : DEFAULT_SETTINGS.blockTextCopyEnabled;
    var pictureToolsEnabled = typeof data.pictureToolsEnabled === 'boolean'
      ? data.pictureToolsEnabled
      : DEFAULT_SETTINGS.pictureToolsEnabled;
    var frameProfilerEnabled = typeof data.frameProfilerEnabled === 'boolean'
      ? data.frameProfilerEnabled
      : DEFAULT_SETTINGS.frameProfilerEnabled;
    var singleBlockDragEnabled = typeof data.singleBlockDragEnabled === 'boolean'
      ? data.singleBlockDragEnabled
      : DEFAULT_SETTINGS.singleBlockDragEnabled;
    var highQualityBlockImageEnabled = typeof data.highQualityBlockImageEnabled === 'boolean'
      ? data.highQualityBlockImageEnabled
      : DEFAULT_SETTINGS.highQualityBlockImageEnabled;
    var highQualityBlockImageScale = normalizeHighQualityBlockImageScale(data.highQualityBlockImageScale);
    var functionLibraryEnabled = typeof data.functionLibraryEnabled === 'boolean'
      ? data.functionLibraryEnabled
      : false;
    var functionPrivateVariablesEnabled = typeof data.functionPrivateVariablesEnabled === 'boolean'
      ? data.functionPrivateVariablesEnabled
      : true;

    function resetLabFeatureSettings() {
      eoUploaderEnabled = DEFAULT_SETTINGS.eoUploaderEnabled;
      turboModeEnabled = DEFAULT_SETTINGS.turboModeEnabled;
      functionLibraryEnabled = DEFAULT_SETTINGS.functionLibraryEnabled;
    }

    if (!debuggerTabEnabled) {
      labTabEnabled = false;
    }

    if (!labTabEnabled) {
      resetLabFeatureSettings();
    }

    if (!boostModeControlVisible) {
      boostModeEnabled = false;
    }

    enabled = !!(
      enabled &&
      (
        debuggerTabEnabled ||
        functionUsageEnabled ||
        consoleDebuggingEnabled ||
        boostModeControlVisible ||
        boostModeEnabled ||
        functionPrivateVariablesEnabled ||
        dropdownSearchEnabled ||
        labTabEnabled ||
        turboModeEnabled ||
        blockTextCopyEnabled ||
        pictureToolsEnabled ||
        frameProfilerEnabled ||
        singleBlockDragEnabled ||
        highQualityBlockImageEnabled ||
        functionLibraryEnabled
      )
    );

    if (!enabled) {
      debuggerTabEnabled = false;
      functionUsageEnabled = false;
      consoleDebuggingEnabled = false;
      boostModeControlVisible = false;
      boostModeEnabled = false;
      labTabEnabled = false;
      resetLabFeatureSettings();
      functionPrivateVariablesEnabled = false;
      singleBlockDragEnabled = false;
      pictureToolsEnabled = false;
      frameProfilerEnabled = false;
    }

    return {
      enabled: enabled,
      debuggerTabEnabled: enabled && debuggerTabEnabled,
      functionUsageEnabled: enabled && functionUsageEnabled,
      consoleDebuggingEnabled: enabled && consoleDebuggingEnabled,
      boostModeControlVisible: enabled && boostModeControlVisible,
      boostModeEnabled: enabled && boostModeEnabled,
      labTabEnabled: enabled && labTabEnabled,
      eoUploaderEnabled: enabled && eoUploaderEnabled,
      turboModeEnabled: enabled && turboModeEnabled,
      dropdownSearchEnabled: enabled && dropdownSearchEnabled,
      dropdownSearchBlockMenuEnabled: dropdownSearchBlockMenuEnabled,
      dropdownSearchPropertyPanelEnabled: dropdownSearchPropertyPanelEnabled,
      blockTextCopyEnabled: enabled && blockTextCopyEnabled,
      pictureToolsEnabled: enabled && pictureToolsEnabled,
      frameProfilerEnabled: enabled && frameProfilerEnabled,
      singleBlockDragEnabled: enabled && singleBlockDragEnabled,
      highQualityBlockImageEnabled: enabled && highQualityBlockImageEnabled,
      highQualityBlockImageScale: highQualityBlockImageScale,
      functionLibraryEnabled: enabled && functionLibraryEnabled,
      functionPrivateVariablesEnabled: enabled && functionPrivateVariablesEnabled
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
    normalizeHighQualityBlockImageScale: normalizeHighQualityBlockImageScale,
    getEnabledMainFeatureCount: getEnabledMainFeatureCount
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
