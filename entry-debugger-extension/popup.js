/**
 * popup.js - 팝업 UI 로직
 *
 * 전체 기능, 디버깅 탭, 함수 내부 사용 위치 바로가기를 각각 제어하고,
 * 현재 Entry 페이지 연결 상태를 표시합니다.
 */
'use strict';

var DEFAULT_SETTINGS = {
  enabled: true,
  debuggerTabEnabled: true,
  functionUsageEnabled: true
};

var allToggle = document.getElementById('toggle-all');
var debuggerTabToggle = document.getElementById('toggle-debugger-tab');
var functionUsageToggle = document.getElementById('toggle-function-usage');
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
    functionUsageEnabled: enabled
  });
});

debuggerTabToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettings({
    enabled: debuggerTabToggle.checked || functionUsageToggle.checked,
    debuggerTabEnabled: debuggerTabToggle.checked,
    functionUsageEnabled: functionUsageToggle.checked
  });
});

functionUsageToggle.addEventListener('change', function () {
  if (isRendering) return;

  saveSettings({
    enabled: debuggerTabToggle.checked || functionUsageToggle.checked,
    debuggerTabEnabled: debuggerTabToggle.checked,
    functionUsageEnabled: functionUsageToggle.checked
  });
});

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
  allToggle.checked = currentSettings.enabled &&
    currentSettings.debuggerTabEnabled &&
    currentSettings.functionUsageEnabled;
  debuggerTabToggle.checked = currentSettings.debuggerTabEnabled;
  functionUsageToggle.checked = currentSettings.functionUsageEnabled;
  isRendering = false;
}

function normalizeSettings(settings) {
  settings = settings || DEFAULT_SETTINGS;

  var enabled = settings.enabled !== false;
  var debuggerTabEnabled = typeof settings.debuggerTabEnabled === 'boolean'
    ? settings.debuggerTabEnabled
    : enabled;
  var functionUsageEnabled = typeof settings.functionUsageEnabled === 'boolean'
    ? settings.functionUsageEnabled
    : enabled;

  enabled = !!(enabled && (debuggerTabEnabled || functionUsageEnabled));

  if (!enabled) {
    debuggerTabEnabled = false;
    functionUsageEnabled = false;
  }

  return {
    enabled: enabled,
    debuggerTabEnabled: enabled && debuggerTabEnabled,
    functionUsageEnabled: enabled && functionUsageEnabled
  };
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
  if (currentSettings.debuggerTabEnabled && currentSettings.functionUsageEnabled) {
    return '모든 기능 켜짐';
  }
  if (currentSettings.debuggerTabEnabled) {
    return '디버깅 탭만 켜짐';
  }
  if (currentSettings.functionUsageEnabled) {
    return '함수 바로가기만 켜짐';
  }
  return '모든 기능 꺼짐';
}
