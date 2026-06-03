/**
 * popup.js - 팝업 UI 로직
 *
 * 팝업은 엔트리 화면 안의 디버깅 탭 표시 여부만 제어한다.
 * 세부 기능 설정은 디버깅 탭 안의 설정 화면에서 관리한다.
 */
'use strict';

var SharedSettings = window.EntryDebuggerSettings;
var DEFAULT_SETTINGS = SharedSettings.DEFAULT_SETTINGS;
var normalizeSettings = SharedSettings.normalize;

var debuggerTabToggle = document.getElementById('toggle-debugger-tab');
var statusDot = document.getElementById('status-dot');
var statusText = document.getElementById('status-text');
var popupVersion = document.getElementById('popup-version');

var currentSettings = DEFAULT_SETTINGS;
var isRendering = false;

chrome.runtime.sendMessage({ type: 'GET_STATE' }, function (response) {
  currentSettings = normalizeSettings(response);
  renderVersion();
  renderControls();
  updateStatusDisplay();
});

function renderVersion() {
  if (!popupVersion || !chrome.runtime || typeof chrome.runtime.getManifest !== 'function') {
    return;
  }

  popupVersion.textContent = 'v' + chrome.runtime.getManifest().version;
}

debuggerTabToggle.addEventListener('change', function () {
  if (isRendering) return;
  saveDebuggerTabSetting(debuggerTabToggle.checked);
});

function saveDebuggerTabSetting(enabled) {
  currentSettings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, currentSettings, {
    enabled: true,
    debuggerTabEnabled: !!enabled,
    labTabEnabled: enabled ? currentSettings.labTabEnabled : false
  }));
  renderControls();

  chrome.runtime.sendMessage({
    type: 'SET_SETTINGS',
    settings: currentSettings
  }, function (response) {
    if (response && response.settings) {
      currentSettings = normalizeSettings(response.settings);
      renderControls();
    }

    setTimeout(updateStatusDisplay, 200);
  });
}

function renderControls() {
  isRendering = true;
  debuggerTabToggle.checked = !!currentSettings.debuggerTabEnabled;
  isRendering = false;
}

function updateStatusDisplay() {
  if (!currentSettings.debuggerTabEnabled) {
    statusDot.className = 'popup-status-dot disabled';
    statusText.textContent = '디버깅 탭 꺼짐';
    return;
  }

  chrome.runtime.sendMessage({ type: 'GET_PAGE_STATUS' }, function (response) {
    if (response && response.onEntryPage) {
      statusDot.className = 'popup-status-dot connected';
      statusText.textContent = '디버깅 탭 켜짐 · 엔트리 페이지 연결됨';
    } else {
      statusDot.className = 'popup-status-dot disconnected';
      statusText.textContent = '디버깅 탭 켜짐 · 엔트리 페이지가 아닙니다';
    }
  });
}
