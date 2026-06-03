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

importScripts('settings.js');

var SharedSettings = self.EntryDebuggerSettings;
var DEFAULT_SETTINGS = SharedSettings.DEFAULT_SETTINGS;
var normalizeSettings = SharedSettings.normalize;

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
    'https://playentry.org/ws/*'
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
    return;
  }

  if (details.reason === 'update') {
    chrome.storage.local.get(DEFAULT_SETTINGS, function (data) {
      chrome.storage.local.set(normalizeSettings(Object.assign({}, data, {
        boostModeControlVisible: false,
        boostModeEnabled: false
      })));
    });
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
        boostModeControlVisible: newState,
        boostModeEnabled: false,
        functionPrivateVariablesEnabled: newState,
        labTabEnabled: newState,
        eoUploaderEnabled: false,
        turboModeEnabled: false,
        dropdownSearchEnabled: false,
        dropdownSearchBlockMenuEnabled: true,
        dropdownSearchPropertyPanelEnabled: true,
        blockTextCopyEnabled: false,
        highQualityBlockImageEnabled: false,
        highQualityBlockImageScale: 1000,
        functionLibraryEnabled: false
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
