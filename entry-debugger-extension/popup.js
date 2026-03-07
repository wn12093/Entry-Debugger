/**
 * popup.js - 팝업 UI 로직
 *
 * 토글 스위치로 확장 프로그램의 활성화/비활성화를 제어하고,
 * 현재 상태를 표시합니다.
 *
 * 메시지 흐름:
 *   popup.js → background.js → content.js
 */
'use strict';

var toggleCheckbox = document.getElementById('toggle-enabled');
var statusDot = document.getElementById('status-dot');
var statusText = document.getElementById('status-text');
var refreshHint = document.getElementById('refresh-hint');

/* ═══════════════════════════════════════════
   1. 초기 상태 로드
   ═══════════════════════════════════════════ */

chrome.runtime.sendMessage({ type: 'GET_STATE' }, function (response) {
  if (response) {
    toggleCheckbox.checked = response.enabled;
  }
  updateStatusDisplay();
});

/* ═══════════════════════════════════════════
   2. 토글 변경 핸들러
   ═══════════════════════════════════════════ */

toggleCheckbox.addEventListener('change', function () {
  var newState = toggleCheckbox.checked;

  chrome.runtime.sendMessage({
    type: 'SET_STATE',
    enabled: newState
  }, function () {
    // 새로고침 안내 표시
    refreshHint.classList.add('visible');

    // 콘텐츠 스크립트 처리 대기 후 상태 갱신
    setTimeout(updateStatusDisplay, 200);
  });
});

/* ═══════════════════════════════════════════
   3. 상태 표시 업데이트
   ═══════════════════════════════════════════ */

function updateStatusDisplay() {
  // 토글 OFF → 비활성화 상태 표시
  if (!toggleCheckbox.checked) {
    statusDot.className = 'popup-status-dot disabled';
    statusText.textContent = '비활성화됨';
    return;
  }

  // 토글 ON → Entry 페이지 연결 여부 확인
  chrome.runtime.sendMessage({ type: 'GET_PAGE_STATUS' }, function (response) {
    if (response && response.onEntryPage) {
      statusDot.className = 'popup-status-dot connected';
      statusText.textContent = '엔트리 페이지 연결됨';
    } else {
      statusDot.className = 'popup-status-dot disconnected';
      statusText.textContent = '엔트리 페이지가 아닙니다';
    }
  });
}
