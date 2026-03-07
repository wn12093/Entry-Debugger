/**
 * background.js - Service Worker (MV3)
 *
 * 확장 프로그램의 ON/OFF 상태를 관리하고,
 * 팝업(popup)과 콘텐츠 스크립트(content.js) 사이의
 * 메시지를 중계합니다.
 *
 * 메시지 프로토콜:
 *   GET_STATE       → { enabled: boolean }
 *   SET_STATE       → 상태 저장 + 콘텐츠 스크립트 브로드캐스트
 *   GET_PAGE_STATUS → 현재 탭의 Entry 페이지 여부 조회
 */
'use strict';

/* ═══════════════════════════════════════════
   1. 설치 시 기본값 설정
   ═══════════════════════════════════════════ */

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.storage.local.set({ enabled: true });
  }
});

/* ═══════════════════════════════════════════
   2. 메시지 핸들러
   ═══════════════════════════════════════════ */

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {

  switch (message.type) {

    /* ── 현재 토글 상태 조회 ── */
    case 'GET_STATE':
      chrome.storage.local.get({ enabled: true }, function (data) {
        sendResponse({ enabled: data.enabled });
      });
      return true; // 비동기 sendResponse

    /* ── 토글 상태 변경 + 브로드캐스트 ── */
    case 'SET_STATE':
      var newState = message.enabled;
      chrome.storage.local.set({ enabled: newState }, function () {
        // 열려 있는 모든 Entry 워크스페이스 탭에 알림
        chrome.tabs.query({ url: 'https://playentry.org/ws/*' }, function (tabs) {
          tabs.forEach(function (tab) {
            chrome.tabs.sendMessage(tab.id, {
              type: newState ? 'ENABLE_DEBUGGER' : 'DISABLE_DEBUGGER'
            }).catch(function () {
              // 콘텐츠 스크립트 미로딩 탭 무시
            });
          });
        });
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
