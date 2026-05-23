/**
 * background.js - Service Worker (MV3)
 *
 * 확장 프로그램의 ON/OFF 상태를 관리하고,
 * 팝업(popup)과 콘텐츠 스크립트(content.js) 사이의
 * 메시지를 중계합니다.
 *
 * 메시지 프로토콜:
 *   GET_STATE       → 전체 기능 설정 조회
 *   SET_STATE       → 구버전 전체 ON/OFF 호환 메시지
 *   SET_SETTINGS    → 기능별 설정 저장 + 콘텐츠 스크립트 브로드캐스트
 *   GET_PAGE_STATUS → 현재 탭의 Entry 페이지 여부 조회
 */
'use strict';

var DEFAULT_SETTINGS = {
  enabled: true,
  debuggerTabEnabled: true,
  functionUsageEnabled: true,
  consoleDebuggingEnabled: true,
  boostModeEnabled: false,
  labTabEnabled: false,
  turboModeEnabled: false
};

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
  var turboModeEnabled = typeof data.turboModeEnabled === 'boolean'
    ? data.turboModeEnabled
    : false;

  if (!debuggerTabEnabled) {
    labTabEnabled = false;
  }

  if (!labTabEnabled) {
    turboModeEnabled = false;
  }

  if (!enabled) {
    debuggerTabEnabled = false;
    functionUsageEnabled = false;
    consoleDebuggingEnabled = false;
    boostModeEnabled = false;
    labTabEnabled = false;
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

  return {
    enabled: enabled,
    debuggerTabEnabled: enabled && debuggerTabEnabled,
    functionUsageEnabled: enabled && functionUsageEnabled,
    consoleDebuggingEnabled: enabled && consoleDebuggingEnabled,
    boostModeEnabled: enabled && boostModeEnabled,
    labTabEnabled: enabled && labTabEnabled,
    turboModeEnabled: enabled && turboModeEnabled
  };
}

function getSettings(callback) {
  chrome.storage.local.get(DEFAULT_SETTINGS, function (data) {
    callback(normalizeSettings(data));
  });
}

function saveSettings(nextSettings, callback) {
  chrome.storage.local.set(normalizeSettings(nextSettings), callback);
}

function broadcastSettings(settings) {
  chrome.tabs.query({ url: [
    'https://playentry.org/ws/*',
    'http://localhost/ws/*',
    'http://127.0.0.1/ws/*'
  ] }, function (tabs) {
    tabs.forEach(function (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_SETTINGS',
        settings: settings
      }).catch(function () {
        // 콘텐츠 스크립트 미로딩 탭 무시
      });
    });
  });
}

/* ═══════════════════════════════════════════
   1. 설치 시 기본값 설정
   ═══════════════════════════════════════════ */

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.storage.local.set(DEFAULT_SETTINGS);
  }
});

/* ═══════════════════════════════════════════
   2. 메시지 핸들러
   ═══════════════════════════════════════════ */

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {

  switch (message.type) {

    /* ── 현재 토글 상태 조회 ── */
    case 'GET_STATE':
      getSettings(function (settings) {
        sendResponse(settings);
      });
      return true; // 비동기 sendResponse

    /* ── 구버전 전체 토글 상태 변경 + 브로드캐스트 ── */
    case 'SET_STATE':
      var newState = message.enabled !== false;
      saveSettings({
        enabled: newState,
        debuggerTabEnabled: newState,
        functionUsageEnabled: newState,
        consoleDebuggingEnabled: newState,
        boostModeEnabled: newState,
        labTabEnabled: newState,
        turboModeEnabled: false
      }, function () {
        getSettings(function (settings) {
          broadcastSettings(settings);
          sendResponse({ success: true, settings: settings });
        });
      });
      return true; // 비동기 sendResponse

    /* ── 기능별 설정 변경 + 브로드캐스트 ── */
    case 'SET_SETTINGS':
      saveSettings(message.settings || DEFAULT_SETTINGS, function () {
        getSettings(function (settings) {
          broadcastSettings(settings);
          sendResponse({ success: true, settings: settings });
        });
      });
      return true; // 비동기 sendResponse

    /* ── 현재 설정만 열린 탭에 다시 적용 ── */
    case 'BROADCAST_SETTINGS':
      getSettings(function (settings) {
        broadcastSettings(settings);
        sendResponse({ success: true });
      });
      return true; // 비동기 sendResponse

    /* ── 현재 활성 탭의 Entry 페이지 여부 조회 ── */
    /* tabs 권한 없이도 동작하도록 URL 사전 체크 없이
       content script에 직접 PING_STATUS를 보냄.
       content script가 로딩되어 있으면 응답, 아니면 catch 처리. */
    case 'OPEN_EO_GENERATOR':
      chrome.tabs.create({
        url: chrome.runtime.getURL('eo-generator/index.html')
      }, function (tab) {
        sendResponse({
          success: !chrome.runtime.lastError,
          tabId: tab && tab.id,
          error: chrome.runtime.lastError && chrome.runtime.lastError.message
        });
      });
      return true;

    case 'GET_PAGE_STATUS':
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'PING_STATUS' })
            .then(function (response) {
              sendResponse(response || { onEntryPage: false });
            })
            .catch(function () {
              sendResponse({ onEntryPage: false });
            });
        } else {
          sendResponse({ onEntryPage: false });
        }
      });
      return true; // 비동기 sendResponse
  }
});
