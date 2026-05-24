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

  let debuggerInjected = false;
  let currentSnapshot = { variables: [], lists: [], messages: [], scenes: [], ready: false };
  let panelEl = null;          // 디버거 패널 (#ed-debugger-panel)
  let debuggingTabEl = null;   // 디버깅 탭 버튼 (.propertyTabdebugging)
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

        /* ── 상단 툴바 ── */
        '<div class="ed-toolbar">' +
          '<div class="ed-toolbar-tabs">' +
            '<button class="ed-subtab ed-subtab-active" data-tab="variables">변수</button>' +
            '<button class="ed-subtab" data-tab="lists">리스트</button>' +
            '<button class="ed-subtab" data-tab="messages">신호</button>' +
            '<button class="ed-subtab" data-tab="scenes">장면</button>' +
            '<button class="ed-subtab" data-tab="generator">생성기</button>' +
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

          /* 장면 섹션 */
          '<div class="ed-section" id="ed-section-scenes">' +
            '<div class="ed-empty" id="ed-scene-empty">' +
              '<div class="ed-empty-icon">&#x1F3AC;</div>' +
              '<p>장면이 없거나 Entry가 로드되지 않았습니다.</p>' +
            '</div>' +
            '<div class="ed-items" id="ed-scene-list"></div>' +
          '</div>' +

          /* 오브젝트 생성기 섹션 */
          '<div class="ed-section" id="ed-section-generator">' +
            '<div class="ed-generator">' +
              '<label class="ed-generator-label" for="ed-generator-name">오브젝트 이름</label>' +
              '<input type="text" class="ed-generator-input" id="ed-generator-name" placeholder="새 오브젝트" />' +
              '<label class="ed-generator-drop" for="ed-generator-files">' +
                '<span class="ed-generator-drop-title">이미지 파일 선택</span>' +
                '<span class="ed-generator-drop-desc">PNG, JPG, JPEG, GIF, WEBP, SVG 지원 · BMP 제외</span>' +
              '</label>' +
              '<input type="file" id="ed-generator-files" class="ed-generator-file" multiple ' +
                'accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/png,image/jpeg,image/gif,image/webp,image/svg+xml" />' +
              '<div class="ed-generator-file-list" id="ed-generator-file-list">선택된 파일 없음</div>' +
              '<div class="ed-generator-actions">' +
                '<button class="ed-generator-btn ed-generator-btn-primary" id="ed-generator-add">현재 작품에 추가</button>' +
                '<button class="ed-generator-btn" id="ed-generator-download">.eo 다운로드</button>' +
              '</div>' +
              '<div class="ed-generator-status" id="ed-generator-status">비트맵은 PNG로 변환하고 SVG는 PNG 미리보기 파일을 함께 만듭니다.</div>' +
            '</div>' +
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

    bindGeneratorEvents();
  }

  /* ═══════════════════════════════════════════
     5.5. 내장 오브젝트 생성기
     ═══════════════════════════════════════════ */

  const EO_ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

  function bindGeneratorEvents() {
    if (!panelEl) return;

    var fileInput = panelEl.querySelector('#ed-generator-files');
    var addBtn = panelEl.querySelector('#ed-generator-add');
    var downloadBtn = panelEl.querySelector('#ed-generator-download');
    var nameInput = panelEl.querySelector('#ed-generator-name');

    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = '1';
      fileInput.addEventListener('change', function () {
        renderGeneratorFileList();
        if (nameInput && !nameInput.value.trim() && fileInput.files && fileInput.files[0]) {
          nameInput.value = stripExtension(fileInput.files[0].name);
        }
      });
    }

    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', async function () {
        await runGeneratorAction('add');
      });
    }

    if (downloadBtn && !downloadBtn.dataset.bound) {
      downloadBtn.dataset.bound = '1';
      downloadBtn.addEventListener('click', async function () {
        await runGeneratorAction('download');
      });
    }
  }

  function renderGeneratorFileList() {
    var fileInput = panelEl && panelEl.querySelector('#ed-generator-files');
    var listEl = panelEl && panelEl.querySelector('#ed-generator-file-list');
    if (!fileInput || !listEl) return;

    var files = Array.prototype.slice.call(fileInput.files || []);
    if (!files.length) {
      listEl.textContent = '선택된 파일 없음';
      return;
    }

    listEl.innerHTML = files.map(function (file) {
      var ext = getFileExtension(file.name).toUpperCase();
      return '<div class="ed-generator-file-item">' +
        '<span>' + escapeHTML(file.name) + '</span>' +
        '<em>' + escapeHTML(ext || 'FILE') + '</em>' +
      '</div>';
    }).join('');
  }

  async function runGeneratorAction(action) {
    var fileInput = panelEl && panelEl.querySelector('#ed-generator-files');
    var nameInput = panelEl && panelEl.querySelector('#ed-generator-name');
    var files = fileInput ? Array.prototype.slice.call(fileInput.files || []) : [];
    var objectName = nameInput && nameInput.value.trim()
      ? nameInput.value.trim()
      : (files[0] ? stripExtension(files[0].name) : '새 오브젝트');

    if (!files.length) {
      setGeneratorStatus('이미지 파일을 먼저 선택하세요.', 'error');
      return;
    }

    setGeneratorBusy(true);
    setGeneratorStatus('이미지를 변환하는 중...', 'info');

    try {
      var generated = await buildEntryObjectPackage(files, objectName);
      if (action === 'download') {
        var eoBlob = await createEoBlob(generated);
        downloadBlob(eoBlob, sanitizeDownloadName(objectName).replace(/\.eo$/i, '') + '.eo');
        setGeneratorStatus('.eo 파일을 만들었습니다.', 'success');
      } else {
        sendToInject('ADD_GENERATED_OBJECT', generated.entryPayload);
        setGeneratorStatus('현재 작품에 추가 요청을 보냈습니다.', 'info');
      }
    } catch (err) {
      setGeneratorStatus(err && err.message ? err.message : String(err), 'error');
    } finally {
      setGeneratorBusy(false);
    }
  }

  function setGeneratorBusy(isBusy) {
    if (!panelEl) return;
    ['#ed-generator-add', '#ed-generator-download', '#ed-generator-files', '#ed-generator-name']
      .forEach(function (selector) {
        var el = panelEl.querySelector(selector);
        if (el) el.disabled = !!isBusy;
      });
  }

  function setGeneratorStatus(text, type) {
    var statusEl = panelEl && panelEl.querySelector('#ed-generator-status');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'ed-generator-status ed-generator-status-' + (type || 'info');
  }

  async function buildEntryObjectPackage(files, objectName) {
    var pictures = [];
    var directPictures = [];
    var entries = [];

    for (var i = 0; i < files.length; i++) {
      var picture = await buildPictureAsset(files[i], i);
      pictures.push(picture.packagePicture);
      directPictures.push(picture.directPicture);
      entries = entries.concat(picture.entries);
    }

    var firstDimension = pictures[0].dimension;
    var objectId = randomEntryId(8);
    var selectedPictureId = pictures[0].id;
    var scale = 200 / (firstDimension.width + firstDimension.height);

    var objectModel = {
      id: objectId,
      name: objectName,
      objectType: 'sprite',
      rotateMethod: 'free',
      scene: null,
      script: [],
      sprite: {
        pictures: pictures,
        sounds: []
      },
      selectedPictureId: selectedPictureId,
      entity: {
        x: 0,
        y: 0,
        regX: firstDimension.width / 2,
        regY: firstDimension.height / 2,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        direction: 90,
        width: firstDimension.width,
        height: firstDimension.height,
        font: 'undefinedpx ',
        visible: true
      },
      lock: false,
      active: true
    };

    var directObject = JSON.parse(JSON.stringify(objectModel));
    directObject.sprite.pictures = directPictures;

    var objectJson = {
      objects: [objectModel],
      variables: [],
      messages: [],
      functions: [],
      tables: [],
      expansionBlocks: [],
      aiUtilizeBlocks: []
    };

    return {
      objectName: objectName,
      objectJson: objectJson,
      entries: entries,
      entryPayload: {
        object: directObject
      }
    };
  }

  async function buildPictureAsset(file, index) {
    var ext = getFileExtension(file.name);
    if (ext === 'bmp') {
      throw new Error('BMP 파일은 Entry가 지원하지 않아 사용할 수 없습니다: ' + file.name);
    }
    if (EO_ACCEPTED_EXTENSIONS.indexOf(ext) === -1) {
      throw new Error('지원하지 않는 파일 형식입니다: ' + file.name);
    }

    var pictureId = randomEntryId(4);
    var filename = randomEntryId(32);
    var dirA = filename.slice(0, 2);
    var dirB = filename.slice(2, 4);
    var displayName = stripExtension(file.name) || ('모양' + (index + 1));
    var basePath = 'temp/' + dirA + '/' + dirB;
    var tarBasePath = 'object/' + dirA + '/' + dirB;

    if (ext === 'svg') {
      var svgText = await readFileAsText(file);
      var dimension = extractSvgDimensions(svgText);
      var fullPng = await rasterizeSvgFullSize(svgText, dimension.width, dimension.height);
      var thumbPng = await rasterizeSvgThumb(svgText, dimension.width, dimension.height);
      var svgBytes = new TextEncoder().encode(svgText);
      var fullPngBytes = new Uint8Array(await fullPng.arrayBuffer());
      var thumbPngBytes = new Uint8Array(await thumbPng.arrayBuffer());
      var svgDataUrl = await blobToDataUrl(new Blob([svgBytes], { type: 'image/svg+xml' }));
      var thumbDataUrl = await blobToDataUrl(thumbPng);

      return {
        packagePicture: {
          id: pictureId,
          name: displayName,
          filename: filename,
          imageType: 'svg',
          fileurl: basePath + '/image/' + filename + '.svg',
          thumbUrl: basePath + '/thumb/' + filename + '.png',
          dimension: dimension
        },
        directPicture: {
          id: pictureId,
          name: displayName,
          filename: filename,
          imageType: 'svg',
          fileurl: svgDataUrl,
          thumbUrl: thumbDataUrl,
          dimension: dimension
        },
        entries: [
          { path: tarBasePath + '/image/' + filename + '.svg', bytes: svgBytes },
          { path: tarBasePath + '/image/' + filename + '.png', bytes: fullPngBytes },
          { path: tarBasePath + '/thumb/' + filename + '.png', bytes: thumbPngBytes }
        ]
      };
    }

    var bitmap = await bitmapToPng(file);
    var thumb = await rasterizeBitmapThumb(bitmap.imageSource, bitmap.width, bitmap.height);
    var pngBytes = new Uint8Array(await bitmap.blob.arrayBuffer());
    var thumbBytes = new Uint8Array(await thumb.arrayBuffer());
    var pngDataUrl = await blobToDataUrl(bitmap.blob);
    var thumbDataUrlBitmap = await blobToDataUrl(thumb);
    if (bitmap.close) bitmap.close();

    var bitmapDimension = {
      width: bitmap.width,
      height: bitmap.height
    };

    return {
      packagePicture: {
        id: pictureId,
        name: displayName,
        filename: filename,
        imageType: 'png',
        fileurl: basePath + '/image/' + filename + '.png',
        thumbUrl: basePath + '/thumb/' + filename + '.png',
        dimension: bitmapDimension
      },
      directPicture: {
        id: pictureId,
        name: displayName,
        filename: filename,
        imageType: 'png',
        fileurl: pngDataUrl,
        thumbUrl: thumbDataUrlBitmap,
        dimension: bitmapDimension
      },
      entries: [
        { path: tarBasePath + '/image/' + filename + '.png', bytes: pngBytes },
        { path: tarBasePath + '/thumb/' + filename + '.png', bytes: thumbBytes }
      ]
    };
  }

  async function createEoBlob(generated) {
    var objectJsonBytes = new TextEncoder().encode(JSON.stringify(generated.objectJson, null, 2));
    var tarEntries = [{ path: 'object.json', bytes: objectJsonBytes }].concat(generated.entries);
    var tarBytes = createTarBytes(tarEntries);
    var gzipBytes = await gzipUint8Array(tarBytes);
    return new Blob([gzipBytes], { type: 'application/octet-stream' });
  }

  async function bitmapToPng(file) {
    var source;
    var close = null;
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(file);
      close = function () {
        if (source && typeof source.close === 'function') source.close();
      };
    } else {
      source = await loadImageFromBlob(file);
    }

    var width = source.width || source.naturalWidth;
    var height = source.height || source.naturalHeight;
    if (!width || !height) {
      if (close) close();
      throw new Error('이미지 크기를 읽을 수 없습니다: ' + file.name);
    }

    var canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(source, 0, 0, width, height);
    var blob = await canvasToPngBlob(canvas);
    return { blob: blob, width: width, height: height, imageSource: source, close: close };
  }

  async function rasterizeBitmapThumb(source, srcW, srcH) {
    var size = thumbSize(srcW, srcH);
    var canvas = createCanvas(size.w, size.h);
    canvas.getContext('2d').drawImage(source, 0, 0, size.w, size.h);
    return canvasToPngBlob(canvas);
  }

  async function rasterizeSvgFullSize(svgText, width, height) {
    var blob = new Blob([svgText], { type: 'image/svg+xml' });
    var img = await loadImageFromBlob(blob);
    var canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return canvasToPngBlob(canvas);
  }

  async function rasterizeSvgThumb(svgText, srcW, srcH) {
    var size = thumbSize(srcW, srcH);
    return rasterizeSvgFullSize(svgText, size.w, size.h);
  }

  function extractSvgDimensions(svgText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() === 'parsererror') {
      throw new Error('SVG 파일을 해석할 수 없습니다.');
    }

    var width = parseFloat(svg.getAttribute('width'));
    var height = parseFloat(svg.getAttribute('height'));
    if (!width || !height) {
      var viewBox = svg.getAttribute('viewBox');
      if (viewBox) {
        var parts = viewBox.trim().split(/\s+/).map(Number);
        if (parts.length >= 4) {
          width = width || parts[2];
          height = height || parts[3];
        }
      }
    }

    width = Math.round(width);
    height = Math.round(height);
    if (!width || !height || width < 1 || height < 1) {
      throw new Error('SVG의 width/height 또는 viewBox를 찾을 수 없습니다.');
    }
    return { width: width, height: height };
  }

  function thumbSize(width, height) {
    return width >= height
      ? { w: 96, h: Math.max(1, Math.round(height * 96 / width)) }
      : { w: Math.max(1, Math.round(width * 96 / height)), h: 96 };
  }

  function createCanvas(width, height) {
    if (typeof OffscreenCanvas === 'function') {
      return new OffscreenCanvas(width, height);
    }
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function canvasToPngBlob(canvas) {
    if (canvas.convertToBlob) {
      return canvas.convertToBlob({ type: 'image/png' });
    }
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('PNG 변환에 실패했습니다.'));
      }, 'image/png');
    });
  }

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('이미지를 불러올 수 없습니다.'));
      };
      img.src = url;
    });
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('파일을 읽을 수 없습니다: ' + file.name)); };
      reader.readAsText(file);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Data URL 변환에 실패했습니다.')); };
      reader.readAsDataURL(blob);
    });
  }

  function createTarBytes(entries) {
    var chunks = [];
    entries.forEach(function (entry) {
      var data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
      var header = createTarHeader(entry.path, data.length);
      chunks.push(header, data);
      var padding = (512 - (data.length % 512)) % 512;
      if (padding) chunks.push(new Uint8Array(padding));
    });
    chunks.push(new Uint8Array(1024));
    return concatUint8Arrays(chunks);
  }

  function createTarHeader(path, size) {
    var header = new Uint8Array(512);
    writeTarString(header, 0, 100, path);
    writeTarString(header, 100, 8, '0000644\0');
    writeTarString(header, 108, 8, '0000000\0');
    writeTarString(header, 116, 8, '0000000\0');
    writeTarString(header, 124, 12, formatTarOctal(size, 12));
    writeTarString(header, 136, 12, formatTarOctal(Math.floor(Date.now() / 1000), 12));
    for (var i = 148; i < 156; i++) header[i] = 32;
    header[156] = 48;
    writeTarString(header, 257, 6, 'ustar\0');
    writeTarString(header, 263, 2, '00');

    var checksum = 0;
    for (var j = 0; j < header.length; j++) checksum += header[j];
    var checksumText = checksum.toString(8).padStart(6, '0');
    writeTarString(header, 148, 6, checksumText);
    header[154] = 0;
    header[155] = 32;
    return header;
  }

  function writeTarString(buffer, offset, length, text) {
    var bytes = new TextEncoder().encode(text);
    var max = Math.min(length, bytes.length);
    for (var i = 0; i < max; i++) buffer[offset + i] = bytes[i];
  }

  function formatTarOctal(value, length) {
    return value.toString(8).padStart(length - 1, '0') + '\0';
  }

  async function gzipUint8Array(bytes) {
    if (typeof CompressionStream !== 'function') {
      throw new Error('이 브라우저는 gzip 압축을 지원하지 않습니다.');
    }
    var stream = new CompressionStream('gzip');
    var writer = stream.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
    var buffer = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function concatUint8Arrays(chunks) {
    var total = chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
    var output = new Uint8Array(total);
    var offset = 0;
    chunks.forEach(function (chunk) {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/\.gz$/i, '.eo');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function getFileExtension(name) {
    var parts = String(name || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function stripExtension(name) {
    return String(name || '').replace(/\.[^.]+$/, '');
  }

  function sanitizeDownloadName(name) {
    return String(name || 'entry-object')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim() || 'entry-object';
  }

  function randomEntryId(length) {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var output = '';
    var values = new Uint8Array(length);
    crypto.getRandomValues(values);
    for (var i = 0; i < length; i++) {
      output += chars[values[i] % chars.length];
    }
    return output;
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
    renderScenes(snapshot.scenes || [], searchTerm);
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

    var fullVal = String(v.value);
    var attrName    = escapeAttr(v.name);
    var attrFullVal = escapeAttr(fullVal);
    var eName       = escapeHTML(v.name);
    var eDisplayVal = escapeHTML(truncateForDisplay(fullVal));
    var bClass = v.object ? 'ed-badge-local' : 'ed-badge-global';
    var bText  = v.object ? '지역' : '모든 오브젝트';

    card.innerHTML =
      '<div class="ed-var-row-top">' +
        '<span class="ed-var-name" title="' + attrName + '">' + eName + '</span>' +
        '<span class="ed-badge ' + bClass + '">' + bText + '</span>' +
      '</div>' +
      '<button class="ed-var-display" title="' + attrFullVal + '">' + eDisplayVal + '</button>' +
      '<div class="ed-var-row-bottom">' +
        '<input type="text" class="ed-var-input" value="' + attrFullVal + '" />' +
        '<button class="ed-btn-apply" title="값 적용">&#x2714;</button>' +
      '</div>';

    var displayBtn = card.querySelector('.ed-var-display');
    var applyBtn   = card.querySelector('.ed-btn-apply');
    var input      = card.querySelector('.ed-var-input');

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

  /* ─── 장면 렌더링 ─── */

  function renderScenes(scenes, searchTerm) {
    var listEl = panelEl.querySelector('#ed-scene-list');
    var emptyEl = panelEl.querySelector('#ed-scene-empty');
    if (!listEl || !emptyEl) return;

    var filtered = scenes.filter(function (s) {
      if (!searchTerm) return true;
      return s.name.toLowerCase().indexOf(searchTerm) !== -1;
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

      case 'CHANGE_SCENE_RESULT':
        if (msg.payload && msg.payload.success) {
          showToast('장면 전환 완료', 'info');
        } else if (msg.payload) {
          showToast('장면 전환 오류: ' + msg.payload.error, 'error');
        }
        break;

      case 'ADD_GENERATED_OBJECT_RESULT':
        if (msg.payload && msg.payload.success) {
          showToast('오브젝트 추가 완료', 'info');
          setGeneratorStatus('현재 작품에 오브젝트를 추가했습니다.', 'success');
          sendToInject('REQUEST_SNAPSHOT');
        } else if (msg.payload) {
          showToast('오브젝트 추가 오류: ' + msg.payload.error, 'error');
          setGeneratorStatus('오브젝트 추가 오류: ' + msg.payload.error, 'error');
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
      case 'ENABLE_DEBUGGER':
        init();
        sendResponse({ success: true });
        break;

      case 'DISABLE_DEBUGGER':
        cleanup();
        sendResponse({ success: true });
        break;

      case 'PING_STATUS':
        sendResponse({
          onEntryPage: isEntryWorkspacePage(),
          injected: debuggerInjected
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
          chrome.storage.local.get({ enabled: true }, function (data) {
            if (data.enabled) {
              reinitialize();
            } else {
              cleanup();
            }
          });
        } else {
          cleanup();
        }
      }
    }
  }

  function isEntryWorkspacePage() {
    return /^https:\/\/playentry\.org\/ws\//.test(location.href) ||
           /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/ws\//.test(location.href);
  }

  function reinitialize() {
    cleanup();
    init();
  }

  function cleanup() {
    sendToInject('STOP_POLLING');

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
    currentSnapshot = { variables: [], lists: [], messages: [], scenes: [], ready: false };
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

  function init() {
    if (debuggerInjected) return;
    if (!isEntryWorkspacePage()) return;

    injectMainWorldScript();

    waitForElement('.propertyTab', function (propertyTab) {
      waitForElement('.propertyContent', function (propertyContent) {
        if (debuggerInjected) return;
        debuggerInjected = true;

        createDebuggingTab(propertyTab);
        injectDebuggerPanel(propertyContent);
        setupTabDelegation(propertyTab);

        console.log('[Entry Debugger] 준비 완료');
      });
    });
  }

  observeSPANavigation();

  // 확장 활성화 상태에 따라 초기화 여부 결정
  chrome.storage.local.get({ enabled: true }, function (data) {
    if (data.enabled) {
      init();
    }
  });

})();
