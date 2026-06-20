/**
 * frame-profiler.js - Main World 프레임 코드사용량 프로파일러
 *
 * 작품 실행 중에만, 매 프레임 각 오브젝트(Entry.Code.tick)와 각 스크립트
 * 스레드(Entry.Executor.execute)의 실행 시간을 측정해 "어느 오브젝트의 어느
 * 스크립트가 프레임을 잡아먹는지" 실시간 오버레이로 보여준다.
 *
 *  · Entry.Code.prototype.tick        → 오브젝트별 프레임 시간 (code.object)
 *  · Entry.Executor.prototype.execute → 스레드별 시간 (executor.code.object + 햇블록)
 *
 * 오버레이의 스크립트 항목을 클릭하면 그 오브젝트를 선택하고 해당 코드로
 * 스크롤·하이라이트한다(편집창의 실제 블록을 그대로 보여줌).
 *
 * 측정 오버헤드를 줄이려고 enabled && 실행중일 때만 동작하고, 표시는 EMA로
 * 부드럽게 + DOM 갱신은 throttle 한다.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_FRAME_PROFILER_INJECTED__) return;
  window.__ENTRY_DEBUGGER_FRAME_PROFILER_INJECTED__ = true;

  var CHANNEL = '__ENTRY_DEBUGGER__';
  var STORAGE_KEY = '__ENTRY_DEBUGGER_FRAME_PROFILER_ENABLED__';
  var PATCH_ID = 'frame-profiler';
  var RETRY_INTERVAL = 300;
  var RETRY_TIMEOUT = 60000;
  var Bridge = window.EntryDebuggerPageBridge || null;
  var Adapter = window.EntryDebuggerEntryAdapter || null;
  var Patches = window.EntryDebuggerPatchRegistry || null;

  var EMA = 0.75;            // 표시 평활(이전값 비중)
  var OVERLAY_MS = 120;      // 오버레이 DOM 갱신 주기
  var TOP_N = 14;            // 표시할 상위 오브젝트 수

  var enabled = readStoredEnabled();
  var running = false;       // 실행(run) 또는 일시정지(pause) 상태 — 오버레이 표시 유지
  var paused = false;        // 일시정지: 마지막 상태 고정(측정/감쇠 멈춤)
  var active = false;        // enabled && 실행중(run) — 후킹 래퍼가 읽음
  var hooksInstalled = false;
  var retryTimer = null;
  var retryUntil = 0;
  var rafId = 0;
  var lastOverlayAt = 0;
  var lastFrameAt = 0;
  var fps = 0;

  var frameObj = {};         // objId -> { name, thumb, t }
  var frameThread = {};      // key -> { objId, objName, label, hatId, t }
  var dispObj = {};
  var dispThread = {};
  var hatCache = {};         // executor.id -> { hatId, label }
  var expanded = {};         // objId -> true

  var now = (window.performance && window.performance.now)
    ? function () { return window.performance.now(); }
    : function () { return Date.now(); };

  /* ───────── 통신/유틸 (boost-mode.js 패턴) ───────── */

  function readStoredEnabled() {
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }
  function writeStoredEnabled(v) {
    try { window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (e) {}
  }
  function post(type, payload, requestId) {
    if (Bridge && typeof Bridge.post === 'function') { Bridge.post(type, payload, requestId); return; }
    window.postMessage({ channel: CHANNEL, type: type, payload: payload || null, requestId: requestId || null }, window.location.origin);
  }
  function onMessage(handler) {
    if (Bridge && typeof Bridge.onMessage === 'function') { Bridge.onMessage(handler); return; }
    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.channel !== CHANNEL) return;
      handler(event.data);
    });
  }
  function safeGetEntry() {
    if (Adapter && typeof Adapter.getEntry === 'function') return Adapter.getEntry();
    try { return window.Entry || null; } catch (e) { return null; }
  }
  function objName(obj) {
    if (!obj) return '(오브젝트)';
    if (typeof obj.getName === 'function') { try { return obj.getName() || obj.id; } catch (e) {} }
    return obj.name || obj.name_ || obj.id || '(오브젝트)';
  }
  function objThumb(obj) {
    if (!obj) return '';
    if (obj.thumbUrl) return obj.thumbUrl;
    try { if (obj.entity && obj.entity.picture && obj.entity.picture.fileurl) return obj.entity.picture.fileurl; } catch (e) {}
    try { var p = typeof obj.getPicture === 'function' ? obj.getPicture() : null; if (p && p.fileurl) return p.fileurl; } catch (e) {}
    return '';
  }

  /* ───────── 햇블록(이벤트 스크립트) 한글 라벨 ───────── */

  var HAT_LABELS = {
    when_run_button_click: '시작하기 클릭',
    when_some_key_pressed: '키를 눌렀을 때',
    when_press_key: '키를 눌렀을 때',
    mouse_clicked: '마우스 클릭',
    mouse_click_cancled: '마우스 클릭 해제',
    when_object_click: '오브젝트 클릭',
    when_object_click_canceled: '오브젝트 클릭 해제',
    when_message_cast: '신호를 받았을 때',
    when_scene_start: '장면이 시작됐을 때',
    when_clone_start: '복제본이 생성됐을 때',
    when_make_clone: '복제본 생성',
    when_touch_object: '오브젝트에 닿았을 때'
  };
  function hatLabel(type) {
    if (!type) return '(스크립트)';
    if (HAT_LABELS[type]) return HAT_LABELS[type];
    if (type.indexOf('func_') === 0) return '함수';
    return type;
  }

  // executor의 루트 햇블록을 (첫 등장 시 scope가 최상단이라) 캐싱해 식별.
  function deriveHat(ex) {
    try {
      var b = ex.scope && ex.scope.block;
      if (!b || typeof b.getThread !== 'function') return null;
      var th = b.getThread();
      var hat = th && typeof th.getFirstBlock === 'function' ? th.getFirstBlock() : null;
      if (!hat) return null;
      return { hatId: hat.id || (hat.type + ''), label: hatLabel(hat.type) };
    } catch (e) { return null; }
  }

  function recordThread(ex, dt) {
    try {
      var code = ex.code, obj = code && code.object;
      if (!obj) return;
      var info = hatCache[ex.id];
      if (!info) { info = deriveHat(ex); if (info) hatCache[ex.id] = info; }
      if (!info) return;
      var key = obj.id + '' + info.hatId;
      var bucket = frameThread[key];
      if (!bucket) { bucket = frameThread[key] = { objId: obj.id, objName: objName(obj), label: info.label, hatId: info.hatId, t: 0 }; }
      bucket.t += dt;
    } catch (e) {}
  }

  /* ───────── 후킹 ───────── */

  function wrapTick(orig) {
    return function () {
      if (!active) return orig.apply(this, arguments);
      var t0 = now();
      var r = orig.apply(this, arguments);
      try {
        var obj = this.object;
        if (obj) {
          var b = frameObj[obj.id];
          if (!b) { b = frameObj[obj.id] = { name: objName(obj), thumb: objThumb(obj), t: 0 }; }
          b.t += now() - t0;
        }
      } catch (e) {}
      return r;
    };
  }
  function wrapExecute(orig) {
    return function () {
      if (!active) return orig.apply(this, arguments);
      var t0 = now();
      var r = orig.apply(this, arguments);
      recordThread(this, now() - t0);
      return r;
    };
  }
  function patch(target, method, factory) {
    if (!target || typeof target[method] !== 'function') return false;
    if (Patches && typeof Patches.patchMethod === 'function') {
      return Patches.patchMethod(target, method, PATCH_ID, factory);
    }
    if (target['__ed_fp_' + method]) return true;
    var orig = target[method];
    target[method] = factory(orig);
    target['__ed_fp_' + method] = true;
    return true;
  }
  function tryInstallHooks() {
    var E = safeGetEntry();
    if (!E || !E.Code || !E.Code.prototype || !E.Executor || !E.Executor.prototype) return false;
    var a = patch(E.Code.prototype, 'tick', wrapTick);
    var b = patch(E.Executor.prototype, 'execute', wrapExecute);
    return a && b;
  }
  function clearRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
  function installHooks() {
    if (hooksInstalled) return;
    if (tryInstallHooks()) { hooksInstalled = true; return; }
    clearRetry();
    retryUntil = Date.now() + RETRY_TIMEOUT;
    (function tick() {
      retryTimer = null;
      if (tryInstallHooks()) { hooksInstalled = true; return; }
      if (Date.now() < retryUntil) retryTimer = setTimeout(tick, RETRY_INTERVAL);
    })();
  }

  /* ───────── 클릭 → 실제 코드로 점프+하이라이트 ───────── */
  // (function-usage-inspector.js 의 focusBlockWhenReady 패턴)
  function jumpToCode(objId, hatId) {
    var E = safeGetEntry();
    if (!E || !E.container) return;
    try { if (typeof E.container.selectObject === 'function') E.container.selectObject(objId); } catch (e) {}
    focusBlock(objId, hatId, 0);
  }
  function focusBlock(objId, hatId, attempt) {
    var E = safeGetEntry();
    var obj = E && E.container && typeof E.container.getObject === 'function' ? E.container.getObject(objId) : null;
    var block = obj && obj.script && typeof obj.script.findById === 'function' ? obj.script.findById(hatId) : null;
    var view = block && block.view;
    var board = view && typeof view.getBoard === 'function' ? view.getBoard() : null;
    if (block && view && board) {
      try {
        if (typeof board.activateBlock === 'function') board.activateBlock(block);
        if (typeof board.setSelectedBlock === 'function') board.setSelectedBlock(view);
      } catch (e) {}
      return;
    }
    if (attempt >= 12) return;
    setTimeout(function () { focusBlock(objId, hatId, attempt + 1); }, 120);
  }

  /* ───────── 프레임 루프: EMA 누적 ───────── */

  function decayAdd(disp, frame, makeEntry) {
    var id;
    for (id in disp) { if (disp.hasOwnProperty(id)) disp[id].t *= EMA; }
    for (id in frame) {
      if (!frame.hasOwnProperty(id)) continue;
      var f = frame[id];
      var d = disp[id];
      if (!d) { d = disp[id] = makeEntry(f); }
      d.t += (1 - EMA) * f.t;
      if (f.name) d.name = f.name;
      if (f.thumb) d.thumb = f.thumb;
      if (f.objName) d.objName = f.objName;
      if (f.label) d.label = f.label;
    }
    for (id in disp) { if (disp.hasOwnProperty(id) && disp[id].t < 0.01) delete disp[id]; }
  }
  function flushFrame() {
    decayAdd(dispObj, frameObj, function (f) { return { name: f.name, thumb: f.thumb, t: 0 }; });
    decayAdd(dispThread, frameThread, function (f) {
      return { objId: f.objId, objName: f.objName, label: f.label, hatId: f.hatId, t: 0 };
    });
    frameObj = {};
    frameThread = {};
  }
  function resetData() { frameObj = {}; frameThread = {}; dispObj = {}; dispThread = {}; hatCache = {}; orderedIds = []; lastSig = ''; }
  function hasKeys(o) { for (var k in o) { if (o.hasOwnProperty(k)) return true; } return false; }

  function frameLoop() {
    rafId = 0;
    if (!enabled) return;
    var E = safeGetEntry();
    var eng = E && E.engine;
    var isRun = !!(eng && typeof eng.isState === 'function' && eng.isState('run'));
    var isPause = !!(eng && typeof eng.isState === 'function' && eng.isState('pause'));
    active = enabled && isRun;

    if (isRun) {
      running = true; paused = false;
      var t = now();
      if (lastFrameAt) { var d = t - lastFrameAt; if (d > 0) fps = fps ? (fps * 0.9 + (1000 / d) * 0.1) : (1000 / d); }
      lastFrameAt = t;
      flushFrame();
      if (t - lastOverlayAt >= OVERLAY_MS) { lastOverlayAt = t; updateOverlay(); }
    } else if (isPause && running) {
      // 일시정지 → 마지막 상태 그대로 고정 (측정/EMA감쇠 멈춤, 오버레이 유지)
      lastFrameAt = 0;
      if (!paused) { paused = true; updateOverlay(); }
    } else if (running) {
      // 정지 → 오버레이 제거 + 데이터 비움
      running = false; paused = false; lastFrameAt = 0;
      resetData();
      removeOverlay();
    }
    rafId = window.requestAnimationFrame(frameLoop);
  }
  function startLoop() { if (!rafId) { lastFrameAt = 0; rafId = window.requestAnimationFrame(frameLoop); } }
  function stopLoop() { if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; } }

  /* ───────── 오버레이 UI (엔트리 톤: 흰 패널 + #4f80ff) ───────── */

  var ov = null, ovList = null, ovMeta = null;
  var collapsed = false;
  var panelPos = null;                                  // 드래그 위치 유지
  var orderedIds = [], lastOrderAt = 0, lastSig = '';   // 순서 throttle + 구조 재렌더 캐시
  var ORDER_MS = 700;                                   // 행 순서 갱신 주기(자주 바뀌면 클릭이 어려움)
  var hovering = false;                                 // 패널 위에 있으면 순서 고정(클릭 쉽게)

  function sev(ms) { return ms >= 4 ? '#e23c3c' : ms >= 1.2 ? '#e8920a' : '#1aa85a'; }
  function fmt(ms) { return ms >= 10 ? ms.toFixed(0) : ms.toFixed(ms >= 1 ? 1 : 2); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function ensureOverlay() {
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'ed-frame-profiler';
    ov.style.cssText = [
      'position:fixed', 'z-index:2147483600', 'width:272px', 'max-height:74vh',
      'display:flex', 'flex-direction:column', 'background:#ffffff', 'color:#2b2e3a',
      'border:1px solid #e1e6f0', 'border-radius:10px', 'box-shadow:0 8px 26px rgba(40,60,120,.20)',
      'overflow:hidden', 'font:12px/1.5 "Nanum Gothic","Malgun Gothic",sans-serif', 'user-select:none'
    ].join(';');
    if (panelPos) { ov.style.left = panelPos.x + 'px'; ov.style.top = panelPos.y + 'px'; }
    else { ov.style.top = '64px'; ov.style.right = '12px'; }

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;background:#4f80ff;color:#fff;cursor:move;';
    var title = document.createElement('div');
    title.innerHTML = '<b>⚡ 프레임 프로파일러</b>';
    title.style.cssText = 'flex:1;white-space:nowrap;font-size:12px;';
    ovMeta = document.createElement('div');
    ovMeta.style.cssText = 'font-size:10px;color:rgba(255,255,255,.85);white-space:nowrap;';
    var btn = document.createElement('div');
    btn.textContent = '–';
    btn.title = '접기/펼치기';
    btn.style.cssText = 'cursor:pointer;padding:0 5px;color:#fff;font-weight:bold;font-size:14px;';
    btn.onclick = function (e) {
      e.stopPropagation();
      collapsed = !collapsed;
      ovList.style.display = collapsed ? 'none' : 'block';
      btn.textContent = collapsed ? '+' : '–';
    };
    head.appendChild(title); head.appendChild(ovMeta); head.appendChild(btn);

    ovList = document.createElement('div');
    ovList.style.cssText = 'padding:5px 6px 8px;overflow:auto;';
    if (collapsed) ovList.style.display = 'none';

    ov.appendChild(head);
    ov.appendChild(ovList);
    (document.body || document.documentElement).appendChild(ov);
    ov.addEventListener('mouseenter', function () { hovering = true; });
    ov.addEventListener('mouseleave', function () { hovering = false; });
    makeDraggable(ov, head);
    return ov;
  }
  function makeDraggable(el, handle) {
    var sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
    handle.addEventListener('mousedown', function (e) {
      if (e.target && e.target.title === '접기/펼치기') return;
      drag = true; sx = e.clientX; sy = e.clientY;
      var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var x = ox + e.clientX - sx, y = oy + e.clientY - sy;
      el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto';
      panelPos = { x: x, y: y };
    });
    document.addEventListener('mouseup', function () { drag = false; });
  }
  function removeOverlay() {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    ov = null; ovList = null; ovMeta = null;
    lastSig = ''; orderedIds = [];                       // 다음에 다시 만들 때 새로 그리도록
  }

  function threadsOf(objId) {
    var arr = [], k;
    for (k in dispThread) { if (dispThread.hasOwnProperty(k) && dispThread[k].objId === objId) arr.push(dispThread[k]); }
    arr.sort(function (a, b) { return b.t - a.t; });
    return arr;
  }

  // 막대 + 숫자 (제자리 갱신을 위해 .ed-fp-bar / .ed-fp-val 클래스 부여)
  function barVal(t, h) {
    return '<div style="width:46px;height:' + h + 'px;background:#eef1f7;border-radius:3px;overflow:hidden;flex:none">' +
      '<div class="ed-fp-bar" style="height:100%;width:3%;background:' + sev(t) + '"></div></div>' +
      '<div class="ed-fp-val" style="width:38px;text-align:right;color:' + sev(t) + ';font-weight:bold;font-variant-numeric:tabular-nums;flex:none">' + fmt(t) + '</div>';
  }
  function objRowHtml(id, name, thumb, t, open) {
    var img = thumb
      ? '<img class="ed-fp-thumb" src="' + escapeHtml(thumb) + '" style="width:22px;height:22px;border-radius:4px;object-fit:cover;background:#f3f6fd;border:1px solid #e4e8f0;flex:none">'
      : '<span style="width:22px;height:22px;border-radius:4px;background:#f3f6fd;border:1px solid #e4e8f0;flex:none"></span>';
    return '<div class="ed-fp-obj" data-obj="' + escapeHtml(id) + '" style="display:flex;align-items:center;gap:7px;padding:4px 5px;border-radius:6px;cursor:pointer">' +
      '<span class="ed-fp-caret" style="color:#8c97b2;font-size:9px;width:8px;flex:none">' + (open ? '▾' : '▸') + '</span>' + img +
      '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:bold">' + escapeHtml(name) + '</div>' +
      barVal(t, 6) + '</div>';
  }
  function threadRowHtml(th) {
    return '<div class="ed-fp-thread" data-obj="' + escapeHtml(th.objId) + '" data-hat="' + escapeHtml(th.hatId) + '" ' +
      'title="클릭하면 이 코드로 이동합니다" ' +
      'style="display:flex;align-items:center;gap:7px;padding:3px 5px 3px 24px;border-radius:6px;cursor:pointer;color:#5a6b86">' +
      '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(th.label) + ' <span style="color:#b3bdd2;font-size:10px">↗ 코드</span></div>' +
      barVal(th.t, 5) + '</div>';
  }

  function computeOrder() {
    var arr = [], id;
    for (id in dispObj) { if (dispObj.hasOwnProperty(id)) arr.push(id); }
    arr.sort(function (a, b) { return dispObj[b].t - dispObj[a].t; });
    return arr.slice(0, TOP_N);
  }
  // 구조 서명: 순서·펼침·스레드 구성이 바뀔 때만 DOM을 다시 만든다(클릭 안정).
  function structureSig(order) {
    var s = '';
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      s += id + (expanded[id] ? '+' : '-') + ';';
      if (expanded[id]) {
        var ths = threadsOf(id), ids = [];
        for (var j = 0; j < ths.length && j < 8; j++) ids.push(ths[j].hatId);
        ids.sort();                       // 순서 무관: 스레드 집합이 바뀔 때만 재렌더(값 변동·순위교체로는 안 함)
        s += ids.join(',');
      }
    }
    return s;
  }
  function cssEsc(s) { return String(s).replace(/["\\\]]/g, '\\$&'); }
  function setBarVal(rowEl, t, max) {
    if (!rowEl) return;
    var bar = rowEl.querySelector('.ed-fp-bar'), val = rowEl.querySelector('.ed-fp-val');
    var w = max > 0 ? Math.max(3, Math.round((t / max) * 100)) : 3;
    if (bar) { bar.style.width = w + '%'; bar.style.background = sev(t); }
    if (val) { val.textContent = fmt(t); val.style.color = sev(t); }
  }
  function rebuildRows(order) {
    var html = '';
    for (var i = 0; i < order.length; i++) {
      var id = order[i], it = dispObj[id];
      if (!it) continue;
      html += objRowHtml(id, it.name, it.thumb, it.t, !!expanded[id]);
      if (expanded[id]) {
        var ths = threadsOf(id);
        for (var j = 0; j < ths.length && j < 8; j++) html += threadRowHtml(ths[j]);
        if (!ths.length) html += '<div style="padding:2px 24px;color:#aab2c6;font-size:10px">실행된 스크립트 없음</div>';
      }
    }
    ovList.innerHTML = html;
    bindRowEvents();
  }
  function bindRowEvents() {
    var rows = ovList.querySelectorAll('.ed-fp-obj'), k;
    for (k = 0; k < rows.length; k++) {
      rows[k].addEventListener('mouseenter', function () { this.style.background = '#f3f6fd'; });
      rows[k].addEventListener('mouseleave', function () { this.style.background = ''; });
      // mousedown: 누르는 즉시 반응(클릭 down/up 사이 재렌더로 씹히는 것 방지)
      rows[k].addEventListener('mousedown', function (e) {
        e.preventDefault();
        var oid = this.getAttribute('data-obj');
        expanded[oid] = !expanded[oid];
        lastSig = ''; updateOverlay();
      });
    }
    var ths = ovList.querySelectorAll('.ed-fp-thread');
    for (k = 0; k < ths.length; k++) {
      ths[k].addEventListener('mouseenter', function () { this.style.background = '#eaf0ff'; });
      ths[k].addEventListener('mouseleave', function () { this.style.background = ''; });
      ths[k].addEventListener('mousedown', function (e) {
        e.preventDefault(); e.stopPropagation();
        jumpToCode(this.getAttribute('data-obj'), this.getAttribute('data-hat'));
      });
    }
    var thumbs = ovList.querySelectorAll('.ed-fp-thumb');
    for (k = 0; k < thumbs.length; k++) thumbs[k].addEventListener('error', function () { this.style.visibility = 'hidden'; });
  }
  function updateValues(order) {
    var topT = order.length && dispObj[order[0]] ? dispObj[order[0]].t : 0;
    for (var i = 0; i < order.length; i++) {
      var id = order[i], it = dispObj[id];
      if (!it) continue;
      setBarVal(ovList.querySelector('.ed-fp-obj[data-obj="' + cssEsc(id) + '"]'), it.t, topT);
      if (expanded[id]) {
        var ths = threadsOf(id), tmax = ths.length ? ths[0].t : 0;
        for (var j = 0; j < ths.length && j < 8; j++) {
          setBarVal(ovList.querySelector('.ed-fp-thread[data-obj="' + cssEsc(id) + '"][data-hat="' + cssEsc(ths[j].hatId) + '"]'), ths[j].t, tmax);
        }
      }
    }
  }

  function updateOverlay() {
    if (!enabled || !running) { removeOverlay(); return; }
    ensureOverlay();

    var t = now();
    if (!orderedIds.length || (!hovering && !paused && t - lastOrderAt >= ORDER_MS)) { orderedIds = computeOrder(); lastOrderAt = t; }

    var total = 0, id;
    for (id in dispObj) { if (dispObj.hasOwnProperty(id)) total += dispObj[id].t; }
    if (ovMeta) ovMeta.textContent = paused
      ? '⏸ 일시정지 · 마지막 상태'
      : (fmt(total) + 'ms/프레임 · ' + (fps ? fps.toFixed(0) : '-') + 'fps');

    if (!orderedIds.length) {
      if (lastSig !== '__empty') { ovList.innerHTML = '<div style="padding:14px 6px;color:#9aa6c2;text-align:center;font-size:11px">측정 중…</div>'; lastSig = '__empty'; }
      return;
    }
    var sig = structureSig(orderedIds);
    if (sig !== lastSig) { rebuildRows(orderedIds); lastSig = sig; }
    updateValues(orderedIds);
  }

  /* ───────── 활성/비활성 ───────── */

  function setEnabled(next) {
    enabled = !!next;
    writeStoredEnabled(enabled);
    if (enabled) {
      installHooks();
      startLoop();
    } else {
      active = false; running = false; paused = false;
      stopLoop();
      resetData();
      removeOverlay();
      expanded = {};
    }
  }

  onMessage(function (msg) {
    if (msg.type !== 'SET_FRAME_PROFILER_ENABLED') return;
    var payload = msg.payload || {};
    setEnabled(!!payload.enabled);
    post('FRAME_PROFILER_RESULT', { success: true, enabled: enabled }, msg.requestId);
  });

  if (enabled) { installHooks(); startLoop(); }

  post('FRAME_PROFILER_READY', { enabled: enabled });
})();
