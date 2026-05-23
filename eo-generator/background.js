/**
 * background.js - 확장 아이콘을 누르면 전체 화면 생성기 탭을 엽니다.
 */
'use strict';

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({
    url: chrome.runtime.getURL('app/index.html')
  });
});
