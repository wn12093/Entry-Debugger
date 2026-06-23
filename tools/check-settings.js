'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(rootDir, 'entry-debugger-extension', 'settings.js'),
  'utf8'
);
const sandbox = {};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'settings.js' });

const Settings = sandbox.EntryDebuggerSettings;
const defaults = Settings.getDefaultSettings();
const normalize = Settings.normalize;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepStrictEqual(plain(normalize()), plain(defaults));
assert.deepStrictEqual(
  plain(normalize({ pictureToolsEnabled: true })),
  plain(Object.assign({}, defaults, { pictureToolsEnabled: true }))
);

const disabled = normalize({
  enabled: false,
  debuggerTabEnabled: true,
  functionUsageEnabled: true,
  consoleDebuggingEnabled: true,
  boostModeControlVisible: true,
  boostModeEnabled: true,
  labTabEnabled: true,
  turboModeEnabled: true,
  dropdownSearchEnabled: true,
  blockTextCopyEnabled: true,
  pictureToolsEnabled: true,
  frameProfilerEnabled: true,
  singleBlockDragEnabled: true,
  highQualityBlockImageEnabled: true,
  functionLibraryEnabled: true,
  functionPrivateVariablesEnabled: true,
  dropdownSearchBlockMenuEnabled: false,
  dropdownSearchPropertyPanelEnabled: false,
  highQualityBlockImageScale: 1750
});

[
  'enabled',
  'debuggerTabEnabled',
  'functionUsageEnabled',
  'consoleDebuggingEnabled',
  'boostModeControlVisible',
  'boostModeEnabled',
  'labTabEnabled',
  'turboModeEnabled',
  'dropdownSearchEnabled',
  'blockTextCopyEnabled',
  'pictureToolsEnabled',
  'frameProfilerEnabled',
  'singleBlockDragEnabled',
  'highQualityBlockImageEnabled',
  'functionLibraryEnabled',
  'functionPrivateVariablesEnabled'
].forEach((key) => {
  assert.strictEqual(disabled[key], false, key + ' must be disabled globally');
});
assert.strictEqual(disabled.dropdownSearchBlockMenuEnabled, false);
assert.strictEqual(disabled.dropdownSearchPropertyPanelEnabled, false);
assert.strictEqual(disabled.highQualityBlockImageScale, 1750);

const debuggerDisabled = normalize({
  debuggerTabEnabled: false,
  labTabEnabled: true,
  turboModeEnabled: true,
  functionLibraryEnabled: true,
  frameProfilerEnabled: true
});
assert.strictEqual(debuggerDisabled.labTabEnabled, false);
assert.strictEqual(debuggerDisabled.turboModeEnabled, false);
assert.strictEqual(debuggerDisabled.functionLibraryEnabled, false);
assert.strictEqual(debuggerDisabled.frameProfilerEnabled, false);

const labDisabled = normalize({
  labTabEnabled: false,
  turboModeEnabled: true,
  functionLibraryEnabled: true,
  frameProfilerEnabled: true
});
assert.strictEqual(labDisabled.turboModeEnabled, false);
assert.strictEqual(labDisabled.functionLibraryEnabled, false);
assert.strictEqual(labDisabled.frameProfilerEnabled, false);

const hiddenBoost = normalize({
  boostModeControlVisible: false,
  boostModeEnabled: true
});
assert.strictEqual(hiddenBoost.boostModeControlVisible, false);
assert.strictEqual(hiddenBoost.boostModeEnabled, false);

[
  [undefined, 1000],
  ['not-a-number', 1000],
  [199, 200],
  [200, 200],
  [1234.6, 1235],
  [2000, 2000],
  [2001, 2000],
  [Infinity, 1000]
].forEach(([input, expected]) => {
  assert.strictEqual(
    Settings.normalizeHighQualityBlockImageScale(input),
    expected,
    'scale normalization failed for ' + String(input)
  );
});

const countInput = normalize({
  debuggerTabEnabled: true,
  functionUsageEnabled: false,
  consoleDebuggingEnabled: true,
  boostModeControlVisible: false,
  singleBlockDragEnabled: true,
  pictureToolsEnabled: false,
  functionPrivateVariablesEnabled: true,
  labTabEnabled: true
});
const expectedCount = Settings.MAIN_FEATURE_KEYS.reduce(
  (count, key) => count + (countInput[key] ? 1 : 0),
  0
);
assert.strictEqual(Settings.getEnabledMainFeatureCount(countInput), expectedCount);

console.log('[check-settings] OK');
