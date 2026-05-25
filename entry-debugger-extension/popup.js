/**
 * popup.js - 팝업 UI 로직
 *
 * 전체 기능, 디버깅 탭, 함수 내부 사용 위치 바로가기, 콘솔 디버깅, 함수 안 개인변수, 부스트 모드, 실험실 탭을 각각 제어하고,
 * 현재 Entry 페이지 연결 상태를 표시합니다.
 */
'use strict';

var SharedSettings = window.EntryDebuggerSettings;
var DEFAULT_SETTINGS = SharedSettings.DEFAULT_SETTINGS;
var normalizeSettings = SharedSettings.normalize;

var allToggle = document.getElementById('toggle-all');
var debuggerTabToggle = document.getElementById('toggle-debugger-tab');
var functionUsageToggle = document.getElementById('toggle-function-usage');
var consoleDebuggingToggle = document.getElementById('toggle-console-debugging');
var functionPrivateVariablesToggle = document.getElementById('toggle-function-private-variables');
var boostModeToggle = document.getElementById('toggle-boost-mode');
var labTabToggle = document.getElementById('toggle-lab-tab');
var statusDot = document.getElementById('status-dot');
var statusText = document.getElementById('status-text');
var refreshHint = document.getElementById('refresh-hint');

var currentSettings = DEFAULT_SETTINGS;
var isRendering = false;

/* ═══════════════════════════════════════════
   1. 초기 상태 로드
   ═══════════════════════════════════════════ */

chrome.runtime.sendMessage({ type: 'GET_STATE' }, function (response) {
  currentSettings = normalizeSettings(response);
  renderControls();
  updateStatusDisplay();
});

/* ═══════════════════════════════════════════
   2. 토글 변경 핸들러
   ═══════════════════════════════════════════ */

allToggle.addEventListener('change', function () {
  if (isRendering) return;

  var enabled = allToggle.checked;
  saveSettings({
    enabled: enabled,
    debuggerTabEnabled: enabled,
    functionUsageEnabled: enabled,
    consoleDebuggingEnabled: enabled,
    functionPrivateVariablesEnabled: enabled,
    boostModeEnabled: enabled,
    labTabEnabled: enabled,
    eoUploaderEnabled: false,
    turboModeEnabled: enabled ? currentSettings.turboModeEnabled : false,
    dropdownSearchEnabled: enabled ? currentSettings.dropdownSearchEnabled : false,
    blockTextCopyEnabled: enabled ? currentSettings.blockTextCopyEnabled : false,
    highQualityBlockImageEnabled: enabled ? currentSettings.highQualityBlockImageEnabled : false
  });
});

debuggerTabToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettingsFromControls();
});

functionUsageToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettingsFromControls();
});

consoleDebuggingToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettingsFromControls();
});

functionPrivateVariablesToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettingsFromControls();
});

boostModeToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettingsFromControls();
});

labTabToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettingsFromControls();
});

function saveSettingsFromControls() {
  saveSettings({
    enabled: isAnyFeatureChecked(),
    debuggerTabEnabled: debuggerTabToggle.checked,
    functionUsageEnabled: functionUsageToggle.checked,
    consoleDebuggingEnabled: consoleDebuggingToggle.checked,
    functionPrivateVariablesEnabled: functionPrivateVariablesToggle.checked,
    boostModeEnabled: boostModeToggle.checked,
    labTabEnabled: debuggerTabToggle.checked && labTabToggle.checked,
    eoUploaderEnabled: debuggerTabToggle.checked && labTabToggle.checked
      ? currentSettings.eoUploaderEnabled
      : false,
    turboModeEnabled: debuggerTabToggle.checked && labTabToggle.checked
      ? currentSettings.turboModeEnabled
      : false,
    dropdownSearchEnabled: debuggerTabToggle.checked && labTabToggle.checked
      ? currentSettings.dropdownSearchEnabled
      : false,
    blockTextCopyEnabled: debuggerTabToggle.checked && labTabToggle.checked
      ? currentSettings.blockTextCopyEnabled
      : false,
    highQualityBlockImageEnabled: debuggerTabToggle.checked && labTabToggle.checked
      ? currentSettings.highQualityBlockImageEnabled
      : false
  });
}

/* ═══════════════════════════════════════════
   3. 설정 저장/렌더링
   ═══════════════════════════════════════════ */

function saveSettings(nextSettings) {
  currentSettings = normalizeSettings(nextSettings);
  renderControls();

  chrome.runtime.sendMessage({
    type: 'SET_SETTINGS',
    settings: currentSettings
  }, function (response) {
    if (response && response.settings) {
      currentSettings = normalizeSettings(response.settings);
      renderControls();
    }

    refreshHint.classList.add('visible');
    setTimeout(updateStatusDisplay, 200);
  });
}

function renderControls() {
  isRendering = true;
  var enabledCount = getEnabledFeatureCount();
  var mainFeatureCount = SharedSettings.MAIN_FEATURE_KEYS.length;
  allToggle.checked = currentSettings.enabled && enabledCount === mainFeatureCount;
  allToggle.indeterminate = currentSettings.enabled && enabledCount > 0 && enabledCount < mainFeatureCount;
  debuggerTabToggle.checked = currentSettings.debuggerTabEnabled;
  functionUsageToggle.checked = currentSettings.functionUsageEnabled;
  consoleDebuggingToggle.checked = currentSettings.consoleDebuggingEnabled;
  functionPrivateVariablesToggle.checked = currentSettings.functionPrivateVariablesEnabled;
  boostModeToggle.checked = currentSettings.boostModeEnabled;
  labTabToggle.checked = currentSettings.labTabEnabled;
  labTabToggle.disabled = !currentSettings.debuggerTabEnabled;
  isRendering = false;
}

function isAnyFeatureChecked() {
  return debuggerTabToggle.checked ||
    functionUsageToggle.checked ||
    consoleDebuggingToggle.checked ||
    functionPrivateVariablesToggle.checked ||
    boostModeToggle.checked ||
    labTabToggle.checked;
}

function getEnabledFeatureCount() {
  return SharedSettings.getEnabledMainFeatureCount(currentSettings);
}

/* ═══════════════════════════════════════════
   4. 상태 표시 업데이트
   ═══════════════════════════════════════════ */

function updateStatusDisplay() {
  if (!currentSettings.enabled) {
    statusDot.className = 'popup-status-dot disabled';
    statusText.textContent = '모든 기능 꺼짐';
    return;
  }

  chrome.runtime.sendMessage({ type: 'GET_PAGE_STATUS' }, function (response) {
    if (response && response.onEntryPage) {
      statusDot.className = 'popup-status-dot connected';
      statusText.textContent = getEnabledFeatureText() + ' · 엔트리 페이지 연결됨';
    } else {
      statusDot.className = 'popup-status-dot disconnected';
      statusText.textContent = getEnabledFeatureText() + ' · 엔트리 페이지가 아닙니다';
    }
  });
}

function getEnabledFeatureText() {
  var enabledFeatures = [];
  if (currentSettings.debuggerTabEnabled) {
    enabledFeatures.push('디버깅 탭');
  }
  if (currentSettings.functionUsageEnabled) {
    enabledFeatures.push('함수 바로가기');
  }
  if (currentSettings.consoleDebuggingEnabled) {
    enabledFeatures.push('콘솔 디버깅');
  }
  if (currentSettings.functionPrivateVariablesEnabled) {
    enabledFeatures.push('개인변수 표시');
  }
  if (currentSettings.boostModeEnabled) {
    enabledFeatures.push('부스트 모드');
  }
  if (currentSettings.labTabEnabled) {
    enabledFeatures.push('실험실 탭');
  }
  if (enabledFeatures.length === SharedSettings.MAIN_FEATURE_KEYS.length) {
    return '모든 기능 켜짐';
  }
  if (enabledFeatures.length > 0) {
    return enabledFeatures.join(', ') + ' 켜짐';
  }
  return '모든 기능 꺼짐';
}
