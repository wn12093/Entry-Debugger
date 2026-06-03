/**
 * content.js - Content Script (Isolated World)
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │  독립 [디버깅] 탭 방식                                      │
 * │                                                            │
 * │  기존 콘솔 탭을 건드리지 않고,                               │
 * │  새로운 [디버깅] 탭(.propertyTabdebugging)을 추가합니다.     │
 * │  디버깅 탭 클릭 시 디버거 패널을 표시하고                    │
 * │  다른 탭 클릭 시 디버거 패널을 숨깁니다.                     │
 * │                                                            │
 * │  [.propertyTab]  (25px 아이콘 탭)                           │
 * │    ├─ .propertyTabobject                                    │
 * │    ├─ .propertyTabhelper                                    │
 * │    ├─ .propertyTabconsole   ← 기존 콘솔 유지                │
 * │    └─ .propertyTabdebugging ← 새로 추가된 디버깅 탭         │
 * │                                                            │
 * │  [.propertyContent]                                        │
 * │    ├─ (Entry 네이티브 콘텐츠들)                              │
 * │    └─ #ed-debugger-panel   ← 디버거 UI 주입                 │
 * └────────────────────────────────────────────────────────────┘
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     상수 & 상태
     ═══════════════════════════════════════════ */

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const MAX_WAIT_MS = 30000;
  const WAIT_INTERVAL = 500;

  const TAB_CLASS      = 'propertyTabElement';
  const DEBUGGING_TAB  = 'propertyTabdebugging';
  const PANEL_ID       = 'ed-debugger-panel';
  const BOOST_MODE_STORAGE_KEY = '__ENTRY_DEBUGGER_BOOST_MODE_ENABLED__';
  const PAGE_CORE_SCRIPTS = [
    ['entry-debugger-hangul-search', 'hangul-search.js'],
    ['entry-debugger-page-bridge', 'page-bridge.js'],
    ['entry-debugger-entry-adapter', 'entry-adapter.js'],
    ['entry-debugger-patch-registry', 'patch-registry.js']
  ];

  const SharedSettings = window.EntryDebuggerSettings;
  const HangulSearch = window.EntryDebuggerHangulSearch || null;
  const FunctionLibraryTemplates = Array.isArray(window.EntryDebuggerFunctionLibraryTemplates)
    ? window.EntryDebuggerFunctionLibraryTemplates
    : [];
  const DEFAULT_SETTINGS = SharedSettings.DEFAULT_SETTINGS;
  const normalizeSettings = SharedSettings.normalize;
  const normalizeHighQualityBlockImageScale = SharedSettings.normalizeHighQualityBlockImageScale;

  let debuggerInjected = false;
  let currentSnapshot = { variables: [], lists: [], messages: [], scenes: [], others: [], ready: false };
  let panelEl = null;          // 디버거 패널 (#ed-debugger-panel)
  let debuggingTabEl = null;   // 디버깅 탭 버튼 (.propertyTabdebugging)
  let isDebuggerActive = false;
  let extensionSettings = DEFAULT_SETTINGS;
  let settingsLoaded = false;
  let functionUsageStartTimer = null;
  let pageCoreScriptsInjected = false;
  let dropdownSearchScriptInjected = false;
  let blockTextCopyScriptInjected = false;
  let highQualityBlockImageScriptInjected = false;
  let expandedListIds = new Set();  // 리스트 펼침 상태 추적
  let eoUploader = null;

  /* ═══════════════════════════════════════════
     1. Main World 스크립트 주입
     ═══════════════════════════════════════════ */

  function injectDebuggerScript() {
    injectPageCoreScripts();
    injectPageScript('entry-debugger-inject', 'inject.js');
  }

  function injectFunctionUsageScript() {
    injectPageCoreScripts();
    injectPageScript('entry-debugger-function-usage', 'function-usage-inspector.js');
  }

  function injectConsoleDebuggingScript() {
    injectPageCoreScripts();
    injectPageScript('entry-debugger-console-debugging', 'console-debugging.js');
  }

  function injectBoostModeScript() {
    injectPageCoreScripts();
    injectPageScript('entry-debugger-boost-mode', 'boost-mode.js');
  }

  function injectTurboModeScript() {
    injectPageCoreScripts();
    injectPageScript('entry-debugger-turbo-mode', 'turbo-mode.js');
  }

  function injectFunctionPrivateVariablesScript() {
    injectPageCoreScripts();
    injectPageScript('entry-debugger-function-private-variables', 'function-private-variables.js');
  }

  function injectDropdownSearchScript() {
    injectPageCoreScripts();
    dropdownSearchScriptInjected = true;
    injectPageScript('entry-debugger-dropdown-search', 'dropdown-search.js');
  }

  function injectBlockTextCopyScript() {
    injectPageCoreScripts();
    blockTextCopyScriptInjected = true;
    injectPageScript('entry-debugger-block-text-copy', 'block-text-copy.js');
  }

  function injectHighQualityBlockImageScript() {
    injectPageCoreScripts();
    highQualityBlockImageScriptInjected = true;
    injectPageScript('entry-debugger-high-quality-block-image', 'high-quality-block-image.js');
  }

  function injectPageCoreScripts() {
    if (pageCoreScriptsInjected) return;
    pageCoreScriptsInjected = true;
    PAGE_CORE_SCRIPTS.forEach(function (scriptInfo) {
      injectPageScript(scriptInfo[0], scriptInfo[1]);
    });
  }

  function injectPageScript(id, src) {
    if (document.getElementById(id)) return;

    var script = document.createElement('script');
    script.id = id;
    script.async = false;
    script.src = chrome.runtime.getURL(src);
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  injectBoostModeScript();

  /* ═══════════════════════════════════════════
     2. DOM 대기 유틸리티
     ═══════════════════════════════════════════ */

  function waitForElement(selector, callback) {
    var startTime = Date.now();

    var existing = document.querySelector(selector);
    if (existing) {
      callback(existing);
      return;
    }

    var observer = new MutationObserver(function () {
      var el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        callback(el);
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    function check() {
      var el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        callback(el);
        return;
      }
      if (Date.now() - startTime > MAX_WAIT_MS) {
        observer.disconnect();
        console.warn('[Entry Debugger] 시간 초과: ' + selector);
        return;
      }
      setTimeout(check, WAIT_INTERVAL);
    }

    setTimeout(check, 2000);
  }

  /* ═══════════════════════════════════════════
     3. 디버거 패널 주입
        .propertyContent 안에 디버거 UI를 삽입하고
        초기 상태는 display:none 으로 숨김
     ═══════════════════════════════════════════ */

  function injectDebuggerPanel(propertyContent) {
    if (document.getElementById(PANEL_ID)) return;

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.style.display = 'none';
    panelEl.innerHTML = buildPanelHTML();

    propertyContent.appendChild(panelEl);
    bindPanelEvents();
  }

  /* ═══════════════════════════════════════════
     3.5. 디버깅 탭 버튼 생성
          .propertyTab 마지막에 디버깅 탭을 추가
     ═══════════════════════════════════════════ */

  function createDebuggingTab(propertyTab) {
    // 이미 존재하면 참조만 저장
    var existing = propertyTab.querySelector('.' + DEBUGGING_TAB);
    if (existing) {
      debuggingTabEl = existing;
      return;
    }

    debuggingTabEl = document.createElement('div');
    debuggingTabEl.className = TAB_CLASS + ' ' + DEBUGGING_TAB;
    debuggingTabEl.textContent = '디버깅';  // font-size:0 이므로 보이지 않지만 접근성용
    debuggingTabEl.setAttribute('title', '디버깅');
    debuggingTabEl.setAttribute('aria-label', '디버깅');
    propertyTab.appendChild(debuggingTabEl);
  }

  /* ═══════════════════════════════════════════
     4. 디버깅 탭 클릭 처리 (이벤트 위임)
     ═══════════════════════════════════════════ */

  /**
   * .propertyTab 부모에 이벤트 위임을 등록합니다.
   *
   * (A) 디버깅 탭(.propertyTabdebugging) 클릭 감지:
   *     → 디버거 패널 표시
   *
   * (B) 다른 탭(오브젝트/도움말/콘솔) 클릭 감지:
   *     → 디버거 패널 숨기기
   *     (엔트리 네이티브가 자체 패널을 알아서 표시)
   *
   * 이벤트 위임이므로 SPA 재렌더링으로 탭 DOM이
   * 파괴→재생성되어도 리스너가 유지됩니다.
   */
  function setupTabDelegation(propertyTab) {
    if (propertyTab.dataset.entryDebuggerDelegation === 'true') return;
    propertyTab.dataset.entryDebuggerDelegation = 'true';

    propertyTab.addEventListener('click', function (e) {
      var clickedTab = e.target.closest('.' + TAB_CLASS);
      if (!clickedTab) return;

      if (clickedTab.classList.contains(DEBUGGING_TAB)) {
        // ── (A) 디버깅 탭 클릭 → 디버거 활성화 ──
        activateDebugger();
      } else {
        // ── (B) 네이티브 탭 클릭 → 디버거 비활성화 ──
        deactivateDebugger();
      }
    });
  }

  /**
   * 디버거 활성화:
   * - 모든 네이티브 탭에서 selected 제거
   * - 디버깅 탭에 selected 추가
   * - 디버거 패널을 표시 (absolute 오버레이로 네이티브 콘텐츠 위에 덮음)
   *
   * 참고: 디버깅 탭은 Entry 네이티브가 인식하지 못하는 탭이므로
   *       Entry의 클릭 핸들러가 아무 동작도 하지 않습니다.
   *       네이티브 콘텐츠의 display를 건드리지 않고 오버레이 방식으로
   *       패널을 표시하므로 Entry의 탭 전환 로직과 충돌하지 않습니다.
   */
  function activateDebugger() {
    if (!isDebuggerTabFeatureEnabled()) return;
    if (!panelEl) return;

    // 1. 모든 탭에서 selected 제거
    var propertyTab = document.querySelector('.propertyTab');
    if (propertyTab) {
      propertyTab.querySelectorAll('.' + TAB_CLASS).forEach(function (tab) {
        tab.classList.remove('selected');
      });
    }

    // 2. 디버깅 탭에 selected 추가
    if (debuggingTabEl) {
      debuggingTabEl.classList.add('selected');
    }

    // 3. 디버거 패널 표시 (absolute 오버레이)
    panelEl.style.display = 'block';
    isDebuggerActive = true;

    // 폴링 시작
    sendToInject('START_POLLING');
    sendToInject('REQUEST_SNAPSHOT');
  }

  /**
   * 디버거 비활성화:
   * - 디버깅 탭에서 selected 제거
   * - 디버거 패널 숨기기
   *
   * 참고: 네이티브 탭 클릭 시 Entry가 이미 해당 탭에 selected를 추가하고
   *       해당 콘텐츠를 표시하므로, 우리는 디버거 상태만 정리하면 됩니다.
   *       오버레이 방식이므로 네이티브 콘텐츠의 display를 복원할 필요 없음.
   */
  function deactivateDebugger() {
    if (!isDebuggerActive) return;

    isDebuggerActive = false;
    sendToInject('STOP_POLLING');

    // 1. 디버깅 탭에서 selected 제거
    if (debuggingTabEl) {
      debuggingTabEl.classList.remove('selected');
    }

    // 2. 디버거 패널 숨기기
    if (panelEl) {
      panelEl.style.display = 'none';
    }
  }

  /* ═══════════════════════════════════════════
     5. 디버거 패널 내부 UI 구축
     ═══════════════════════════════════════════ */

  function buildPanelHTML() {
    return (
      '<div class="ed-wrapper">' +
        buildToolbarHTML() +
        buildSearchHTML() +
        '<div class="ed-scroll-area" id="ed-scroll-area">' +
          buildEmptyListSectionHTML({
            id: 'variables',
            emptyId: 'ed-var-empty',
            listId: 'ed-var-list',
            icon: '&#x1F50D;',
            message: '변수가 없거나 Entry가 로드되지 않았습니다.',
            active: true
          }) +
          buildEmptyListSectionHTML({
            id: 'lists',
            emptyId: 'ed-list-empty',
            listId: 'ed-list-list',
            icon: '&#x1F4CB;',
            message: '리스트가 없거나 Entry가 로드되지 않았습니다.'
          }) +
          buildEmptyListSectionHTML({
            id: 'messages',
            emptyId: 'ed-msg-empty',
            listId: 'ed-msg-list',
            icon: '&#x1F4E1;',
            message: '신호가 없거나 Entry가 로드되지 않았습니다.'
          }) +
          buildEmptyListSectionHTML({
            id: 'scenes',
            emptyId: 'ed-scene-empty',
            listId: 'ed-scene-list',
            icon: '&#x1F3AC;',
            message: '장면이 없거나 Entry가 로드되지 않았습니다.'
          }) +
          buildLabSectionHTML() +
          buildUploaderSectionHTML() +
          buildFunctionLibrarySectionHTML() +
        '</div>' +
      '</div>'
    );
  }

  function buildToolbarHTML() {
    return (
        '<div class="ed-toolbar">' +
          '<div class="ed-toolbar-tabs">' +
            '<button class="ed-subtab ed-subtab-active" data-tab="variables">변수</button>' +
            '<button class="ed-subtab" data-tab="lists">리스트</button>' +
            '<button class="ed-subtab" data-tab="messages">신호</button>' +
            '<button class="ed-subtab" data-tab="scenes">장면</button>' +
            '<span class="ed-subtab-separator ed-optional-only" aria-hidden="true"></span>' +
            '<button class="ed-subtab ed-lab-only" data-tab="others">실험실</button>' +
            '<button class="ed-subtab ed-eo-uploader-only" data-tab="generator">업로더</button>' +
            '<button class="ed-subtab ed-function-library-only" data-tab="function-library">함수 보관함</button>' +
          '</div>' +
          '<div class="ed-toolbar-right">' +
            '<button class="ed-icon-btn ed-btn-refresh" id="ed-refresh-btn" title="새로고침">&#x21BB;</button>' +
            '<span class="ed-status" id="ed-status">대기 중</span>' +
          '</div>' +
        '</div>'
    );
  }

  function buildSearchHTML() {
    return (
        '<div class="ed-search-wrap">' +
          '<input type="text" class="ed-search" id="ed-search" placeholder="이름으로 검색..." />' +
        '</div>'
    );
  }

  function buildEmptyListSectionHTML(options) {
    return (
      '<div class="ed-section' + (options.active ? ' ed-section-active' : '') + '" id="ed-section-' + options.id + '">' +
        '<div class="ed-empty" id="' + options.emptyId + '">' +
          '<div class="ed-empty-icon">' + options.icon + '</div>' +
          '<p>' + options.message + '</p>' +
        '</div>' +
        '<div class="ed-items" id="' + options.listId + '"></div>' +
      '</div>'
    );
  }

  function buildLabSectionHTML() {
    return (
      '<div class="ed-section ed-lab-only" id="ed-section-others">' +
            '<div class="ed-lab-warning" role="note">' +
              '<strong>실험실 기능 안내</strong>' +
              '<span>아직 완성되지 않은 기능이 포함되어 있어 오류가 발생할 수 있습니다.</span>' +
            '</div>' +
            '<div class="ed-lab-controls">' +
              '<div class="ed-lab-setting">' +
                '<span class="ed-lab-text">' +
                  '<span class="ed-lab-title">터보 모드</span>' +
                  '<span class="ed-lab-desc">속도 조절 패널에 ∞ 단계 추가</span>' +
                '</span>' +
                '<label class="ed-lab-switch" aria-label="속도 조절에 터보 모드 추가">' +
                  '<input type="checkbox" id="ed-toggle-turbo-mode">' +
                  '<span class="ed-lab-slider"></span>' +
                '</label>' +
              '</div>' +
              '<div class="ed-lab-setting">' +
                '<span class="ed-lab-text">' +
                  '<span class="ed-lab-title">다량 이미지 업로더</span>' +
                  '<span class="ed-lab-desc">실험실 옆에 업로더 탭 표시</span>' +
                '</span>' +
                '<label class="ed-lab-switch" aria-label="다량 이미지 업로더 탭 표시">' +
                  '<input type="checkbox" id="ed-toggle-eo-uploader">' +
                  '<span class="ed-lab-slider"></span>' +
                '</label>' +
              '</div>' +
              '<div class="ed-lab-setting">' +
                '<span class="ed-lab-text">' +
                  '<span class="ed-lab-title">속성 검색으로 찾기</span>' +
                  '<span class="ed-lab-desc">블록꾸러미와 속성 탭에서 검색 기능 사용</span>' +
                '</span>' +
                '<label class="ed-lab-switch" aria-label="속성 검색으로 찾기">' +
                  '<input type="checkbox" id="ed-toggle-dropdown-search">' +
                  '<span class="ed-lab-slider"></span>' +
                '</label>' +
                '<div class="ed-lab-subcontrols" id="ed-dropdown-search-targets">' +
                  '<label class="ed-lab-check">' +
                    '<input type="checkbox" id="ed-toggle-dropdown-search-block-menu">' +
                    '<span class="ed-lab-check-box" aria-hidden="true"></span>' +
                    '<span>블록꾸러미</span>' +
                  '</label>' +
                  '<label class="ed-lab-check">' +
                    '<input type="checkbox" id="ed-toggle-dropdown-search-property-panel">' +
                    '<span class="ed-lab-check-box" aria-hidden="true"></span>' +
                    '<span>속성 탭</span>' +
                  '</label>' +
                '</div>' +
              '</div>' +
              '<div class="ed-lab-setting">' +
                '<span class="ed-lab-text">' +
                  '<span class="ed-lab-title">블록 텍스트 복사</span>' +
                  '<span class="ed-lab-desc">블록 우클릭 메뉴에 텍스트로 복사하기 추가</span>' +
                '</span>' +
                '<label class="ed-lab-switch" aria-label="블록 텍스트 복사">' +
                  '<input type="checkbox" id="ed-toggle-block-text-copy">' +
                  '<span class="ed-lab-slider"></span>' +
                '</label>' +
              '</div>' +
              '<div class="ed-lab-setting">' +
                '<span class="ed-lab-text">' +
                  '<span class="ed-lab-title">초고화질 이미지 저장하기</span>' +
                  '<span class="ed-lab-desc">블록 이미지 저장 배율을 200%에서 2000%까지 조정</span>' +
                '</span>' +
                '<label class="ed-lab-switch" aria-label="초고화질 이미지 저장하기">' +
                  '<input type="checkbox" id="ed-toggle-high-quality-block-image">' +
                  '<span class="ed-lab-slider"></span>' +
                '</label>' +
                '<div class="ed-lab-scale-control" id="ed-high-quality-scale-control">' +
                  '<div class="ed-lab-scale-row">' +
                    '<input class="ed-lab-range" id="ed-high-quality-scale-range" type="range" min="200" max="2000" step="100" value="1000" aria-label="초고화질 저장 배율">' +
                    '<label class="ed-lab-number-label" for="ed-high-quality-scale-input">' +
                      '<input class="ed-lab-number" id="ed-high-quality-scale-input" type="number" min="200" max="2000" step="100" value="1000">' +
                      '<span>%</span>' +
                    '</label>' +
                  '</div>' +
                  '<div class="ed-lab-scale-meta">' +
                    '<strong id="ed-high-quality-scale-warning" class="ed-lab-scale-warning">다운로드에 오래 걸릴 수 있습니다.</strong>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="ed-lab-setting">' +
                '<span class="ed-lab-text">' +
                  '<span class="ed-lab-title">함수 보관함</span>' +
                  '<span class="ed-lab-desc">자주 쓰는 함수를 현재 작품에 추가</span>' +
                '</span>' +
                '<label class="ed-lab-switch" aria-label="함수 보관함 탭 표시">' +
                  '<input type="checkbox" id="ed-toggle-function-library">' +
                  '<span class="ed-lab-slider"></span>' +
                '</label>' +
              '</div>' +
            '</div>' +
            '<div class="ed-empty" id="ed-other-empty">' +
              '<div class="ed-empty-icon">&#x23F1;</div>' +
              '<p>초시계 또는 대답을 찾을 수 없습니다.</p>' +
            '</div>' +
            '<div class="ed-items" id="ed-other-list"></div>' +
      '</div>'
    );
  }

  function buildUploaderSectionHTML() {
    return (
      '<div class="ed-section ed-eo-uploader-only" id="ed-section-generator">' +
            '<div class="ed-generator">' +
              '<label class="ed-generator-label" for="ed-generator-object-name">오브젝트 이름</label>' +
              '<input class="ed-generator-input" id="ed-generator-object-name" type="text" value="새 오브젝트" maxlength="40">' +
              '<input class="ed-generator-file" id="ed-generator-file" type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/png,image/jpeg,image/gif,image/webp,image/svg+xml">' +
              '<button class="ed-generator-drop" id="ed-generator-drop" type="button">' +
                '<span class="ed-generator-drop-title">이미지를 선택하거나 여기에 놓기</span>' +
                '<span class="ed-generator-drop-desc">PNG, JPG, GIF, WEBP는 PNG로 변환하고 SVG는 원본과 PNG 미리보기를 함께 만듭니다. 다운로드한 .eo 파일은 오브젝트 추가하기의 파일 업로드로 넣으세요.</span>' +
              '</button>' +
              '<div class="ed-generator-file-list" id="ed-generator-file-list">선택된 이미지가 없습니다.</div>' +
              '<div class="ed-generator-actions">' +
                '<button class="ed-generator-btn" id="ed-generator-download" type="button" disabled>.eo 다운로드</button>' +
                '<button class="ed-generator-btn" id="ed-generator-clear" type="button" disabled>비우기</button>' +
              '</div>' +
              '<div class="ed-generator-status ed-generator-status-info" id="ed-generator-status">이미지를 추가해 .eo로 저장한 뒤, 엔트리의 오브젝트 추가하기 &gt; 파일 업로드에서 업로드하세요.</div>' +
            '</div>' +
      '</div>'
    );
  }

  function buildFunctionLibrarySectionHTML() {
    return (
      '<div class="ed-section ed-function-library-only" id="ed-section-function-library">' +
        '<div class="ed-function-library">' +
          '<div class="ed-function-library-list" id="ed-function-library-list"></div>' +
          '<div class="ed-function-library-status" id="ed-function-library-status"></div>' +
        '</div>' +
      '</div>'
    );
  }

  function bindPanelEvents() {
    if (!panelEl) return;

    // ── 서브탭(변수/리스트) 전환 ──
    var subtabs = panelEl.querySelectorAll('.ed-subtab');
    subtabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabName = btn.getAttribute('data-tab');

        subtabs.forEach(function (b) { b.classList.remove('ed-subtab-active'); });
        btn.classList.add('ed-subtab-active');

        panelEl.querySelectorAll('.ed-section').forEach(function (s) {
          s.classList.remove('ed-section-active');
        });
        var target = panelEl.querySelector('#ed-section-' + tabName);
        if (target) target.classList.add('ed-section-active');
      });
    });

    // ── 새로고침 ──
    var refreshBtn = panelEl.querySelector('#ed-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        sendToInject('REQUEST_SNAPSHOT');
      });
    }

    // ── 검색 ──
    var searchInput = panelEl.querySelector('#ed-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        renderSnapshot(currentSnapshot);
      });
    }

    bindLabControls();
    bindGeneratorEvents();
    bindFunctionLibraryEvents();
    applyLabTabVisibility();
    renderGeneratorFileList();
    renderFunctionLibraryList();
    renderLabControls();
  }

  function bindLabControls() {
    if (!panelEl) return;

    var turboToggle = panelEl.querySelector('#ed-toggle-turbo-mode');
    if (turboToggle && turboToggle.dataset.bound !== 'true') {
      turboToggle.dataset.bound = 'true';
      turboToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          turboModeEnabled: turboToggle.checked
        });
      });
    }

    var eoUploaderToggle = panelEl.querySelector('#ed-toggle-eo-uploader');
    if (eoUploaderToggle && eoUploaderToggle.dataset.bound !== 'true') {
      eoUploaderToggle.dataset.bound = 'true';
      eoUploaderToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          eoUploaderEnabled: eoUploaderToggle.checked
        });
      });
    }

    var dropdownSearchToggle = panelEl.querySelector('#ed-toggle-dropdown-search');
    if (dropdownSearchToggle && dropdownSearchToggle.dataset.bound !== 'true') {
      dropdownSearchToggle.dataset.bound = 'true';
      dropdownSearchToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          dropdownSearchEnabled: dropdownSearchToggle.checked
        });
      });
    }

    var dropdownSearchBlockMenuToggle = panelEl.querySelector('#ed-toggle-dropdown-search-block-menu');
    if (dropdownSearchBlockMenuToggle && dropdownSearchBlockMenuToggle.dataset.bound !== 'true') {
      dropdownSearchBlockMenuToggle.dataset.bound = 'true';
      dropdownSearchBlockMenuToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          dropdownSearchBlockMenuEnabled: dropdownSearchBlockMenuToggle.checked
        });
      });
    }

    var dropdownSearchPropertyPanelToggle = panelEl.querySelector('#ed-toggle-dropdown-search-property-panel');
    if (dropdownSearchPropertyPanelToggle && dropdownSearchPropertyPanelToggle.dataset.bound !== 'true') {
      dropdownSearchPropertyPanelToggle.dataset.bound = 'true';
      dropdownSearchPropertyPanelToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          dropdownSearchPropertyPanelEnabled: dropdownSearchPropertyPanelToggle.checked
        });
      });
    }

    var blockTextCopyToggle = panelEl.querySelector('#ed-toggle-block-text-copy');
    if (blockTextCopyToggle && blockTextCopyToggle.dataset.bound !== 'true') {
      blockTextCopyToggle.dataset.bound = 'true';
      blockTextCopyToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          blockTextCopyEnabled: blockTextCopyToggle.checked
        });
      });
    }

    var highQualityBlockImageToggle = panelEl.querySelector('#ed-toggle-high-quality-block-image');
    if (highQualityBlockImageToggle && highQualityBlockImageToggle.dataset.bound !== 'true') {
      highQualityBlockImageToggle.dataset.bound = 'true';
      highQualityBlockImageToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          highQualityBlockImageEnabled: highQualityBlockImageToggle.checked
        });
      });
    }

    var highQualityScaleRange = panelEl.querySelector('#ed-high-quality-scale-range');
    if (highQualityScaleRange && highQualityScaleRange.dataset.bound !== 'true') {
      highQualityScaleRange.dataset.bound = 'true';
      highQualityScaleRange.addEventListener('input', function () {
        renderHighQualityScaleControls(highQualityScaleRange.value);
      });
      highQualityScaleRange.addEventListener('change', function () {
        saveHighQualityScaleFromControl(highQualityScaleRange.value);
      });
    }

    var highQualityScaleInput = panelEl.querySelector('#ed-high-quality-scale-input');
    if (highQualityScaleInput && highQualityScaleInput.dataset.bound !== 'true') {
      highQualityScaleInput.dataset.bound = 'true';
      highQualityScaleInput.addEventListener('input', function () {
        var scale = Number(highQualityScaleInput.value);
        if (Number.isFinite(scale) && scale >= 200 && scale <= 2000) {
          renderHighQualityScaleControls(scale, { keepInputValue: true });
        }
      });
      highQualityScaleInput.addEventListener('change', function () {
        saveHighQualityScaleFromControl(highQualityScaleInput.value);
      });
      highQualityScaleInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveHighQualityScaleFromControl(highQualityScaleInput.value);
        }
      });
    }

    var functionLibraryToggle = panelEl.querySelector('#ed-toggle-function-library');
    if (functionLibraryToggle && functionLibraryToggle.dataset.bound !== 'true') {
      functionLibraryToggle.dataset.bound = 'true';
      functionLibraryToggle.addEventListener('change', function () {
        saveSettingsFromPanel({
          functionLibraryEnabled: functionLibraryToggle.checked
        });
      });
    }
  }

  function renderLabControls() {
    if (!panelEl) return;

    var turboToggle = panelEl.querySelector('#ed-toggle-turbo-mode');
    if (turboToggle) {
      turboToggle.checked = !!extensionSettings.turboModeEnabled;
    }

    var eoUploaderToggle = panelEl.querySelector('#ed-toggle-eo-uploader');
    if (eoUploaderToggle) {
      eoUploaderToggle.checked = !!extensionSettings.eoUploaderEnabled;
    }

    var dropdownSearchToggle = panelEl.querySelector('#ed-toggle-dropdown-search');
    if (dropdownSearchToggle) {
      dropdownSearchToggle.checked = !!extensionSettings.dropdownSearchEnabled;
    }

    renderDropdownSearchTargetControls();

    var blockTextCopyToggle = panelEl.querySelector('#ed-toggle-block-text-copy');
    if (blockTextCopyToggle) {
      blockTextCopyToggle.checked = !!extensionSettings.blockTextCopyEnabled;
    }

    var highQualityBlockImageToggle = panelEl.querySelector('#ed-toggle-high-quality-block-image');
    if (highQualityBlockImageToggle) {
      highQualityBlockImageToggle.checked = !!extensionSettings.highQualityBlockImageEnabled;
    }

    renderHighQualityScaleControls(extensionSettings.highQualityBlockImageScale);

    var functionLibraryToggle = panelEl.querySelector('#ed-toggle-function-library');
    if (functionLibraryToggle) {
      functionLibraryToggle.checked = !!extensionSettings.functionLibraryEnabled;
    }
  }

  function renderDropdownSearchTargetControls() {
    var targets = panelEl.querySelector('#ed-dropdown-search-targets');
    var blockMenuToggle = panelEl.querySelector('#ed-toggle-dropdown-search-block-menu');
    var propertyPanelToggle = panelEl.querySelector('#ed-toggle-dropdown-search-property-panel');
    var enabled = !!extensionSettings.dropdownSearchEnabled;

    if (targets) {
      targets.classList.toggle('ed-lab-subcontrols-disabled', !enabled);
    }
    if (blockMenuToggle) {
      blockMenuToggle.checked = extensionSettings.dropdownSearchBlockMenuEnabled !== false;
      blockMenuToggle.disabled = !enabled;
    }
    if (propertyPanelToggle) {
      propertyPanelToggle.checked = extensionSettings.dropdownSearchPropertyPanelEnabled !== false;
      propertyPanelToggle.disabled = !enabled;
    }
  }

  function getHighQualityScalePercent(value) {
    if (typeof normalizeHighQualityBlockImageScale === 'function') {
      return normalizeHighQualityBlockImageScale(value);
    }
    var scale = Number(value);
    if (!Number.isFinite(scale)) scale = 1000;
    scale = Math.round(scale);
    if (scale < 200) return 200;
    if (scale > 2000) return 2000;
    return scale;
  }

  function renderHighQualityScaleControls(value, options) {
    var scale = getHighQualityScalePercent(value);
    var disabled = !extensionSettings.highQualityBlockImageEnabled;
    var control = panelEl.querySelector('#ed-high-quality-scale-control');
    var range = panelEl.querySelector('#ed-high-quality-scale-range');
    var input = panelEl.querySelector('#ed-high-quality-scale-input');
    var warning = panelEl.querySelector('#ed-high-quality-scale-warning');

    if (control) {
      control.classList.toggle('ed-lab-subcontrols-disabled', disabled);
    }
    if (range) {
      range.value = String(scale);
      range.disabled = disabled;
    }
    if (input) {
      if (!options || !options.keepInputValue) {
        input.value = String(scale);
      }
      input.disabled = disabled;
    }
    if (warning) {
      warning.classList.toggle('ed-lab-scale-warning-active', scale >= 1000);
    }
  }

  function saveHighQualityScaleFromControl(value) {
    var scale = getHighQualityScalePercent(value);
    renderHighQualityScaleControls(scale);
    saveSettingsFromPanel({
      highQualityBlockImageScale: scale
    });
  }

  function isLabTabFeatureEnabled() {
    return !!(extensionSettings.enabled && extensionSettings.labTabEnabled);
  }

  function isEoUploaderFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.debuggerTabEnabled &&
      extensionSettings.labTabEnabled &&
      extensionSettings.eoUploaderEnabled
    );
  }

  function isFunctionPrivateVariablesFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.functionPrivateVariablesEnabled
    );
  }

  function isDropdownSearchFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.debuggerTabEnabled &&
      extensionSettings.labTabEnabled &&
      extensionSettings.dropdownSearchEnabled
    );
  }

  function isBlockTextCopyFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.debuggerTabEnabled &&
      extensionSettings.labTabEnabled &&
      extensionSettings.blockTextCopyEnabled
    );
  }

  function isHighQualityBlockImageFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.debuggerTabEnabled &&
      extensionSettings.labTabEnabled &&
      extensionSettings.highQualityBlockImageEnabled
    );
  }

  function isFunctionLibraryFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.debuggerTabEnabled &&
      extensionSettings.labTabEnabled &&
      extensionSettings.functionLibraryEnabled
    );
  }

  function getDropdownSearchFeaturePayload(shouldEnable) {
    return {
      enabled: !!shouldEnable,
      blockMenuEnabled: !!(shouldEnable && extensionSettings.dropdownSearchBlockMenuEnabled !== false),
      propertyPanelEnabled: !!(shouldEnable && extensionSettings.dropdownSearchPropertyPanelEnabled !== false)
    };
  }

  function getHighQualityBlockImageFeaturePayload(shouldEnable) {
    var scalePercent = getHighQualityScalePercent(extensionSettings.highQualityBlockImageScale);
    return {
      enabled: !!shouldEnable,
      scale: scalePercent / 100,
      scalePercent: scalePercent
    };
  }

  function applyLabTabVisibility() {
    if (!panelEl) return;

    var visible = isLabTabFeatureEnabled();
    var uploaderVisible = isEoUploaderFeatureEnabled();
    var functionLibraryVisible = isFunctionLibraryFeatureEnabled();
    panelEl.querySelectorAll('.ed-lab-only').forEach(function (el) {
      el.style.display = visible ? '' : 'none';
    });
    panelEl.querySelectorAll('.ed-eo-uploader-only').forEach(function (el) {
      el.style.display = uploaderVisible ? '' : 'none';
    });
    panelEl.querySelectorAll('.ed-function-library-only').forEach(function (el) {
      el.style.display = functionLibraryVisible ? '' : 'none';
    });
    panelEl.querySelectorAll('.ed-optional-only').forEach(function (el) {
      el.style.display = (visible || uploaderVisible || functionLibraryVisible) ? '' : 'none';
    });

    var labSection = panelEl.querySelector('#ed-section-others');
    var uploaderSection = panelEl.querySelector('#ed-section-generator');
    var functionLibrarySection = panelEl.querySelector('#ed-section-function-library');
    var activeHidden =
      (!visible && labSection && labSection.classList.contains('ed-section-active')) ||
      (!uploaderVisible && uploaderSection && uploaderSection.classList.contains('ed-section-active')) ||
      (!functionLibraryVisible && functionLibrarySection && functionLibrarySection.classList.contains('ed-section-active'));

    if (activeHidden) {
      var variableTab = panelEl.querySelector('.ed-subtab[data-tab="variables"]');
      if (variableTab) {
        variableTab.click();
      }
    }
  }

  function getEoUploader() {
    if (!eoUploader && window.EntryDebuggerEoUploader) {
      eoUploader = window.EntryDebuggerEoUploader.create({
        getPanelEl: function () { return panelEl; },
        sendToInject: sendToInject,
        showToast: showToast,
        escapeHTML: escapeHTML,
        escapeAttr: escapeAttr
      });
    }
    return eoUploader;
  }

  function bindGeneratorEvents() {
    var uploader = getEoUploader();
    if (uploader) uploader.bindEvents();
  }

  function renderGeneratorFileList() {
    var uploader = getEoUploader();
    if (uploader) uploader.renderFileList();
  }

  function bindFunctionLibraryEvents() {
    if (!panelEl) return;

    var list = panelEl.querySelector('#ed-function-library-list');
    if (!list || list.dataset.bound === 'true') return;
    list.dataset.bound = 'true';
    list.addEventListener('click', function (event) {
      if (!event.target || typeof event.target.closest !== 'function') return;
      var button = event.target.closest('.ed-function-add-btn');
      if (!button) return;

      var templateId = button.getAttribute('data-template-id');
      var template = getFunctionLibraryTemplate(templateId);
      if (!template) {
        setFunctionLibraryStatus('함수 템플릿을 찾을 수 없습니다.', 'error');
        return;
      }

      button.disabled = true;
      setFunctionLibraryStatus(template.name + ' 추가 중...', 'info');
      sendToInject('ADD_FUNCTION_LIBRARY_TEMPLATE', {
        templateId: template.id,
        templateName: template.name,
        func: template.function
      });
    });
  }

  function getFunctionLibraryTemplate(templateId) {
    return FunctionLibraryTemplates.find(function (template) {
      return template && template.id === templateId;
    }) || null;
  }

  function renderFunctionLibraryList() {
    if (!panelEl) return;

    var list = panelEl.querySelector('#ed-function-library-list');
    if (!list) return;

    if (!FunctionLibraryTemplates.length) {
      list.innerHTML =
        '<div class="ed-function-library-empty">' +
          '등록된 함수가 없습니다.' +
        '</div>';
      return;
    }

    list.innerHTML = FunctionLibraryTemplates.map(function (template) {
      return (
        '<div class="ed-function-card">' +
          '<div class="ed-function-card-main">' +
            '<div class="ed-function-card-title">' + escapeHTML(template.name || '이름 없는 함수') + '</div>' +
            '<div class="ed-function-card-desc">' + escapeHTML(template.description || '') + '</div>' +
          '</div>' +
          '<button class="ed-function-add-btn" type="button" data-template-id="' + escapeAttr(template.id || '') + '">추가</button>' +
        '</div>'
      );
    }).join('');
  }

  function setFunctionLibraryStatus(message, type) {
    var status = panelEl && panelEl.querySelector('#ed-function-library-status');
    if (!status) return;
    status.textContent = message || '';
    status.className = 'ed-function-library-status' +
      (message ? ' ed-function-library-status-' + (type || 'info') : '');
  }

  function saveSettingsFromPanel(partialSettings) {
    var nextSettings = normalizeSettings(Object.assign({}, extensionSettings, partialSettings || {}));
    applySettings(nextSettings);

    chrome.runtime.sendMessage({
      type: 'SET_SETTINGS',
      settings: nextSettings
    }, function (response) {
      if (response && response.settings) {
        extensionSettings = normalizeSettings(response.settings);
        applyLabTabVisibility();
        renderGeneratorFileList();
        renderFunctionLibraryList();
        renderLabControls();
      }
    });
  }

  /* ═══════════════════════════════════════════
     6. 스냅샷 렌더링
     ═══════════════════════════════════════════ */

  function renderSnapshot(snapshot) {
    if (!panelEl) return;

    var searchInput = panelEl.querySelector('#ed-search');
    var searchTerm = searchInput ? searchInput.value : '';

    var statusEl = panelEl.querySelector('#ed-status');
    if (statusEl) {
      if (snapshot.ready) {
        statusEl.textContent = '연결됨';
        statusEl.className = 'ed-status ed-status-connected';
      } else {
        statusEl.textContent = 'Entry 대기 중...';
        statusEl.className = 'ed-status ed-status-waiting';
      }
    }

    renderVariables(snapshot.variables, searchTerm);
    renderLists(snapshot.lists, searchTerm);
    renderMessages(snapshot.messages || [], searchTerm);
    renderScenes(snapshot.scenes || [], searchTerm);
    renderOthers(snapshot.others || [], searchTerm);
  }

  function getScopeInfo(item) {
    if (item && item.scope) return item.scope;

    var key = item && item.object ? 'local' : 'normal';
    return {
      key: key,
      label: key === 'local' ? '지역: ' + item.object : '일반',
      objectId: item && item.object ? item.object : null,
      objectName: item && item.object ? item.object : '',
      currentObjectId: null,
      currentObjectName: ''
    };
  }

  function getScopeLabel(scope) {
    if (!scope) return '일반';
    if (scope.key === 'cloud') return '공유';
    if (scope.key === 'real_time') return '실시간';
    if (scope.key === 'local') return '지역: ' + (scope.objectName || scope.objectId || '(오브젝트 없음)');
    return '일반';
  }

  function getLocalOptionLabel(scope) {
    if (scope && scope.key === 'local') {
      return getScopeLabel(scope);
    }

    var targetName = scope && (scope.currentObjectName || scope.currentObjectId);
    return '지역: ' + (targetName || '현재 오브젝트');
  }

  function getScopeClass(scope) {
    var key = scope && scope.key ? scope.key : 'normal';
    return 'ed-scope-' + key;
  }

  function createScopeSelectHTML(item, kind) {
    var scope = getScopeInfo(item);
    var localObjectId = scope.currentObjectId || scope.objectId || '';
    var localDisabled = !localObjectId && scope.key !== 'local';
    var options = [
      ['normal', '일반', false],
      ['cloud', '공유', false],
      ['real_time', '실시간', false],
      ['local', getLocalOptionLabel(scope), localDisabled]
    ];

    var html = '<select class="ed-scope-select ' + getScopeClass(scope) + '" ' +
      'data-kind="' + kind + '" ' +
      'data-id="' + escapeAttr(item.id) + '" ' +
      'data-scope-key="' + escapeAttr(scope.key || 'normal') + '" ' +
      'data-object-id="' + escapeAttr(scope.objectId || '') + '" ' +
      'data-current-object-id="' + escapeAttr(scope.currentObjectId || '') + '" ' +
      'title="스코프 변경">';

    options.forEach(function (option) {
      html += '<option value="' + option[0] + '"' +
        (scope.key === option[0] ? ' selected' : '') +
        (option[2] ? ' disabled' : '') +
        '>' + escapeHTML(option[1]) + '</option>';
    });

    return html + '</select>';
  }

  function updateScopeSelect(select, item) {
    if (!select) return;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = createScopeSelectHTML(item, select.dataset.kind || item.type || 'variable');
    var next = wrapper.firstChild;

    select.className = next.className;
    select.dataset.kind = next.dataset.kind;
    select.dataset.id = next.dataset.id;
    select.dataset.scopeKey = next.dataset.scopeKey;
    select.dataset.objectId = next.dataset.objectId;
    select.dataset.currentObjectId = next.dataset.currentObjectId;
    select.innerHTML = next.innerHTML;
    select.value = next.value;
  }

  function bindScopeSelect(select) {
    if (!select) return;

    select.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    select.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    select.addEventListener('change', function (e) {
      e.stopPropagation();

      var previousScope = select.dataset.scopeKey || 'normal';
      var nextScope = select.value;
      var objectId = '';

      if (nextScope === 'local') {
        objectId = select.dataset.currentObjectId || select.dataset.objectId || '';
        if (!objectId) {
          showToast('지역 스코프로 바꿀 현재 오브젝트를 찾을 수 없습니다.', 'error');
          select.value = previousScope;
          return;
        }
      }

      sendToInject('CHANGE_VARIABLE_SCOPE', {
        kind: select.dataset.kind || 'variable',
        id: select.dataset.id,
        scope: nextScope,
        objectId: objectId
      });

      flashElement(select.closest('.ed-var-card, .ed-list-card') || select, 'ed-flash');
    });
  }

  function getScopeSearchText(item) {
    var scope = getScopeInfo(item);
    return [
      getScopeLabel(scope),
      scope.key || '',
      scope.objectName || '',
      scope.currentObjectName || ''
    ].join(' ').toLowerCase();
  }

  function matchesSearch(text, query) {
    if (HangulSearch && typeof HangulSearch.matches === 'function') {
      return HangulSearch.matches(text, query);
    }
    var normalizedQuery = String(query == null ? '' : query).trim().toLowerCase();
    return !normalizedQuery ||
      String(text == null ? '' : text).trim().toLowerCase().indexOf(normalizedQuery) !== -1;
  }

  /* ─── 변수 렌더링 ─── */

  function renderVariables(variables, searchTerm) {
    var listEl = panelEl.querySelector('#ed-var-list');
    var emptyEl = panelEl.querySelector('#ed-var-empty');
    if (!listEl || !emptyEl) return;

    var filtered = variables.filter(function (v) {
      if (!searchTerm) return true;
      return matchesSearch(v.name, searchTerm) ||
             matchesSearch(String(v.value), searchTerm) ||
             matchesSearch(getScopeSearchText(v), searchTerm);
    });

    if (filtered.length === 0) {
      emptyEl.style.display = '';
      listEl.innerHTML = '';
      return;
    }

    emptyEl.style.display = 'none';

    var existingMap = {};
    listEl.querySelectorAll('.ed-var-card').forEach(function (card) {
      existingMap[card.dataset.id] = card;
    });

    var fragment = document.createDocumentFragment();

    filtered.forEach(function (v) {
      var existing = existingMap[v.id];

      if (existing) {
        var isEditing = existing.classList.contains('ed-editing');
        var input = existing.querySelector('.ed-var-input');
        var displayBtn = existing.querySelector('.ed-var-display');
        // 편집 중이면 사용자 입력 보호를 위해 input/표시값 모두 갱신하지 않음
        if (!isEditing) {
          if (input) input.value = v.value;
          if (displayBtn) {
            var fullVal = String(v.value);
            displayBtn.textContent = truncateForDisplay(fullVal);
            displayBtn.title = fullVal;
          }
        }
        updateScopeSelect(existing.querySelector('.ed-scope-select'), v);
        fragment.appendChild(existing);
      } else {
        fragment.appendChild(createVariableCard(v));
      }
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function createVariableCard(v) {
    var card = document.createElement('div');
    card.className = 'ed-var-card';
    card.dataset.id = v.id;

    var fullVal = String(v.value);
    var attrName    = escapeAttr(v.name);
    var attrFullVal = escapeAttr(fullVal);
    var eName       = escapeHTML(v.name);
    var eDisplayVal = escapeHTML(truncateForDisplay(fullVal));

    card.innerHTML =
      '<div class="ed-var-row-top">' +
        '<span class="ed-var-name" title="' + attrName + '">' + eName + '</span>' +
        createScopeSelectHTML(v, 'variable') +
      '</div>' +
      '<button class="ed-var-display" title="' + attrFullVal + '">' + eDisplayVal + '</button>' +
      '<div class="ed-var-row-bottom">' +
        '<input type="text" class="ed-var-input" value="' + attrFullVal + '" />' +
        '<button class="ed-btn-apply" title="값 적용">&#x2714;</button>' +
      '</div>';

    var displayBtn = card.querySelector('.ed-var-display');
    var applyBtn   = card.querySelector('.ed-btn-apply');
    var input      = card.querySelector('.ed-var-input');
    var scopeSelect = card.querySelector('.ed-scope-select');

    bindScopeSelect(scopeSelect);

    function enterEdit() {
      card.classList.add('ed-editing');
      input.focus();
      var len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (e) {}
    }

    function exitEdit() {
      card.classList.remove('ed-editing');
    }

    displayBtn.addEventListener('click', enterEdit);

    // mousedown 에서 default 를 막아 input 의 blur 가 click 전에 발생하지 않게 함
    // (그렇지 않으면 blur → exitEdit → 적용 버튼이 display:none 으로 사라져 click 이 안 옴)
    applyBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    applyBtn.addEventListener('click', function () {
      sendToInject('SET_VARIABLE', { id: v.id, value: input.value });
      flashElement(card, 'ed-flash');
      exitEdit();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyBtn.click();
      else if (e.key === 'Escape') exitEdit();
    });

    input.addEventListener('blur', function () {
      exitEdit();
    });

    return card;
  }

  /* ─── 실험실 렌더링: 초시계/대답 ─── */

  function renderOthers(others, searchTerm) {
    var listEl = panelEl.querySelector('#ed-other-list');
    var emptyEl = panelEl.querySelector('#ed-other-empty');
    if (!listEl || !emptyEl) return;

    var filtered = others.filter(function (item) {
      var value = item.value === undefined || item.value === null ? '' : String(item.value);
      if (!searchTerm) return true;
      return matchesSearch(item.name, searchTerm) ||
             matchesSearch(value, searchTerm);
    });

    if (filtered.length === 0) {
      emptyEl.style.display = '';
      listEl.innerHTML = '';
      return;
    }

    emptyEl.style.display = 'none';

    var existingMap = {};
    listEl.querySelectorAll('.ed-other-card').forEach(function (card) {
      existingMap[card.dataset.kind] = card;
    });

    var fragment = document.createDocumentFragment();

    filtered.forEach(function (item) {
      var existing = existingMap[item.kind];
      if (existing) {
        updateOtherCard(existing, item);
        fragment.appendChild(existing);
      } else {
        fragment.appendChild(createOtherCard(item));
      }
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function updateOtherCard(card, item) {
    card.dataset.kind = item.kind;
    card.dataset.visible = item.visible ? 'true' : 'false';

    var nameEl = card.querySelector('.ed-var-name');
    if (nameEl) {
      nameEl.textContent = item.name;
      nameEl.title = item.name;
    }

    var visibleBadge = card.querySelector('.ed-other-visible');
    if (visibleBadge) {
      visibleBadge.textContent = item.visible ? '표시 중' : '숨김';
      visibleBadge.className = 'ed-badge ed-other-visible ' +
        (item.visible ? 'ed-badge-visible' : 'ed-badge-hidden');
    }

    var visibleBtn = card.querySelector('.ed-btn-system-visible');
    if (visibleBtn) {
      applyOtherVisibilityButtonState(visibleBtn, item.visible);
    }

    if (!card.classList.contains('ed-editing')) {
      var fullVal = item.value === undefined || item.value === null ? '' : String(item.value);
      var input = card.querySelector('.ed-var-input');
      var displayBtn = card.querySelector('.ed-var-display');
      if (input) input.value = fullVal;
      if (displayBtn) {
        displayBtn.textContent = truncateForDisplay(fullVal);
        displayBtn.title = fullVal;
      }
    }
  }

  function createOtherCard(item) {
    var card = document.createElement('div');
    card.className = 'ed-var-card ed-other-card';
    card.dataset.id = item.id || item.kind;
    card.dataset.kind = item.kind;
    card.dataset.visible = item.visible ? 'true' : 'false';

    var fullVal = item.value === undefined || item.value === null ? '' : String(item.value);
    var attrName = escapeAttr(item.name);
    var attrFullVal = escapeAttr(fullVal);
    var eName = escapeHTML(item.name);
    var eDisplayVal = escapeHTML(truncateForDisplay(fullVal));
    var visibleClass = item.visible ? 'ed-badge-visible' : 'ed-badge-hidden';
    var visibleText = item.visible ? '표시 중' : '숨김';

    card.innerHTML =
      '<div class="ed-var-row-top">' +
        '<span class="ed-var-name" title="' + attrName + '">' + eName + '</span>' +
        '<span class="ed-other-badges">' +
          '<span class="ed-badge ed-badge-system">기본</span>' +
          '<span class="ed-badge ed-other-visible ' + visibleClass + '">' + visibleText + '</span>' +
        '</span>' +
      '</div>' +
      '<button class="ed-var-display" title="' + attrFullVal + '">' + eDisplayVal + '</button>' +
      '<div class="ed-var-row-bottom">' +
        '<input type="text" class="ed-var-input" value="' + attrFullVal + '" />' +
        '<button class="ed-btn-apply" title="값 적용">&#x2714;</button>' +
      '</div>' +
      '<div class="ed-other-actions">' +
        '<button class="ed-btn-system-visible" type="button"></button>' +
      '</div>';

    var displayBtn = card.querySelector('.ed-var-display');
    var applyBtn = card.querySelector('.ed-btn-apply');
    var input = card.querySelector('.ed-var-input');
    var visibleBtn = card.querySelector('.ed-btn-system-visible');

    function enterEdit() {
      card.classList.add('ed-editing');
      input.focus();
      var len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (e) {}
    }

    function exitEdit() {
      card.classList.remove('ed-editing');
    }

    applyOtherVisibilityButtonState(visibleBtn, item.visible);

    displayBtn.addEventListener('click', enterEdit);

    applyBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    applyBtn.addEventListener('click', function () {
      sendToInject('SET_SYSTEM_VARIABLE', { kind: card.dataset.kind, value: input.value });
      flashElement(card, 'ed-flash');
      exitEdit();
    });

    visibleBtn.addEventListener('click', function () {
      var nextVisible = card.dataset.visible !== 'true';
      sendToInject('SET_SYSTEM_VISIBLE', { kind: card.dataset.kind, visible: nextVisible });
      flashElement(card, 'ed-flash');
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyBtn.click();
      else if (e.key === 'Escape') exitEdit();
    });

    input.addEventListener('blur', function () {
      exitEdit();
    });

    return card;
  }

  function applyOtherVisibilityButtonState(button, visible) {
    if (!button) return;
    button.textContent = visible ? '숨기기' : '보이기';
    button.title = visible ? '화면에서 숨기기' : '화면에 보이기';
    button.classList.toggle('ed-btn-system-visible-on', !!visible);
  }

  /* ─── 리스트 렌더링 (DOM diffing + 펼침 상태 유지) ─── */

  function renderLists(lists, searchTerm) {
    var listEl = panelEl.querySelector('#ed-list-list');
    var emptyEl = panelEl.querySelector('#ed-list-empty');
    if (!listEl || !emptyEl) return;

    var filtered = lists.filter(function (l) {
      if (!searchTerm) return true;
      return matchesSearch(l.name, searchTerm) ||
             matchesSearch(getScopeSearchText(l), searchTerm);
    });

    if (filtered.length === 0) {
      emptyEl.style.display = '';
      listEl.innerHTML = '';
      return;
    }

    emptyEl.style.display = 'none';

    // 기존 카드 맵 (DOM diffing)
    var existingMap = {};
    listEl.querySelectorAll('.ed-list-card').forEach(function (card) {
      existingMap[card.dataset.id] = card;
    });

    var fragment = document.createDocumentFragment();

    filtered.forEach(function (l) {
      var existing = existingMap[l.id];
      if (existing) {
        updateListCard(existing, l);
        fragment.appendChild(existing);
      } else {
        fragment.appendChild(createListCard(l));
      }
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  /**
   * 기존 리스트 카드의 데이터만 갱신 (펼침 상태 유지)
   */
  function updateListCard(card, l) {
    // 헤더: 개수 갱신
    var countEl = card.querySelector('.ed-list-count');
    if (countEl) countEl.textContent = '[' + l.items.length + '개]';

    updateScopeSelect(card.querySelector('.ed-scope-select'), l);

    // 펼쳐져 있지 않으면 행 갱신 불필요
    if (!expandedListIds.has(l.id)) return;

    var body = card.querySelector('.ed-list-body');
    if (!body) return;

    // 편집 중인 행이 있으면 행 갱신을 통째로 스킵 — 새 행을 그리면
    // ed-editing 클래스와 사용자가 입력 중이던 값이 모두 사라진다.
    if (body.querySelector('.ed-list-row.ed-editing')) return;

    // 포커스된 입력 필드 위치 기억
    var focusedIdx = -1;
    var focusedValue = '';
    var focusedSelStart = 0;
    var focusedSelEnd = 0;
    var rows = body.querySelectorAll('.ed-list-row');
    for (var i = 0; i < rows.length; i++) {
      var inp = rows[i].querySelector('.ed-list-input');
      if (inp && document.activeElement === inp) {
        focusedIdx = i;
        focusedValue = inp.value;
        focusedSelStart = inp.selectionStart || 0;
        focusedSelEnd = inp.selectionEnd || 0;
        break;
      }
    }

    // 추가 바의 입력값 보존
    var addBar = body.querySelector('.ed-list-add');
    var addInputValue = '';
    if (addBar) {
      var addInp = addBar.querySelector('.ed-list-add-input');
      if (addInp) addInputValue = addInp.value;
    }

    // 기존 행 제거 (추가 바는 유지)
    var oldRows = body.querySelectorAll('.ed-list-row');
    oldRows.forEach(function (r) { r.remove(); });

    // 새 행 삽입 (추가 바 앞에)
    l.items.forEach(function (item, idx) {
      var row = createListRow(l, item, idx);

      // 포커스 중이던 행은 사용자 입력값 유지
      if (idx === focusedIdx) {
        var rowInput = row.querySelector('.ed-list-input');
        if (rowInput) rowInput.value = focusedValue;
      }

      body.insertBefore(row, addBar);
    });

    // 추가 바 입력값 복원
    if (addBar) {
      var restoredAddInp = addBar.querySelector('.ed-list-add-input');
      if (restoredAddInp) restoredAddInp.value = addInputValue;
    }

    // 포커스 복원
    if (focusedIdx >= 0 && focusedIdx < l.items.length) {
      var newRows = body.querySelectorAll('.ed-list-row');
      if (newRows[focusedIdx]) {
        var restoreInput = newRows[focusedIdx].querySelector('.ed-list-input');
        if (restoreInput) {
          restoreInput.focus();
          try { restoreInput.setSelectionRange(focusedSelStart, focusedSelEnd); } catch (e) {}
        }
      }
    }
  }

  function createListCard(l) {
    var card = document.createElement('div');
    card.className = 'ed-list-card';
    card.dataset.id = l.id;

    var eName = escapeHTML(l.name);
    var attrName = escapeAttr(l.name);

    var header = document.createElement('div');
    header.className = 'ed-list-header';
    header.innerHTML =
      '<div class="ed-list-header-left">' +
        '<span class="ed-list-arrow">&#x25B6;</span>' +
        '<span class="ed-list-name" title="' + attrName + '">' + eName + '</span>' +
        '<span class="ed-list-count">[' + l.items.length + '개]</span>' +
      '</div>' +
      createScopeSelectHTML(l, 'list');

    bindScopeSelect(header.querySelector('.ed-scope-select'));

    var body = document.createElement('div');
    body.className = 'ed-list-body';

    // 펼침 상태 복원 (Set 기반)
    var isExpanded = expandedListIds.has(l.id);
    body.style.display = isExpanded ? 'block' : 'none';
    if (isExpanded) {
      header.querySelector('.ed-list-arrow').innerHTML = '&#x25BC;';
      header.classList.add('ed-list-header-open');
    }

    header.addEventListener('click', function () {
      isExpanded = !isExpanded;

      // Set 동기화
      if (isExpanded) {
        expandedListIds.add(l.id);
      } else {
        expandedListIds.delete(l.id);
      }

      body.style.display = isExpanded ? 'block' : 'none';
      header.querySelector('.ed-list-arrow').innerHTML = isExpanded ? '&#x25BC;' : '&#x25B6;';
      if (isExpanded) header.classList.add('ed-list-header-open');
      else header.classList.remove('ed-list-header-open');
    });

    l.items.forEach(function (item, idx) {
      body.appendChild(createListRow(l, item, idx));
    });

    var addBar = document.createElement('div');
    addBar.className = 'ed-list-add';
    addBar.innerHTML =
      '<input type="text" class="ed-list-add-input" placeholder="새 항목 값..." />' +
      '<button class="ed-btn-add" title="추가">+</button>';

    var addInput = addBar.querySelector('.ed-list-add-input');
    var addBtn   = addBar.querySelector('.ed-btn-add');

    addBtn.addEventListener('click', function () {
      var val = addInput.value.trim();
      if (!val) return;
      sendToInject('ADD_LIST_ITEM', { listId: l.id, value: addInput.value });
      addInput.value = '';
    });
    addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addBtn.click();
    });

    body.appendChild(addBar);
    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  function createListRow(l, item, idx) {
    var row = document.createElement('div');
    row.className = 'ed-list-row';

    var fullVal = String(item);
    var attrFullVal = escapeAttr(fullVal);
    var eDisplayVal = escapeHTML(truncateForDisplay(fullVal));

    row.innerHTML =
      '<span class="ed-list-idx">' + (idx + 1) + '</span>' +
      '<button class="ed-list-display" title="' + attrFullVal + '">' + eDisplayVal + '</button>' +
      '<input type="text" class="ed-list-input" value="' + attrFullVal + '" />' +
      '<button class="ed-btn-apply ed-btn-sm" title="적용">&#x2714;</button>' +
      '<button class="ed-btn-del ed-btn-sm" title="삭제">&#x2716;</button>';

    var displayBtn = row.querySelector('.ed-list-display');
    var applyBtn   = row.querySelector('.ed-btn-apply');
    var deleteBtn  = row.querySelector('.ed-btn-del');
    var inputField = row.querySelector('.ed-list-input');

    function enterEdit() {
      row.classList.add('ed-editing');
      inputField.focus();
      var len = inputField.value.length;
      try { inputField.setSelectionRange(len, len); } catch (e) {}
    }

    function exitEdit() {
      row.classList.remove('ed-editing');
    }

    displayBtn.addEventListener('click', enterEdit);

    // mousedown 에서 default 를 막아 input 의 blur 가 click 전에 발생하지 않게 함
    applyBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    applyBtn.addEventListener('click', function () {
      sendToInject('SET_LIST_ITEM', { listId: l.id, index: idx, value: inputField.value });
      flashElement(row, 'ed-flash');
      exitEdit();
    });

    deleteBtn.addEventListener('click', function () {
      sendToInject('REMOVE_LIST_ITEM', { listId: l.id, index: idx });
    });

    inputField.addEventListener('blur', function () {
      exitEdit();
    });

    inputField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyBtn.click();
      else if (e.key === 'Escape') exitEdit();
    });

    return row;
  }

  /* ─── 신호 렌더링 ─── */

  function renderMessages(messages, searchTerm) {
    var listEl = panelEl.querySelector('#ed-msg-list');
    var emptyEl = panelEl.querySelector('#ed-msg-empty');
    if (!listEl || !emptyEl) return;

    var filtered = messages.filter(function (m) {
      if (!searchTerm) return true;
      return matchesSearch(m.name, searchTerm);
    });

    if (filtered.length === 0) {
      emptyEl.style.display = '';
      listEl.innerHTML = '';
      return;
    }

    emptyEl.style.display = 'none';

    // DOM diffing: 기존 카드 재활용
    var existingMap = {};
    listEl.querySelectorAll('.ed-msg-card').forEach(function (card) {
      existingMap[card.dataset.id] = card;
    });

    var fragment = document.createDocumentFragment();

    filtered.forEach(function (m) {
      var existing = existingMap[m.id];
      if (existing) {
        fragment.appendChild(existing);
      } else {
        fragment.appendChild(createMessageCard(m));
      }
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function createMessageCard(m) {
    var card = document.createElement('div');
    card.className = 'ed-msg-card';
    card.dataset.id = m.id;

    var eName = escapeHTML(m.name);

    card.innerHTML =
      '<div class="ed-msg-info">' +
        '<span class="ed-msg-icon">&#x1F4E1;</span>' +
        '<span class="ed-msg-name" title="' + eName + '">' + eName + '</span>' +
      '</div>' +
      '<button class="ed-btn-raise" title="신호 보내기">신호 보내기</button>';

    var raiseBtn = card.querySelector('.ed-btn-raise');
    raiseBtn.addEventListener('click', function () {
      sendToInject('RAISE_MESSAGE', { id: m.id });
      flashElement(card, 'ed-flash');
    });

    return card;
  }

  /* ─── 장면 렌더링 ─── */

  function renderScenes(scenes, searchTerm) {
    var listEl = panelEl.querySelector('#ed-scene-list');
    var emptyEl = panelEl.querySelector('#ed-scene-empty');
    if (!listEl || !emptyEl) return;

    var filtered = scenes.filter(function (s) {
      if (!searchTerm) return true;
      return matchesSearch(s.name, searchTerm);
    });

    if (filtered.length === 0) {
      emptyEl.style.display = '';
      listEl.innerHTML = '';
      return;
    }

    emptyEl.style.display = 'none';

    // DOM diffing: 기존 카드 재활용
    var existingMap = {};
    listEl.querySelectorAll('.ed-scene-card').forEach(function (card) {
      existingMap[card.dataset.id] = card;
    });

    var fragment = document.createDocumentFragment();

    filtered.forEach(function (s) {
      var existing = existingMap[s.id];
      if (existing) {
        // 이름 갱신
        var nameEl = existing.querySelector('.ed-scene-name');
        if (nameEl) nameEl.textContent = s.name;
        fragment.appendChild(existing);
      } else {
        fragment.appendChild(createSceneCard(s));
      }
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function createSceneCard(s) {
    var card = document.createElement('div');
    card.className = 'ed-scene-card';
    card.dataset.id = s.id;

    var eName = escapeHTML(s.name);

    card.innerHTML =
      '<div class="ed-scene-info">' +
        '<span class="ed-scene-icon">&#x1F3AC;</span>' +
        '<span class="ed-scene-name" title="' + eName + '">' + eName + '</span>' +
      '</div>' +
      '<button class="ed-btn-scene-go" title="이 장면으로 이동">이동</button>';

    var goBtn = card.querySelector('.ed-btn-scene-go');
    goBtn.addEventListener('click', function () {
      sendToInject('CHANGE_SCENE', { id: s.id });
      flashElement(card, 'ed-flash');
    });

    return card;
  }

  /* ═══════════════════════════════════════════
     7. postMessage 통신
     ═══════════════════════════════════════════ */

  function sendToInject(type, payload, requestId) {
    window.postMessage({
      channel: CHANNEL,
      type: type,
      payload: payload || null,
      requestId: requestId || null
    }, window.location.origin);
  }

  function isDebuggerTabFeatureEnabled() {
    return !!(extensionSettings.enabled && extensionSettings.debuggerTabEnabled);
  }

  function isFunctionUsageFeatureEnabled() {
    return !!(extensionSettings.enabled && extensionSettings.functionUsageEnabled);
  }

  function isConsoleDebuggingFeatureEnabled() {
    return !!(extensionSettings.enabled && extensionSettings.consoleDebuggingEnabled);
  }

  function isBoostModeFeatureEnabled() {
    return !!(extensionSettings.enabled && extensionSettings.boostModeEnabled);
  }

  function isTurboModeFeatureEnabled() {
    return !!(
      extensionSettings.enabled &&
      extensionSettings.labTabEnabled &&
      extensionSettings.turboModeEnabled
    );
  }

  function startFunctionUsageFeature() {
    injectFunctionUsageScript();

    if (functionUsageStartTimer) {
      clearTimeout(functionUsageStartTimer);
    }

    functionUsageStartTimer = setTimeout(function () {
      functionUsageStartTimer = null;
      if (!isFunctionUsageFeatureEnabled()) return;
      sendToInject('START_FUNCTION_USAGE_POLLING');
      sendToInject('REQUEST_FUNCTION_USAGE');
    }, 250);
  }

  function stopFunctionUsageFeature() {
    if (functionUsageStartTimer) {
      clearTimeout(functionUsageStartTimer);
      functionUsageStartTimer = null;
    }
    sendToInject('STOP_FUNCTION_USAGE_POLLING');
  }

  function stopConsoleDebuggingFeature() {
    sendToInject('SET_CONSOLE_DEBUGGING_ENABLED', { enabled: false });
  }

  function applyConsoleDebuggingFeature() {
    injectConsoleDebuggingScript();
    setTimeout(function () {
      sendToInject('SET_CONSOLE_DEBUGGING_ENABLED', {
        enabled: isConsoleDebuggingFeatureEnabled()
      });
    }, 150);
  }

  function mirrorBoostModeSetting(enabled) {
    try {
      window.localStorage.setItem(BOOST_MODE_STORAGE_KEY, enabled ? '1' : '0');
    } catch (e) {}
  }

  function applyBoostModeFeature() {
    var enabled = isBoostModeFeatureEnabled();
    mirrorBoostModeSetting(enabled);
    injectBoostModeScript();
    setTimeout(function () {
      sendToInject('SET_BOOST_MODE_ENABLED', { enabled: enabled });
    }, 50);
  }

  function startTurboModeFeature() {
    injectTurboModeScript();
    setTimeout(function () {
      if (!isTurboModeFeatureEnabled()) return;
      sendToInject('SET_TURBO_MODE_ENABLED', { enabled: true });
    }, 150);
  }

  function stopTurboModeFeature() {
    sendToInject('SET_TURBO_MODE_ENABLED', { enabled: false });
  }

  function applyFunctionPrivateVariablesFeature() {
    injectFunctionPrivateVariablesScript();
    setTimeout(function () {
      sendToInject('SET_FUNCTION_PRIVATE_VARIABLES_ENABLED', {
        enabled: isFunctionPrivateVariablesFeatureEnabled()
      });
    }, 150);
  }

  function applyDropdownSearchFeature() {
    var shouldEnable = isDropdownSearchFeatureEnabled();
    if (shouldEnable) {
      injectDropdownSearchScript();
    } else if (!dropdownSearchScriptInjected) {
      return;
    }

    setTimeout(function () {
      sendToInject('SET_DROPDOWN_SEARCH_ENABLED', getDropdownSearchFeaturePayload(shouldEnable));
    }, 150);
  }

  function applyBlockTextCopyFeature() {
    var shouldEnable = isBlockTextCopyFeatureEnabled();
    if (shouldEnable) {
      injectBlockTextCopyScript();
    } else if (!blockTextCopyScriptInjected) {
      return;
    }

    setTimeout(function () {
      sendToInject('SET_BLOCK_TEXT_COPY_ENABLED', {
        enabled: shouldEnable
      });
    }, 150);
  }

  function applyHighQualityBlockImageFeature() {
    var shouldEnable = isHighQualityBlockImageFeatureEnabled();
    if (shouldEnable) {
      injectHighQualityBlockImageScript();
    } else if (!highQualityBlockImageScriptInjected) {
      return;
    }

    setTimeout(function () {
      sendToInject('SET_HIGH_QUALITY_BLOCK_IMAGE_ENABLED', getHighQualityBlockImageFeaturePayload(shouldEnable));
    }, 150);
  }

  function applySettings(settings) {
    extensionSettings = normalizeSettings(settings);
    settingsLoaded = true;
    applyBoostModeFeature();

    if (!isEntryWorkspacePage() || !extensionSettings.enabled) {
      cleanup();
      return;
    }

    if (isTurboModeFeatureEnabled()) {
      startTurboModeFeature();
    } else {
      stopTurboModeFeature();
    }

    applyFunctionPrivateVariablesFeature();
    applyDropdownSearchFeature();
    applyBlockTextCopyFeature();
    applyHighQualityBlockImageFeature();

    if (isFunctionUsageFeatureEnabled()) {
      startFunctionUsageFeature();
    } else {
      stopFunctionUsageFeature();
    }

    applyConsoleDebuggingFeature();

    if (isDebuggerTabFeatureEnabled()) {
      initDebuggerTabFeature();
    } else {
      cleanupDebuggerTabFeature();
    }

    applyLabTabVisibility();
    renderLabControls();
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    var msg = event.data;

    switch (msg.type) {
      case 'INJECT_READY':
        updateStatus('스크립트 주입 완료');
        if (isDebuggerActive) {
          sendToInject('START_POLLING');
        }
        break;

      case 'FUNCTION_USAGE_INSPECTOR_READY':
        if (!settingsLoaded) return;
        if (isFunctionUsageFeatureEnabled()) {
          sendToInject('START_FUNCTION_USAGE_POLLING');
          sendToInject('REQUEST_FUNCTION_USAGE');
        }
        break;

      case 'CONSOLE_DEBUGGING_READY':
        if (!settingsLoaded) return;
        sendToInject('SET_CONSOLE_DEBUGGING_ENABLED', {
          enabled: isConsoleDebuggingFeatureEnabled()
        });
        break;

      case 'BOOST_MODE_READY':
        if (!settingsLoaded) return;
        sendToInject('SET_BOOST_MODE_ENABLED', { enabled: isBoostModeFeatureEnabled() });
        break;

      case 'TURBO_MODE_READY':
        if (!settingsLoaded) return;
        if (isTurboModeFeatureEnabled()) {
          sendToInject('SET_TURBO_MODE_ENABLED', { enabled: true });
        }
        break;

      case 'FUNCTION_PRIVATE_VARIABLES_READY':
        if (!settingsLoaded) return;
        sendToInject('SET_FUNCTION_PRIVATE_VARIABLES_ENABLED', {
          enabled: isFunctionPrivateVariablesFeatureEnabled()
        });
        break;

      case 'DROPDOWN_SEARCH_READY':
        if (!settingsLoaded) return;
        sendToInject(
          'SET_DROPDOWN_SEARCH_ENABLED',
          getDropdownSearchFeaturePayload(isDropdownSearchFeatureEnabled())
        );
        break;

      case 'BLOCK_TEXT_COPY_READY':
        if (!settingsLoaded) return;
        sendToInject('SET_BLOCK_TEXT_COPY_ENABLED', {
          enabled: isBlockTextCopyFeatureEnabled()
        });
        break;

      case 'HIGH_QUALITY_BLOCK_IMAGE_READY':
        if (!settingsLoaded) return;
        sendToInject(
          'SET_HIGH_QUALITY_BLOCK_IMAGE_ENABLED',
          getHighQualityBlockImageFeaturePayload(isHighQualityBlockImageFeatureEnabled())
        );
        break;

      case 'BLOCK_TEXT_COPY_TOAST':
        if (msg.payload && msg.payload.message) {
          showToast(msg.payload.message, msg.payload.type || 'info');
        }
        break;

      case 'SNAPSHOT':
        currentSnapshot = msg.payload;
        if (isDebuggerActive) {
          renderSnapshot(currentSnapshot);
        }
        break;

      case 'SET_RESULT':
        if (msg.payload && !msg.payload.success) {
          showToast('오류: ' + msg.payload.error, 'error');
        }
        break;

      case 'RAISE_RESULT':
        if (msg.payload && msg.payload.success) {
          showToast('신호 발생 완료', 'info');
        } else if (msg.payload) {
          showToast('신호 오류: ' + msg.payload.error, 'error');
        }
        break;

      case 'CHANGE_SCENE_RESULT':
        if (msg.payload && msg.payload.success) {
          showToast('장면 전환 완료', 'info');
        } else if (msg.payload) {
          showToast('장면 전환 오류: ' + msg.payload.error, 'error');
        }
        break;

      case 'ADD_FUNCTION_LIBRARY_TEMPLATE_RESULT':
        renderFunctionLibraryList();
        if (msg.payload && msg.payload.success) {
          var addedName = msg.payload.name || '함수';
          setFunctionLibraryStatus(addedName + ' 추가 완료', 'info');
          showToast(addedName + ' 추가 완료', 'info');
        } else if (msg.payload) {
          setFunctionLibraryStatus('함수 추가 오류: ' + msg.payload.error, 'error');
          showToast('함수 추가 오류: ' + msg.payload.error, 'error');
        }
        break;

      case 'FUNCTION_USAGE_OPEN_RESULT':
        if (!isDebuggerActive) {
          return;
        }

        if (msg.payload && msg.payload.success) {
          showToast('함수 블록으로 이동했습니다', 'info');
        } else if (msg.payload) {
          showToast('함수 이동 오류: ' + msg.payload.error, 'error');
        }
        break;

      case 'PONG':
        if (msg.payload && msg.payload.entryReady) {
          updateStatus('연결됨');
        }
        break;
    }
  });

  /* ═══════════════════════════════════════════
     8.5. 확장 팝업 토글 메시지 처리
     ═══════════════════════════════════════════ */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    switch (message.type) {
      case 'APPLY_SETTINGS':
        applySettings(message.settings || DEFAULT_SETTINGS);
        sendResponse({ success: true });
        break;

      case 'ENABLE_DEBUGGER':
        applySettings(DEFAULT_SETTINGS);
        sendResponse({ success: true });
        break;

      case 'DISABLE_DEBUGGER':
        applySettings({
          enabled: false,
          debuggerTabEnabled: false,
          functionUsageEnabled: false,
          consoleDebuggingEnabled: false,
          boostModeEnabled: false,
          labTabEnabled: false,
          eoUploaderEnabled: false,
          turboModeEnabled: false,
          dropdownSearchEnabled: false,
          dropdownSearchBlockMenuEnabled: extensionSettings.dropdownSearchBlockMenuEnabled,
          dropdownSearchPropertyPanelEnabled: extensionSettings.dropdownSearchPropertyPanelEnabled,
          blockTextCopyEnabled: false,
          highQualityBlockImageEnabled: false,
          highQualityBlockImageScale: extensionSettings.highQualityBlockImageScale,
          functionLibraryEnabled: false
        });
        sendResponse({ success: true });
        break;

      case 'PING_STATUS':
        sendResponse({
          onEntryPage: isEntryWorkspacePage(),
          injected: debuggerInjected,
          settings: extensionSettings
        });
        break;
    }
  });

  /* ═══════════════════════════════════════════
     8. SPA 페이지 이동 감지
     ═══════════════════════════════════════════ */

  function observeSPANavigation() {
    var currentURL = location.href;

    var origPush    = history.pushState;
    var origReplace = history.replaceState;

    history.pushState = function () {
      origPush.apply(this, arguments);
      onURLChange();
    };

    history.replaceState = function () {
      origReplace.apply(this, arguments);
      onURLChange();
    };

    window.addEventListener('popstate', onURLChange);

    function onURLChange() {
      var newURL = location.href;
      if (newURL !== currentURL) {
        currentURL = newURL;
        if (isEntryWorkspacePage()) {
          // SPA 이동 시에도 활성화 상태 확인
          chrome.storage.local.get(DEFAULT_SETTINGS, function (data) {
            extensionSettings = normalizeSettings(data);
            if (extensionSettings.enabled) {
              reinitialize();
              return;
            }
            cleanup();
          });
        } else {
          cleanup();
        }
      }
    }
  }

  function isEntryWorkspacePage() {
    try {
      var url = new URL(location.href);
      var isPlayEntryWorkspace = url.protocol === 'https:' &&
        url.hostname === 'playentry.org' &&
        url.pathname.indexOf('/ws/') === 0;
      var isLocalWorkspace = url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
        (url.port === '' || url.port === '8080') &&
        url.pathname.indexOf('/ws/') === 0;
      return isPlayEntryWorkspace || isLocalWorkspace;
    } catch (e) {
      return false;
    }
  }

  function reinitialize() {
    cleanup();
    init();
  }

  function cleanupDebuggerTabFeature() {
    sendToInject('STOP_POLLING');

    if (isDebuggerActive) {
      var fallbackTab = document.querySelector(
        '.propertyTab .' + TAB_CLASS + ':not(.' + DEBUGGING_TAB + ')'
      );
      if (fallbackTab && typeof fallbackTab.click === 'function') {
        fallbackTab.click();
      }
    }

    // 디버깅 탭 버튼 제거
    if (debuggingTabEl) {
      debuggingTabEl.remove();
      debuggingTabEl = null;
    }

    // 디버거 패널 제거
    var existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    panelEl = null;
    debuggerInjected = false;
    isDebuggerActive = false;
    expandedListIds.clear();
    if (eoUploader) eoUploader.cleanup();
    eoUploader = null;
    currentSnapshot = { variables: [], lists: [], messages: [], scenes: [], others: [], ready: false };
  }

  function cleanup() {
    cleanupDebuggerTabFeature();
    stopFunctionUsageFeature();
    stopConsoleDebuggingFeature();
    stopTurboModeFeature();
    sendToInject('SET_FUNCTION_PRIVATE_VARIABLES_ENABLED', { enabled: false });
    sendToInject('SET_DROPDOWN_SEARCH_ENABLED', { enabled: false });
    sendToInject('SET_BLOCK_TEXT_COPY_ENABLED', { enabled: false });
    sendToInject('SET_HIGH_QUALITY_BLOCK_IMAGE_ENABLED', { enabled: false });
  }

  /* ═══════════════════════════════════════════
     9. 유틸리티
     ═══════════════════════════════════════════ */

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // escapeHTML 은 따옴표(") 를 entity 로 변환하지 않아서 attribute 값에는 부족하다.
  // (예: title="abc"def" 처럼 속성이 깨질 수 있음)
  // attribute 값으로 들어가는 모든 곳은 이 함수를 사용한다.
  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
  }

  // 변수/리스트 항목 표시용 — 긴 문자열은 input 으로 띄우면 렌더링이 무거워지므로
  // 화면에는 잘린 텍스트만 보여주고 전체 값은 클릭 시에만 input 에 채운다.
  // 빈 값은 button 영역이 보이지 않아 클릭하기 어려우므로 placeholder 텍스트로 대체.
  var DISPLAY_TRUNCATE_LIMIT = 15;
  function truncateForDisplay(str) {
    str = String(str);
    if (str === '') return '(빈 값)';
    return str.length > DISPLAY_TRUNCATE_LIMIT
      ? str.slice(0, DISPLAY_TRUNCATE_LIMIT) + '…'
      : str;
  }

  function flashElement(el, className) {
    el.classList.add(className);
    setTimeout(function () {
      el.classList.remove(className);
    }, 600);
  }

  function updateStatus(text) {
    if (!panelEl) return;
    var statusEl = panelEl.querySelector('#ed-status');
    if (statusEl) statusEl.textContent = text;
  }

  function showToast(message, type) {
    if (!panelEl) return;
    var wrapper = panelEl.querySelector('.ed-wrapper');
    if (!wrapper) return;

    var toast = document.createElement('div');
    toast.className = 'ed-toast ed-toast-' + (type || 'info');
    toast.textContent = message;
    wrapper.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('ed-toast-out');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2500);
  }

  /* ═══════════════════════════════════════════
     10. 초기화
     ═══════════════════════════════════════════ */

  function initDebuggerTabFeature() {
    if (debuggerInjected) return;
    if (!isEntryWorkspacePage()) return;
    if (!isDebuggerTabFeatureEnabled()) return;

    injectDebuggerScript();

    waitForElement('.propertyTab', function (propertyTab) {
      waitForElement('.propertyContent', function (propertyContent) {
        if (debuggerInjected) return;
        if (!isDebuggerTabFeatureEnabled()) return;
        debuggerInjected = true;

        createDebuggingTab(propertyTab);
        injectDebuggerPanel(propertyContent);
        setupTabDelegation(propertyTab);

        console.log('[Entry Debugger] 준비 완료');
      });
    });
  }

  function init() {
    if (!isEntryWorkspacePage()) return;
    if (!extensionSettings.enabled) {
      cleanup();
      return;
    }

    applyBoostModeFeature();
    if (isTurboModeFeatureEnabled()) {
      startTurboModeFeature();
    } else {
      stopTurboModeFeature();
    }

    applyFunctionPrivateVariablesFeature();
    applyDropdownSearchFeature();
    applyBlockTextCopyFeature();
    applyHighQualityBlockImageFeature();

    if (isFunctionUsageFeatureEnabled()) {
      startFunctionUsageFeature();
    } else {
      stopFunctionUsageFeature();
    }

    applyConsoleDebuggingFeature();

    if (isDebuggerTabFeatureEnabled()) {
      initDebuggerTabFeature();
    } else {
      cleanupDebuggerTabFeature();
    }
  }

  observeSPANavigation();

  // 확장 활성화 상태에 따라 초기화 여부 결정
  chrome.storage.local.get(DEFAULT_SETTINGS, function (data) {
    applySettings(data);
  });

})();
