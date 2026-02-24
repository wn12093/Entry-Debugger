/**
 * content.js - Content Script (Isolated World)
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │  콘솔 탭 하이재킹 방식                                      │
 * │                                                            │
 * │  기존 콘솔 아이콘 버튼(.propertyTabconsole)을 그대로 사용.   │
 * │  콘솔 탭 클릭 시 #entryConsole 을 숨기고                    │
 * │  디버거 패널을 .propertyContent 안에 표시합니다.             │
 * │  다른 탭 클릭 시 디버거 패널을 숨기고 원래대로 복원합니다.   │
 * │                                                            │
 * │  [.propertyTab]  (25px 아이콘 탭)                           │
 * │    ├─ .propertyTabobject                                    │
 * │    ├─ .propertyTabhelper                                    │
 * │    └─ .propertyTabconsole  ← 기존 버튼 재활용               │
 * │                                                            │
 * │  [.propertyContent]                                        │
 * │    ├─ #entryConsole        ← 콘솔 활성 시 숨김              │
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

  const TAB_CLASS    = 'propertyTabElement';
  const CONSOLE_TAB  = 'propertyTabconsole';
  const PANEL_ID     = 'ed-debugger-panel';

  let debuggerInjected = false;
  let currentSnapshot = { variables: [], lists: [], messages: [], ready: false };
  let panelEl = null;          // 디버거 패널 (#ed-debugger-panel)
  let entryConsoleEl = null;   // 원본 콘솔 요소 (#entryConsole)
  let isDebuggerActive = false;
  let expandedListIds = new Set();  // 리스트 펼침 상태 추적

  /* ═══════════════════════════════════════════
     1. Main World 스크립트 주입
     ═══════════════════════════════════════════ */

  function injectMainWorldScript() {
    if (document.getElementById('entry-debugger-inject')) return;

    var script = document.createElement('script');
    script.id = 'entry-debugger-inject';
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

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
     4. 콘솔 탭 클릭 하이재킹 (이벤트 위임)
     ═══════════════════════════════════════════ */

  /**
   * .propertyTab 부모에 이벤트 위임을 등록합니다.
   *
   * (A) 콘솔 탭(.propertyTabconsole) 클릭 감지:
   *     → #entryConsole 숨기기
   *     → 디버거 패널 표시
   *
   * (B) 다른 탭(오브젝트/도움말) 클릭 감지:
   *     → 디버거 패널 숨기기
   *     (엔트리 네이티브가 자체 패널을 알아서 표시)
   *
   * 이벤트 위임이므로 SPA 재렌더링으로 탭 DOM이
   * 파괴→재생성되어도 리스너가 유지됩니다.
   */
  function setupTabDelegation(propertyTab) {
    propertyTab.addEventListener('click', function (e) {
      var clickedTab = e.target.closest('.' + TAB_CLASS);
      if (!clickedTab) return;

      if (clickedTab.classList.contains(CONSOLE_TAB)) {
        // ── (A) 콘솔 탭 클릭 → 디버거 활성화 ──
        activateDebugger();
      } else {
        // ── (B) 다른 탭 클릭 → 디버거 비활성화 ──
        deactivateDebugger();
      }
    });
  }

  /**
   * 디버거 활성화:
   * - #entryConsole을 숨기고 디버거 패널을 표시
   * - 엔트리 네이티브 로직이 이미 콘솔 탭에 selected를 붙이고
   *   콘솔 영역을 활성화한 상태이므로, 우리는 내용물만 바꾸면 됨
   */
  function activateDebugger() {
    if (!panelEl) return;

    // #entryConsole 숨기기 (엔트리가 이미 보여준 것을 가로챔)
    entryConsoleEl = document.getElementById('entryConsole');
    if (entryConsoleEl) {
      entryConsoleEl.style.display = 'none';
    }

    // 디버거 패널 표시
    panelEl.style.display = 'block';
    isDebuggerActive = true;

    // 폴링 시작
    sendToInject('START_POLLING');
    sendToInject('REQUEST_SNAPSHOT');
  }

  /**
   * 디버거 비활성화:
   * - 디버거 패널을 숨기고 #entryConsole 을 복원
   * - 엔트리 네이티브 로직이 다른 패널을 보여주므로
   *   우리는 디버거만 치우면 됨
   */
  function deactivateDebugger() {
    if (!isDebuggerActive) return;

    isDebuggerActive = false;

    // 디버거 패널 숨기기
    if (panelEl) {
      panelEl.style.display = 'none';
    }

    // #entryConsole 복원 (다음에 콘솔 탭을 눌렀을 때 보이도록)
    if (entryConsoleEl) {
      entryConsoleEl.style.display = '';
    }
  }

  /* ═══════════════════════════════════════════
     5. 디버거 패널 내부 UI 구축
     ═══════════════════════════════════════════ */

  function buildPanelHTML() {
    return (
      '<div class="ed-wrapper">' +

        /* ── 상단 툴바 ── */
        '<div class="ed-toolbar">' +
          '<div class="ed-toolbar-tabs">' +
            '<button class="ed-subtab ed-subtab-active" data-tab="variables">변수</button>' +
            '<button class="ed-subtab" data-tab="lists">리스트</button>' +
            '<button class="ed-subtab" data-tab="messages">신호</button>' +
          '</div>' +
          '<div class="ed-toolbar-right">' +
            '<button class="ed-icon-btn ed-btn-refresh" id="ed-refresh-btn" title="새로고침">&#x21BB;</button>' +
            '<span class="ed-status" id="ed-status">대기 중</span>' +
          '</div>' +
        '</div>' +

        /* ── 검색 바 ── */
        '<div class="ed-search-wrap">' +
          '<input type="text" class="ed-search" id="ed-search" placeholder="이름으로 검색..." />' +
        '</div>' +

        /* ── 콘텐츠 영역 ── */
        '<div class="ed-scroll-area" id="ed-scroll-area">' +

          /* 변수 섹션 */
          '<div class="ed-section ed-section-active" id="ed-section-variables">' +
            '<div class="ed-empty" id="ed-var-empty">' +
              '<div class="ed-empty-icon">&#x1F50D;</div>' +
              '<p>변수가 없거나 Entry가 로드되지 않았습니다.</p>' +
            '</div>' +
            '<div class="ed-items" id="ed-var-list"></div>' +
          '</div>' +

          /* 리스트 섹션 */
          '<div class="ed-section" id="ed-section-lists">' +
            '<div class="ed-empty" id="ed-list-empty">' +
              '<div class="ed-empty-icon">&#x1F4CB;</div>' +
              '<p>리스트가 없거나 Entry가 로드되지 않았습니다.</p>' +
            '</div>' +
            '<div class="ed-items" id="ed-list-list"></div>' +
          '</div>' +

          /* 신호 섹션 */
          '<div class="ed-section" id="ed-section-messages">' +
            '<div class="ed-empty" id="ed-msg-empty">' +
              '<div class="ed-empty-icon">&#x1F4E1;</div>' +
              '<p>신호가 없거나 Entry가 로드되지 않았습니다.</p>' +
            '</div>' +
            '<div class="ed-items" id="ed-msg-list"></div>' +
          '</div>' +

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
  }

  /* ═══════════════════════════════════════════
     6. 스냅샷 렌더링
     ═══════════════════════════════════════════ */

  function renderSnapshot(snapshot) {
    if (!panelEl) return;

    var searchInput = panelEl.querySelector('#ed-search');
    var searchTerm = (searchInput ? searchInput.value : '').toLowerCase();

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
  }

  /* ─── 변수 렌더링 ─── */

  function renderVariables(variables, searchTerm) {
    var listEl = panelEl.querySelector('#ed-var-list');
    var emptyEl = panelEl.querySelector('#ed-var-empty');
    if (!listEl || !emptyEl) return;

    var filtered = variables.filter(function (v) {
      if (!searchTerm) return true;
      return v.name.toLowerCase().indexOf(searchTerm) !== -1 ||
             String(v.value).toLowerCase().indexOf(searchTerm) !== -1;
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
        var input = existing.querySelector('.ed-var-input');
        if (input && document.activeElement !== input) {
          input.value = v.value;
        }
        var badge = existing.querySelector('.ed-badge');
        if (badge) {
          badge.textContent = v.object ? '지역' : '모든 오브젝트';
          badge.className = 'ed-badge ' + (v.object ? 'ed-badge-local' : 'ed-badge-global');
        }
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

    var eName = escapeHTML(v.name);
    var eVal  = escapeHTML(String(v.value));
    var bClass = v.object ? 'ed-badge-local' : 'ed-badge-global';
    var bText  = v.object ? '지역' : '모든 오브젝트';

    card.innerHTML =
      '<div class="ed-var-row-top">' +
        '<span class="ed-var-name" title="' + eName + '">' + eName + '</span>' +
        '<span class="ed-badge ' + bClass + '">' + bText + '</span>' +
      '</div>' +
      '<div class="ed-var-row-bottom">' +
        '<input type="text" class="ed-var-input" value="' + eVal + '" />' +
        '<button class="ed-btn-apply" title="값 적용">&#x2714;</button>' +
      '</div>';

    var applyBtn = card.querySelector('.ed-btn-apply');
    var input    = card.querySelector('.ed-var-input');

    applyBtn.addEventListener('click', function () {
      sendToInject('SET_VARIABLE', { id: v.id, value: input.value });
      flashElement(card, 'ed-flash');
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyBtn.click();
    });

    return card;
  }

  /* ─── 리스트 렌더링 (DOM diffing + 펼침 상태 유지) ─── */

  function renderLists(lists, searchTerm) {
    var listEl = panelEl.querySelector('#ed-list-list');
    var emptyEl = panelEl.querySelector('#ed-list-empty');
    if (!listEl || !emptyEl) return;

    var filtered = lists.filter(function (l) {
      if (!searchTerm) return true;
      return l.name.toLowerCase().indexOf(searchTerm) !== -1;
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

    // 헤더: 배지 갱신
    var badge = card.querySelector('.ed-badge');
    if (badge) {
      badge.textContent = l.object ? '지역' : '모든 오브젝트';
      badge.className = 'ed-badge ' + (l.object ? 'ed-badge-local' : 'ed-badge-global');
    }

    // 펼쳐져 있지 않으면 행 갱신 불필요
    if (!expandedListIds.has(l.id)) return;

    var body = card.querySelector('.ed-list-body');
    if (!body) return;

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

    var eName  = escapeHTML(l.name);
    var bClass = l.object ? 'ed-badge-local' : 'ed-badge-global';
    var bText  = l.object ? '지역' : '모든 오브젝트';

    var header = document.createElement('div');
    header.className = 'ed-list-header';
    header.innerHTML =
      '<div class="ed-list-header-left">' +
        '<span class="ed-list-arrow">&#x25B6;</span>' +
        '<span class="ed-list-name" title="' + eName + '">' + eName + '</span>' +
        '<span class="ed-list-count">[' + l.items.length + '개]</span>' +
      '</div>' +
      '<span class="ed-badge ' + bClass + '">' + bText + '</span>';

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

    var eVal = escapeHTML(String(item));

    row.innerHTML =
      '<span class="ed-list-idx">' + (idx + 1) + '</span>' +
      '<input type="text" class="ed-list-input" value="' + eVal + '" />' +
      '<button class="ed-btn-apply ed-btn-sm" title="적용">&#x2714;</button>' +
      '<button class="ed-btn-del ed-btn-sm" title="삭제">&#x2716;</button>';

    var applyBtn   = row.querySelector('.ed-btn-apply');
    var deleteBtn  = row.querySelector('.ed-btn-del');
    var inputField = row.querySelector('.ed-list-input');

    applyBtn.addEventListener('click', function () {
      sendToInject('SET_LIST_ITEM', { listId: l.id, index: idx, value: inputField.value });
      flashElement(row, 'ed-flash');
    });

    deleteBtn.addEventListener('click', function () {
      sendToInject('REMOVE_LIST_ITEM', { listId: l.id, index: idx });
    });

    inputField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyBtn.click();
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
      return m.name.toLowerCase().indexOf(searchTerm) !== -1;
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

      case 'PONG':
        if (msg.payload && msg.payload.entryReady) {
          updateStatus('연결됨');
        }
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
          reinitialize();
        } else {
          cleanup();
        }
      }
    }
  }

  function isEntryWorkspacePage() {
    return /^https:\/\/playentry\.org\/ws\//.test(location.href);
  }

  function reinitialize() {
    cleanup();
    init();
  }

  function cleanup() {
    sendToInject('STOP_POLLING');

    // #entryConsole 복원
    var ec = document.getElementById('entryConsole');
    if (ec) ec.style.display = '';

    // 디버거 패널 제거
    var existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    panelEl = null;
    entryConsoleEl = null;
    debuggerInjected = false;
    isDebuggerActive = false;
    expandedListIds.clear();
    currentSnapshot = { variables: [], lists: [], messages: [], ready: false };
  }

  /* ═══════════════════════════════════════════
     9. 유틸리티
     ═══════════════════════════════════════════ */

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
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

  function init() {
    if (debuggerInjected) return;
    if (!isEntryWorkspacePage()) return;

    injectMainWorldScript();

    waitForElement('.propertyTab', function (propertyTab) {
      waitForElement('.propertyContent', function (propertyContent) {
        if (debuggerInjected) return;
        debuggerInjected = true;

        injectDebuggerPanel(propertyContent);
        setupTabDelegation(propertyTab);

        console.log('[Entry Debugger] 콘솔 탭 하이재킹 완료');
      });
    });
  }

  observeSPANavigation();
  init();

})();
