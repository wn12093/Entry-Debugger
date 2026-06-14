/**
 * picture-tools.js - Costume(picture) tab convenience tools.
 *
 * Multi-select pictures (click / Shift / Ctrl), drag a group to reorder or copy to
 * another object, right-click menu (copy / paste / duplicate / delete / export /
 * bulk rename), paste into empty list area, and hook the native "파일 올리기" box to
 * stage many images at once (10 per batch, GIF expanded to PNG frames). Optimized to
 * stay smooth with very large picture lists (incremental DOM reorder / bulk remove).
 *
 * Page-world module. Uses EntryDebuggerEntryAdapter / PatchRegistry / PageBridge.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_PICTURE_TOOLS_INJECTED__) return;
  window.__ENTRY_DEBUGGER_PICTURE_TOOLS_INJECTED__ = true;

  var CHANNEL = '__ENTRY_DEBUGGER__';
  var RETRY_INTERVAL = 300;
  var RETRY_TIMEOUT = 30000;
  var PATCH_ID = 'picture-tools';
  var BATCH = 10;
  var Bridge = window.EntryDebuggerPageBridge || null;
  var Adapter = window.EntryDebuggerEntryAdapter || null;
  var Patches = window.EntryDebuggerPatchRegistry || null;

  var enabled = false;
  var started = false; // listeners/patches installed once
  var retryTimer = null;
  var retryUntil = 0;

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function safeGetEntry() {
    if (Adapter && typeof Adapter.getEntry === 'function') return Adapter.getEntry();
    try { return window.Entry || null; } catch (e) { return null; }
  }

  function getPlayground() {
    if (Adapter && typeof Adapter.getPlayground === 'function') return Adapter.getPlayground();
    var entry = safeGetEntry();
    return entry && entry.playground ? entry.playground : null;
  }

  function getAllObjects() {
    var entry = safeGetEntry();
    if (entry && entry.container && typeof entry.container.getAllObjects === 'function') {
      try { return entry.container.getAllObjects() || []; } catch (e) {}
    }
    return [];
  }

  function getCurrentObject() {
    if (Adapter && typeof Adapter.getCurrentObject === 'function') {
      var obj = Adapter.getCurrentObject();
      if (obj) return obj;
    }
    var pg = getPlayground();
    if (pg && pg.object) return pg.object;
    var objects = getAllObjects();
    return objects[0] || null;
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

  function patchMethod(owner, methodName, patchId, createWrapper) {
    if (Patches && typeof Patches.patchMethod === 'function') {
      return Patches.patchMethod(owner, methodName, patchId, createWrapper);
    }
    if (!owner || typeof owner[methodName] !== 'function') return false;
    var mark = '__entryDebugger_' + patchId.replace(/[^a-z0-9]/gi, '_') + '_' + methodName;
    if (owner[mark]) return true;
    owner[methodName] = createWrapper(owner[methodName]);
    owner[mark] = true;
    return true;
  }

  /* ─────────────────────────────────────────────
     Data helpers
     ───────────────────────────────────────────── */

  function newId() {
    var entry = safeGetEntry();
    var hash = entry && entry.generateHash ? entry.generateHash() : Math.random().toString(36).slice(2);
    return hash.slice(0, 4);
  }

  // Clone only the data fields of a picture (rendered picture.view is circular).
  function clonePic(p, targetId) {
    var c = {
      id: newId(),
      fileurl: p.fileurl,
      thumbUrl: p.thumbUrl || p.fileurl,
      name: p.name,
      imageType: p.imageType,
      dimension: p.dimension ? { width: p.dimension.width, height: p.dimension.height } : { width: 100, height: 100 },
      objectId: targetId
    };
    if (p.filename) c.filename = p.filename;
    return c;
  }

  // Data-only picture fields (clipboard); id/objectId are assigned when pasted.
  function picData(p) {
    return {
      fileurl: p.fileurl,
      thumbUrl: p.thumbUrl || p.fileurl,
      name: p.name,
      imageType: p.imageType,
      dimension: p.dimension ? { width: p.dimension.width, height: p.dimension.height } : { width: 100, height: 100 },
      filename: p.filename,
      scale: (p.scale != null ? p.scale : 100)
    };
  }

  function visibleByText(text) {
    var i, el;
    var ab = document.querySelectorAll('a, button');
    for (i = 0; i < ab.length; i++) {
      el = ab[i];
      if (el.offsetParent !== null && el.textContent.trim() === text) return el;
    }
    var others = document.querySelectorAll('div, span, li');
    for (i = 0; i < others.length; i++) {
      el = others[i];
      if (el.offsetParent !== null && el.textContent.trim() === text) return el.closest('a, button') || el;
    }
    return null;
  }

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 10000;
    interval = interval || 120;
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function tick() {
        var v = fn();
        if (v) { resolve(v); return; }
        if (Date.now() - t0 >= timeout) { reject(new Error('시간 초과')); return; }
        setTimeout(tick, interval);
      })();
    });
  }

  /* ─────────────────────────────────────────────
     Native toast / confirm
     ───────────────────────────────────────────── */

  function nativeToast(title, msg, err) {
    var entry = safeGetEntry();
    try {
      var toast = entry && entry.toast;
      (err ? toast.alert : toast.success).call(toast, title, msg);
    } catch (e) {}
  }

  // Entry latest modal: Entry.modal.confirm(content, title) -> Promise<boolean>.
  function nativeConfirm(title, msg) {
    var entry = safeGetEntry();
    try {
      if (entry && entry.modal && entry.modal.confirm) return entry.modal.confirm(msg, title);
    } catch (e) {}
    return Promise.resolve(window.confirm(title + '\n\n' + msg));
  }

  // Progress indicator on top of the "모양 추가하기" dialog (native toast is hidden by it).
  var progEl = null;
  var progTimer = null;
  function prog(title, msg, err) {
    if (!progEl || !document.body.contains(progEl)) {
      progEl = document.createElement('div');
      progEl.id = 'ed-picture-tools-prog';
      progEl.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;' +
        'padding:10px 20px;border-radius:999px;font:bold 13px "Nanum Gothic","NanumGothic","Malgun Gothic",sans-serif;color:#fff;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.32);white-space:nowrap;pointer-events:none;transition:opacity .3s;';
      document.body.appendChild(progEl);
    }
    clearTimeout(progTimer);
    progEl.style.background = err ? '#e74c3c' : '#4f80ff';
    progEl.textContent = title ? (title + ' · ' + msg) : msg;
    progEl.style.opacity = '1';
  }
  function progEnd(keepMs) {
    clearTimeout(progTimer);
    progTimer = setTimeout(function () {
      if (!progEl) return;
      progEl.style.opacity = '0';
      setTimeout(function () { if (progEl) { progEl.remove(); progEl = null; } }, 320);
    }, keepMs || 2500);
  }

  /* ─────────────────────────────────────────────
     ZIP (STORE) builder - pure JS, no dependency.
     ───────────────────────────────────────────── */

  var crcTable = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function concatBytes(arrs) {
    var n = 0, i;
    for (i = 0; i < arrs.length; i++) n += arrs[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < arrs.length; i++) { out.set(arrs[i], o); o += arrs[i].length; }
    return out;
  }

  function zipStore(files) {
    var enc = new TextEncoder();
    var u16 = function (v) { return new Uint8Array([v & 0xFF, (v >> 8) & 0xFF]); };
    var u32 = function (v) { return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]); };
    var chunks = [], central = [], offset = 0, i;
    for (i = 0; i < files.length; i++) {
      var f = files[i];
      var nb = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      var lfh = concatBytes([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(nb.length), u16(0), nb]);
      chunks.push(lfh, f.data);
      central.push(concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nb]));
      offset += lfh.length + sz;
    }
    var cd = concatBytes(central);
    var eocd = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
    return concatBytes(chunks.concat([cd, eocd]));
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function safeName(s) {
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[\s.]+|\s+$/g, '').slice(0, 80) || 'image';
  }

  /* ─────────────────────────────────────────────
     GIF -> PNG frames (WebCodecs ImageDecoder)
     ───────────────────────────────────────────── */

  function gifToPngFrames(file, onProgress) {
    return (async function () {
      if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported('image/gif'))) {
        throw new Error('이 브라우저는 GIF 디코딩을 지원하지 않습니다(ImageDecoder 없음)');
      }
      var dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
      await dec.tracks.ready;
      var n = (dec.tracks.selectedTrack && dec.tracks.selectedTrack.frameCount) || 1;
      var base = file.name.replace(/\.gif$/i, '');
      var pad = String(n).length;
      var frames = [];
      for (var i = 0; i < n; i++) {
        var decoded = await dec.decode({ frameIndex: i });
        var image = decoded.image;
        var cv = document.createElement('canvas');
        cv.width = image.displayWidth; cv.height = image.displayHeight;
        cv.getContext('2d').drawImage(image, 0, 0);
        image.close();
        var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
        frames.push(new File([blob], base + '_' + String(i + 1).padStart(pad, '0') + '.png', { type: 'image/png' }));
        if (onProgress) onProgress(i + 1, n);
      }
      if (dec.close) dec.close();
      return frames;
    })();
  }

  function expandFiles(files) {
    return (async function () {
      var out = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (/\.gif$/i.test(f.name) || f.type === 'image/gif') {
          prog('GIF 분해 중', f.name);
          /* eslint-disable no-loop-func */
          var frames = await gifToPngFrames(f, (function (name) {
            return function (idx, nn) { prog('GIF 분해 중', name + ' (' + idx + '/' + nn + ' 프레임)'); };
          })(f.name));
          /* eslint-enable no-loop-func */
          out.push.apply(out, frames);
        } else {
          out.push(f);
        }
      }
      return out;
    })();
  }

  /* ─────────────────────────────────────────────
     Bulk staging (hook the native "파일 올리기" box)
     ───────────────────────────────────────────── */

  var fileInput = null;

  function stage(input, files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closeAlertIfAny() {
    return (async function () {
      var ok = visibleByText('확인');
      if (ok) { ok.click(); await sleep(150); }
    })();
  }

  var staging = false;
  var stageQueue = [];
  var stageTotal = 0; // running grand total (grows when more files are queued mid-staging)
  function stageFiles(files) {
    // Already staging: queue the new files instead of dropping them; the running loop
    // drains the queue when the current batch finishes (so re-uploading mid-upload works).
    // stageTotal also grows so the "현재/총량" progress stays accurate.
    if (staging) {
      stageQueue.push.apply(stageQueue, files);
      stageTotal += files.length;
      return Promise.resolve();
    }
    staging = true;
    stageTotal = files.length;
    return (async function () {
      try {
        var input = document.getElementById('inpt_file');
        if (!input) { prog('업로드', '"파일 올리기" 화면에서 다시 시도해 주세요.', true); progEnd(4000); return; }
        var staged = 0;
        var batch = files.slice();
        while (batch.length) {
          var chunks = [];
          for (var i = 0; i < batch.length; i += BATCH) chunks.push(batch.slice(i, i + BATCH));
          for (var c = 0; c < chunks.length; c++) {
            var chunk = chunks[c];
            stage(input, chunk); // re-set input.files -> Entry stages cumulatively
            staged += chunk.length;
            prog('이미지 추가 중', staged + '/' + stageTotal + '장 준비 중…');
            var lastName = chunk[chunk.length - 1].name;
            try { await waitFor((function (name) { return function () { return visibleByText(name); }; })(lastName), 3000); } catch (e) {}
            await closeAlertIfAny();
            await sleep(350);
          }
          // drain files queued (via stageFiles) while we were staging
          batch = stageQueue.length ? stageQueue.splice(0, stageQueue.length) : [];
        }
        prog('스테이징 완료', stageTotal + '장 준비됨 — "추가하기"를 누르면 적용돼요.');
        progEnd(5000);
      } catch (e) { prog('오류', e.message, true); progEnd(4000); }
      finally { staging = false; stageTotal = 0; }
    })();
  }

  function handlePickedFiles() {
    var raw = [].slice.call(fileInput.files);
    fileInput.value = '';
    if (!raw.length) return;
    (async function () {
      var files = raw;
      var hasGif = raw.some(function (f) { return /\.gif$/i.test(f.name) || f.type === 'image/gif'; });
      if (hasGif) {
        try { files = await expandFiles(raw); }
        catch (e) { prog('GIF 분해 오류', e.message, true); progEnd(4000); return; }
      }
      if (files.length) await stageFiles(files);
    })();
  }

  // Native "파일 올리기": tab click switches the view; only the upload box (.file_add_box)
  // click opens our picker. Only intercept trusted clicks (programmatic clicks pass through).
  function onFileBtnClick(e) {
    if (!enabled) return;
    if (!e.isTrusted) return;
    var box = e.target.closest && e.target.closest('[class*="file_add_box"]');
    if (!box) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (fileInput) fileInput.click();
  }

  /* ─────────────────────────────────────────────
     Multi-select + drag + context menu
     ───────────────────────────────────────────── */

  var ROW = 'li.entryPlaygroundPictureElement';
  var selSet = {};            // selected picture id -> true
  var anchorIdx = null;       // Shift range anchor
  var lastObjId = null;       // object switch detection
  var pictureClipboard = [];  // internal clipboard (data only, survives object switch)
  var mo = null;
  var scheduled = false;
  var dragging = false;

  function selHas(id) { return Object.prototype.hasOwnProperty.call(selSet, id); }
  function selSize() { return Object.keys(selSet).length; }
  function selClear() { selSet = {}; }
  function selAdd(id) { selSet[id] = true; }
  function selDelete(id) { delete selSet[id]; }
  function selFromIds(ids) { selSet = {}; ids.forEach(function (id) { selSet[id] = true; }); }

  function allRows() { return [].slice.call(document.querySelectorAll(ROW)); }

  function curObj() { return getCurrentObject(); }

  function picksFromSelection(o) {
    return o.pictures.filter(function (p) { return selHas(p.id); });
  }

  // Keep scroll position across a list re-render (injectPicture resets it to top).
  function getScroller() {
    var el = document.querySelector(ROW);
    el = el && el.parentElement;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 2) {
        var oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function keepScroll(fn) {
    var before = getScroller();
    var top = before ? before.scrollTop : 0;
    fn();
    var restore = function () { var sc = getScroller(); if (sc) sc.scrollTop = top; };
    restore();
    requestAnimationFrame(restore);
  }

  // The custom scrollbar is pointer-events:none (decoration); a click on it leaks to the
  // row behind and is mistaken for a drag. Right-edge mousedown -> proportional scroll.
  function inScrollbarZone(clientX) {
    var sc = getScroller();
    if (!sc) return false;
    var outer = sc.closest('.rcs-outer-container') || sc;
    return clientX >= outer.getBoundingClientRect().right - 18;
  }

  function startScrollbarDrag(downEv) {
    var sc = getScroller();
    if (!sc) return;
    var startY = downEv.clientY, startTop = sc.scrollTop;
    var ratio = sc.clientHeight > 0 ? sc.scrollHeight / sc.clientHeight : 1;
    var mv = function (ev) { sc.scrollTop = startTop + (ev.clientY - startY) * ratio; };
    var up = function () {
      document.removeEventListener('mousemove', mv, true);
      document.removeEventListener('mouseup', up, true);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', mv, true);
    document.addEventListener('mouseup', up, true);
    document.body.style.userSelect = 'none';
  }

  function ensureStyle() {
    if (document.getElementById('ed-picture-tools-style')) return;
    var st = document.createElement('style');
    st.id = 'ed-picture-tools-style';
    st.textContent =
      '.ed-pt-sel{outline:2.5px solid #4f80ff !important;outline-offset:-3px;background:rgba(79,128,255,.10) !important;}' +
      '.ed-pt-objdrop{outline:3px solid #19c37d !important;outline-offset:-2px;background:rgba(25,195,125,.12) !important;border-radius:5px;}';
    document.head.appendChild(st);
  }

  function applyHighlight() {
    var o = curObj();
    // Reset selection when the object changes (the first run keeps it: lastObjId === null).
    if (o) {
      if (lastObjId !== null && o.id !== lastObjId) { selClear(); anchorIdx = null; }
      lastObjId = o.id;
    }
    if (selSize() === 0 && !document.querySelector('.ed-pt-sel')) return;
    if (mo) mo.disconnect();
    var rows = allRows();
    for (var i = 0; i < rows.length; i++) {
      var p = o && o.pictures[i];
      if (p && selHas(p.id)) rows[i].classList.add('ed-pt-sel');
      else rows[i].classList.remove('ed-pt-sel');
    }
    if (mo) mo.observe(document.body, { childList: true, subtree: true });
  }

  function schedule() {
    if (dragging || scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; applyHighlight(); });
  }

  function clearSelAndHighlight() { selClear(); anchorIdx = null; applyHighlight(); }

  function onDown(e) {
    if (!enabled) return;
    if (e.button === 2) { recordCtx(e); return; }   // right click: record target only
    if (e.button !== 0) return;
    var row = e.target.closest && e.target.closest(ROW);
    if (!row) return;
    if (e.target.closest('.entryPlayground_del')) return; // delete handled on click
    if (e.target.closest('input') && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
      // 모양 이름 입력 필드를 클릭하면 기존 다중 선택을 모두 해제하고 Entry 기본 이름편집으로 넘긴다.
      if (selSize() > 0) clearSelAndHighlight();
      return;
    }
    if (inScrollbarZone(e.clientX)) { e.preventDefault(); e.stopPropagation(); startScrollbarDrag(e); return; }
    var o = curObj();
    if (!o) return;
    var idx = allRows().indexOf(row);
    var pic = o.pictures[idx];
    if (!pic) return;
    // 이름 편집 중 다른 모양을 선택하면 편집 중이던 입력을 확정(blur)해 입력을 끝낸다.
    var activeInput = document.activeElement;
    if (activeInput && activeInput !== e.target &&
        activeInput.tagName === 'INPUT' && activeInput.closest && activeInput.closest(ROW)) {
      activeInput.blur();
    }
    if (e.shiftKey && anchorIdx != null && anchorIdx < o.pictures.length) {
      e.preventDefault(); e.stopPropagation();
      var a = Math.min(anchorIdx, idx), b = Math.max(anchorIdx, idx);
      selFromIds(o.pictures.slice(a, b + 1).map(function (p) { return p.id; }));
      applyHighlight();
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (selHas(pic.id)) selDelete(pic.id); else selAdd(pic.id);
      anchorIdx = idx; applyHighlight();
    } else {
      // Plain click/drag (single or group): always bypass native sort (heavy with many
      // pictures) and use the cached/throttled custom drag. Click without drag collapses
      // to a single selection in onUp.
      e.preventDefault(); e.stopPropagation();
      if (!(selHas(pic.id) && selSize() >= 2)) { selFromIds([pic.id]); anchorIdx = idx; applyHighlight(); }
      armGroupDrag(e, idx, pic);
    }
  }

  function onClick(e) {
    if (!enabled) return;
    var del = e.target.closest && e.target.closest('.entryPlayground_del');
    if (del) {
      var row = del.closest(ROW);
      if (!row) return;
      var o = curObj();
      if (!o) return;
      var pic = o.pictures[allRows().indexOf(row)];
      if (!pic) return;
      if (selSize() >= 2 && selHas(pic.id)) {
        e.preventDefault(); e.stopPropagation();
        deleteSelected(picksFromSelection(o));
      } else if (o.pictures.length > 1) {
        // Single delete: route through the fast path too. Entry's native removePicture
        // re-renders the whole list (scroll jumps to top + slow on large lists).
        e.preventDefault(); e.stopPropagation();
        fastBulkRemove(o, [pic.id]);
        selDelete(pic.id);
        applyHighlight();
      }
      return; // last remaining picture: leave to Entry's default behavior
    }
    var row2 = e.target.closest && e.target.closest(ROW);
    if (row2 && (e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); }
  }

  /* Custom group drag (ghost + reorder / copy to object). Cached + rAF throttled. */
  function armGroupDrag(downEv, idx, pic) {
    var startX = downEv.clientX, startY = downEv.clientY;
    var dragStarted = false, ghost = null, dropMode = null, dropObj = null, dropIdx = null, hidden = [];
    var rowCache = null, objCache = null, line = null, hiObj = null, raf = 0, lastEv = null;
    var scrollerEl = null, scrollerTop = 0, autoRAF = 0, autoDir = 0;
    var pg = getPlayground();

    function visRows() { return allRows().filter(function (r) { return r.style.display !== 'none'; }); }

    function hideSel() {
      var o = curObj();
      hidden = allRows().filter(function (row, i) { var p = o.pictures[i]; return p && selHas(p.id); });
      hidden.forEach(function (row) { row.style.display = 'none'; });
    }
    function restoreSel() { hidden.forEach(function (row) { row.style.display = ''; }); hidden = []; }

    function curScrollTop() { return scrollerEl ? scrollerEl.scrollTop : 0; }

    function buildCaches() {
      var o = curObj();
      scrollerEl = getScroller();
      scrollerTop = scrollerEl ? scrollerEl.getBoundingClientRect().top : 0;
      var st = curScrollTop();
      rowCache = visRows().map(function (r) {
        var b = r.getBoundingClientRect();
        var cTop = b.top - scrollerTop + st;
        return { cTop: cTop, cMid: cTop + b.height / 2, cBottom: cTop + b.height, left: b.left, right: b.right, width: b.width };
      });
      objCache = [];
      var objects = getAllObjects();
      for (var i = 0; i < objects.length; i++) {
        var ob = objects[i];
        if (ob.id === o.id) continue;
        var v = ob.view_;
        if (!v) continue;
        var rb = v.getBoundingClientRect();
        if (rb.width) objCache.push({ o: ob, l: rb.left, r: rb.right, t: rb.top, bo: rb.bottom });
      }
    }

    function restIdx(x, y) {
      if (!rowCache || !rowCache.length) return null;
      var st = curScrollTop();
      var f = rowCache[0], l = rowCache[rowCache.length - 1];
      var fTop = f.cTop - st + scrollerTop, lBottom = l.cBottom - st + scrollerTop;
      var left = Math.min(f.left, l.left), right = Math.max(f.right, l.right);
      if (x < left - 24 || x > right + 24 || y < fTop - 24 || y > lBottom + 24) return null;
      for (var i = 0; i < rowCache.length; i++) { if (y < rowCache[i].cMid - st + scrollerTop) return i; }
      return rowCache.length;
    }

    function ensureLine() {
      if (!line) {
        line = document.createElement('div');
        line.id = 'ed-picture-tools-insline';
        line.style.cssText = 'position:fixed;height:3px;background:#4f80ff;border-radius:2px;z-index:2147483500;pointer-events:none;box-shadow:0 0 4px #4f80ff;display:none;';
        document.body.appendChild(line);
      }
      return line;
    }
    function positionLine(ci) {
      var ln = ensureLine();
      var ref = rowCache[Math.min(ci, rowCache.length - 1)];
      var st = curScrollTop();
      var cY = ci >= rowCache.length ? ref.cBottom : ref.cTop;
      var y = cY - st + scrollerTop;
      ln.style.left = ref.left + 'px'; ln.style.width = ref.width + 'px'; ln.style.top = (y - 1) + 'px'; ln.style.display = 'block';
    }
    function hideLine() { if (line) line.style.display = 'none'; }
    function setObjHi(o) { if (hiObj === o) return; clearObjHi(); if (o && o.view_) { o.view_.classList.add('ed-pt-objdrop'); hiObj = o; } }
    function clearObjHi() { if (hiObj && hiObj.view_) hiObj.view_.classList.remove('ed-pt-objdrop'); hiObj = null; }

    function buildGhost() {
      var g = document.createElement('div');
      g.id = 'ed-picture-tools-ghost';
      g.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483600;pointer-events:none;transform:translate(-9999px,-9999px);';
      var o = curObj();
      var picks = picksFromSelection(o);
      picks.slice(0, 4).forEach(function (p, i) {
        var im = document.createElement('div');
        var url = p.thumbUrl || p.fileurl;
        im.style.cssText = 'position:absolute;width:46px;height:46px;border-radius:5px;border:2px solid #4f80ff;' +
          'background:#fff center/cover no-repeat;box-shadow:0 2px 8px rgba(0,0,0,.35);left:' + (i * 11) + 'px;top:' + (i * 11) + 'px;';
        if (url) im.style.backgroundImage = 'url("' + url + '")';
        g.appendChild(im);
      });
      if (picks.length > 1) {
        var badge = document.createElement('div');
        badge.textContent = picks.length;
        badge.style.cssText = 'position:absolute;left:' + (Math.min(picks.length, 4) * 11 + 30) + 'px;top:-6px;min-width:20px;height:20px;' +
          'padding:0 5px;border-radius:11px;background:#4f80ff;color:#fff;font:bold 12px "Nanum Gothic","NanumGothic","Malgun Gothic",sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);';
        g.appendChild(badge);
      }
      return g;
    }

    function autoTick() { // edge auto-scroll loop (keeps scrolling even when cursor is still)
      autoRAF = 0;
      if (!autoDir || !scrollerEl) return;
      scrollerEl.scrollTop += autoDir * 14; // scroll event -> onScroll -> processMove updates line
      autoRAF = requestAnimationFrame(autoTick);
    }

    function processMove() {
      raf = 0;
      var ev = lastEv;
      if (!ev || !ghost) return;
      ghost.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 12) + 'px)';
      if (scrollerEl) {
        var r = scrollerEl.getBoundingClientRect(), EDGE = 38;
        var overList = ev.clientX >= r.left && ev.clientX <= r.right;
        autoDir = overList ? (ev.clientY < r.top + EDGE ? -1 : ev.clientY > r.bottom - EDGE ? 1 : 0) : 0;
        if (autoDir && !autoRAF) autoRAF = requestAnimationFrame(autoTick);
      }
      var tObj = null;
      for (var i = 0; i < objCache.length; i++) {
        var c = objCache[i];
        if (ev.clientX >= c.l && ev.clientX <= c.r && ev.clientY >= c.t && ev.clientY <= c.bo) { tObj = c.o; break; }
      }
      if (tObj) { dropMode = 'object'; dropObj = tObj; dropIdx = null; setObjHi(tObj); hideLine(); return; }
      clearObjHi();
      var ci = restIdx(ev.clientX, ev.clientY);
      if (ci != null) { dropMode = 'reorder'; dropIdx = ci; dropObj = null; positionLine(ci); }
      else { dropMode = null; dropObj = null; dropIdx = null; hideLine(); }
    }

    function onScroll() { if (!raf) raf = requestAnimationFrame(processMove); }

    function onMove(ev) {
      lastEv = ev;
      if (!dragStarted) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        dragStarted = true; dragging = true;
        hideSel();
        buildCaches();
        if (scrollerEl) scrollerEl.addEventListener('scroll', onScroll, true);
        ghost = buildGhost(); document.body.appendChild(ghost);
        document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing';
      }
      if (!raf) raf = requestAnimationFrame(processMove);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (scrollerEl) scrollerEl.removeEventListener('scroll', onScroll, true);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (autoRAF) { cancelAnimationFrame(autoRAF); autoRAF = 0; }
      autoDir = 0;
      document.body.style.userSelect = ''; document.body.style.cursor = '';
      if (ghost) ghost.remove();
      clearObjHi();
      if (line) { line.remove(); line = null; }
      restoreSel();
      dragging = false;
      if (!dragStarted) { // not a drag -> collapse to single
        var o = curObj(), p = o && o.pictures[idx];
        if (p) { selFromIds([p.id]); anchorIdx = idx; applyHighlight(); try { if (pg) pg.selectPicture(p); } catch (err) {} }
        return;
      }
      if (dropMode === 'object' && dropObj) copyPicturesTo(dropObj);
      else if (dropMode === 'reorder' && dropIdx != null) moveGroupToRest(dropIdx);
      else applyHighlight();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  // Move the group as a block into rest[insertAt] (relative order kept).
  function moveGroupToRest(insertAt) {
    var pg = getPlayground();
    var o = curObj();
    var pics = o.pictures;
    var rest = pics.filter(function (p) { return !selHas(p.id); });
    var block = pics.filter(function (p) { return selHas(p.id); });
    var result = rest.slice(0, insertAt).concat(block, rest.slice(insertAt));
    o.pictures.length = 0;
    result.forEach(function (p) { o.pictures.push(p); });
    if (!reorderDomFast(o)) keepScroll(function () { try { if (pg) pg.injectPicture(); } catch (err) {} });
    applyHighlight();
  }

  // Fast reorder: move rendered row DOM into the new order and sync the widget model,
  // instead of a full injectPicture re-render (slow with 1000+ pictures). Falls back if
  // any precondition (rendered view / widget / mapping) is missing.
  function reorderDomFast(o) {
    var pg = getPlayground();
    try {
      var w = pg && pg.pictureSortableListWidget;
      if (!w || !w._data || !Array.isArray(w._data.items)) return false;
      var el = function (v) { return v ? (v.nodeType ? v : v[0] || null) : null; };
      var wraps = [];
      var i;
      for (i = 0; i < o.pictures.length; i++) {
        var li = el(o.pictures[i].view);
        if (!li) return false;
        var wrap = li.closest('.sortableItem') || li.parentElement;
        if (!wrap) return false;
        wraps.push(wrap);
      }
      var container = wraps[0] && wraps[0].parentElement;
      if (!container) return false;
      var byView = {};
      w._data.items.forEach(function (it, k) { var key = el(it.item); if (key) { key.__edPtIdx = k; } });
      var items = [];
      for (i = 0; i < o.pictures.length; i++) {
        var key2 = el(o.pictures[i].view);
        var k2 = key2 ? key2.__edPtIdx : undefined;
        if (k2 == null) return false;
        items.push(w._data.items[k2]);
      }
      w._data.items.forEach(function (it) { var key = el(it.item); if (key) { delete key.__edPtIdx; } });
      var sc = getScroller();
      var top = sc ? sc.scrollTop : 0;
      var frag = document.createDocumentFragment();
      wraps.forEach(function (wp) { frag.appendChild(wp); });
      container.appendChild(frag);
      w._data.items = items;
      if (sc) sc.scrollTop = top;
      return true;
    } catch (e) { return false; }
  }

  // Fast bulk remove: suppress injectPicture during removePicture (it re-renders per call),
  // then drop only the deleted rows via widget.setData. Falls back to one injectPicture.
  function fastBulkRemove(o, ids) {
    var pg = getPlayground();
    var w = pg && pg.pictureSortableListWidget;
    var el = function (v) { return v ? (v.nodeType ? v : v[0] || null) : null; };
    var canFast = !!(w && w._data && Array.isArray(w._data.items));
    var delSet = {}, delLis = [];
    ids.forEach(function (id) { delSet[id] = true; });
    if (canFast) {
      o.pictures.forEach(function (p) {
        if (delSet[p.id]) { var li = el(p.view); if (li) delLis.push(li); }
      });
    }
    var realInject = pg.injectPicture;
    try {
      pg.injectPicture = function () {};
      ids.forEach(function (id) { try { o.removePicture(id); } catch (e) {} });
    } finally { pg.injectPicture = realInject; }
    if (canFast) {
      try {
        var items = w._data.items.filter(function (it) { return delLis.indexOf(el(it.item)) === -1; });
        var sc = getScroller();
        var top = sc ? sc.scrollTop : 0;
        w.setData(Object.assign({}, w._data, { items: items }));
        if (sc) sc.scrollTop = top;
        return;
      } catch (e) {}
    }
    keepScroll(function () { try { pg.injectPicture(); } catch (e) {} });
  }

  // Copy the group to another object (originals kept). Target is offscreen and the current
  // object's pictures are unchanged, so suppress injectPicture entirely (data only).
  function copyPicturesTo(targetObj) {
    var pg = getPlayground();
    var o = curObj();
    if (!o || !targetObj || targetObj.id === o.id) return;
    var picks = picksFromSelection(o);
    var n = 0;
    var realInject = pg.injectPicture;
    try {
      pg.injectPicture = function () {};
      picks.forEach(function (p) { try { targetObj.addPicture(clonePic(p, targetObj.id)); n++; } catch (err) {} });
    } finally { pg.injectPicture = realInject; }
    nativeToast('복사 완료', n + '개 모양을 "' + targetObj.name + '"(으)로 복사했어요.');
  }

  /* ─── Right-click context menu: replace Entry native menu items with ours ─── */
  // Wrap Entry.ContextMenu.show; for a picture-row right click, replace items with ours.
  // The target row is recorded on right mousedown (before contextmenu/show).
  var ctxPicks = null, ctxTime = 0, ctxEl = null, menuStyle = null;

  function recordCtx(e) {
    ctxPicks = null;
    var row = e.target.closest && e.target.closest(ROW);
    if (!row) return;
    var o = curObj();
    if (!o) return;
    var idx = allRows().indexOf(row);
    var pic = o.pictures[idx];
    if (!pic) return;
    if (!selHas(pic.id)) { selFromIds([pic.id]); anchorIdx = idx; applyHighlight(); }
    ctxPicks = picksFromSelection(o);
    ctxTime = Date.now();
  }

  function buildMenuItems(picks) {
    var cnt = picks.length, clip = pictureClipboard.length;
    return [
      { text: '복사하기 (' + cnt + '개)', callback: function () { copyToClipboard(picks); } },
      { text: clip ? '붙여넣기 (' + clip + '개)' : '붙여넣기', enable: clip > 0, callback: function () { pasteFromClipboard(); } },
      { text: '복제하기 (' + cnt + '개)', callback: function () { duplicatePictures(picks); } },
      { text: '삭제하기 (' + cnt + '개)', callback: function () { deleteSelected(picks); } },
      { text: cnt > 1 ? '이미지 파일 ZIP으로 내보내기 (' + cnt + '개)' : '이미지 파일로 내보내기', callback: function () { exportPictures(picks); } },
      { text: '일괄 이름변경하기 (' + cnt + '개)', callback: function () { bulkRename(picks); } }
    ];
  }

  function patchContextMenu() {
    var entry = safeGetEntry();
    var CM = entry && entry.ContextMenu;
    if (!CM || typeof CM.show !== 'function') return false;
    return patchMethod(CM, 'show', PATCH_ID, function (originalShow) {
      return function (items, className, coords) {
        try {
          if (enabled && ctxPicks && ctxPicks.length && Date.now() - ctxTime < 1500) {
            items = buildMenuItems(ctxPicks);
            ctxPicks = null;
          }
        } catch (e) {}
        var ret = originalShow.call(this, items, className, coords);
        if (!menuStyle && items && items.length) {
          var t = null;
          for (var i = 0; i < items.length; i++) { if (items[i] && items[i].text) { t = items[i].text; break; } }
          if (t) setTimeout(function () {
            try {
              if (menuStyle) return;
              var nodes = document.querySelectorAll('div,li,a,span');
              for (var j = 0; j < nodes.length; j++) {
                var x = nodes[j];
                if (x.offsetParent && x.children.length === 0 && x.textContent.trim() === t) {
                  var cs = getComputedStyle(x);
                  menuStyle = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
                  break;
                }
              }
            } catch (e) {}
          }, 0);
        }
        return ret;
      };
    });
  }

  // Empty list area right-click -> paste menu. Calling E.ContextMenu directly here gets
  // hidden by Entry's own handler, so use a small self-managed DOM menu instead.
  function closeCtx() {
    if (ctxEl) { ctxEl.remove(); ctxEl = null; }
    document.removeEventListener('mousedown', ctxOutside, true);
    document.removeEventListener('scroll', closeCtx, true);
    window.removeEventListener('blur', closeCtx);
  }
  function ctxOutside(ev) { if (ctxEl && !ctxEl.contains(ev.target)) closeCtx(); }
  function showPasteMenu(x, y) {
    closeCtx();
    var clip = pictureClipboard.length;
    var ms = menuStyle || {};
    var m = document.createElement('div');
    ctxEl = m;
    m.style.cssText = 'position:fixed;z-index:2147483600;min-width:150px;background:#fff;border:1px solid #d7dce2;' +
      'border-radius:5px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:5px 0;' +
      'font-family:' + (ms.fontFamily || '"Nanum Gothic","NanumGothic","Malgun Gothic",sans-serif') + ';font-size:' + (ms.fontSize || '14px') + ';font-weight:' + (ms.fontWeight || 'normal') + ';';
    var it = document.createElement('div');
    it.textContent = clip ? '붙여넣기 (' + clip + '개)' : '붙여넣기';
    it.style.cssText = 'padding:9px 18px;cursor:' + (clip ? 'pointer' : 'default') + ';color:' + (clip ? (ms.color || '#222') : '#b3b3b3') + ';';
    if (clip) {
      it.addEventListener('mouseenter', function () { it.style.background = '#eef3ff'; });
      it.addEventListener('mouseleave', function () { it.style.background = ''; });
      it.addEventListener('click', function () { closeCtx(); pasteFromClipboard(); });
    }
    m.appendChild(it);
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
    setTimeout(function () {
      document.addEventListener('mousedown', ctxOutside, true);
      document.addEventListener('scroll', closeCtx, true);
      window.addEventListener('blur', closeCtx);
    }, 0);
  }

  // Empty area = inside the list panel and below the last row (coordinate based, robust to
  // wrapper/margin targets). Rows (and gaps between them) are left to Entry's native menu.
  function onCtxMenu(e) {
    if (!enabled) return;
    var rows = allRows();
    if (!rows.length) return;
    var panel = rows[0].closest('.rcs-custom-scroll') || rows[0].closest('.rcs-inner-container');
    if (!panel) return;
    var pr = panel.getBoundingClientRect();
    if (e.clientX < pr.left || e.clientX > pr.right || e.clientY < pr.top || e.clientY > pr.bottom) return;
    var lastBottom = rows[rows.length - 1].getBoundingClientRect().bottom;
    if (e.clientY <= lastBottom + 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ctxPicks = null;
    showPasteMenu(e.clientX, e.clientY);
  }

  /* ─── Context menu actions ─── */

  function copyToClipboard(picks) {
    pictureClipboard = picks.map(function (p) { return picData(p); });
    nativeToast('복사됨', picks.length + '개 모양 복사 — 다른 오브젝트에서 붙여넣기 하세요.');
  }

  function pasteFromClipboard() {
    var pg = getPlayground();
    var o = curObj();
    if (!o || !pictureClipboard.length) return;
    var n = 0;
    var realInject = pg.injectPicture;
    try {
      pg.injectPicture = function () {};
      pictureClipboard.forEach(function (d) { try { o.addPicture(clonePic(d, o.id)); n++; } catch (err) {} });
    } finally { pg.injectPicture = realInject; }
    keepScroll(function () { try { pg.injectPicture(); } catch (err) {} });
    applyHighlight();
    nativeToast('붙여넣기 완료', n + '개 모양을 추가했어요.');
  }

  // Duplicate selected pictures right after the group (originals kept). New pictures have
  // no rendered view yet, so a single injectPicture is used (reorderDomFast cannot apply).
  function duplicatePictures(picks) {
    var pg = getPlayground();
    var o = curObj();
    if (!o || !picks.length) return;
    var indices = picks.map(function (p) { return o.pictures.indexOf(p); });
    var anchor = o.pictures[Math.max.apply(null, indices)];
    var before = o.pictures.length;
    var realInject = pg.injectPicture;
    try {
      pg.injectPicture = function () {};
      picks.forEach(function (p) { try { o.addPicture(clonePic(p, o.id)); } catch (e) {} });
    } finally { pg.injectPicture = realInject; }
    var added = o.pictures.slice(before);
    if (added.length) {
      var rest = o.pictures.filter(function (p) { return added.indexOf(p) === -1; });
      var at = rest.indexOf(anchor) + 1;
      var result = rest.slice(0, at).concat(added, rest.slice(at));
      o.pictures.length = 0;
      result.forEach(function (p) { o.pictures.push(p); });
    }
    keepScroll(function () { try { pg.injectPicture(); } catch (e) {} });
    selFromIds(added.map(function (p) { return p.id; }));
    anchorIdx = null;
    applyHighlight();
    nativeToast('복제 완료', added.length + '개 복제됨.');
  }

  function deleteSelected(picks) {
    var o = curObj();
    if (!o || !picks.length) return;
    var ids = picks.map(function (p) { return p.id; });
    var cnt = ids.length;
    if (o.pictures.length - cnt < 1) { nativeToast('삭제 불가', '모든 모양은 삭제할 수 없어요. 최소 1개는 남겨주세요.', true); return; }
    (async function () {
      var ok = await nativeConfirm('모양 삭제', '선택한 모양 ' + cnt + '개를 한꺼번에 삭제할까요?\n되돌릴 수 없습니다.');
      if (!ok) return;
      fastBulkRemove(o, ids);
      clearSelAndHighlight();
      nativeToast('삭제 완료', cnt + '개 삭제 (남은 ' + o.pictures.length + '개).');
    })();
  }

  function bulkRename(picks) {
    if (!picks.length) return;
    var o = curObj();
    var dflt = (picks[0].name || '').replace(/_\d+$/, '');
    var base = window.prompt('선택한 ' + picks.length + '개 모양의 새 이름 (뒤에 _번호 자동):', dflt);
    if (base == null) return;
    var width = Math.max(2, String(picks.length).length);
    var rows = allRows();
    picks.forEach(function (p, i) {
      var name = base + '_' + String(i + 1).padStart(width, '0');
      p.name = name;
      var row = rows[o.pictures.indexOf(p)];
      var inp = row && row.querySelector('input.entryPlaygroundPictureName');
      if (inp) inp.value = name;
    });
    nativeToast('이름변경 완료', picks.length + '개 → "' + base + '_' + '1'.padStart(width, '0') + '…"');
  }

  // Export: many -> fetch each and pack into a ZIP; single -> Entry native downloadPicture.
  function exportPictures(picks) {
    if (!picks.length) return;
    var pg = getPlayground();
    if (picks.length === 1) {
      try { pg.downloadPicture(picks[0].id); } catch (e) { nativeToast('오류', '내보내기 실패: ' + e.message, true); }
      return;
    }
    (async function () {
      prog('내보내기', '0/' + picks.length + ' 받는 중…');
      try {
        var files = [], used = Object.create(null);
        for (var i = 0; i < picks.length; i++) {
          var p = picks[i];
          var url = new URL(p.fileurl, location.href).href;
          var res = await fetch(url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var data = new Uint8Array(await res.arrayBuffer());
          var ext = String(p.imageType || (url.split('?')[0].split('.').pop()) || 'png').toLowerCase();
          if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = 'png';
          var bn = safeName(p.name), key = bn + '.' + ext, k = used[key] || 0;
          used[key] = k + 1;
          files.push({ name: k ? (bn + '_' + (k + 1) + '.' + ext) : key, data: data });
          prog('내보내기', (i + 1) + '/' + picks.length + ' 받는 중…');
        }
        var blob = new Blob([zipStore(files)], { type: 'application/zip' });
        triggerDownload(blob, safeName((curObj().name) || '모양') + '_' + picks.length + '장.zip');
        prog('내보내기 완료', picks.length + '개 ZIP 저장');
        progEnd(3000);
      } catch (e) { prog('내보내기 오류', e.message, true); progEnd(4000); }
    })();
  }

  /* ─────────────────────────────────────────────
     Install (once) + enable/disable + retry
     ───────────────────────────────────────────── */

  function installOnce() {
    if (started) return;
    started = true;
    ensureStyle();
    // Hidden multi-file input used when the native "파일 올리기" box is hooked.
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,.gif';
    fileInput.style.display = 'none';
    fileInput.onchange = handlePickedFiles;
    document.body.appendChild(fileInput);

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('click', onFileBtnClick, true);
    document.addEventListener('contextmenu', onCtxMenu, true);

    mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function applyEntry() {
    var entry = safeGetEntry();
    if (!entry || !entry.playground || !document.body) return false;
    installOnce();
    // ContextMenu.show is patched once and stays; the wrapper checks enabled itself.
    patchContextMenu();
    return true;
  }

  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  function scheduleRetry() {
    clearRetry();
    retryUntil = Date.now() + RETRY_TIMEOUT;
    (function tick() {
      retryTimer = null;
      var ready = applyEntry();
      if (!ready && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    })();
  }

  onMessage(function (msg) {
    if (!msg || msg.type !== 'SET_PICTURE_TOOLS_ENABLED') return;
    enabled = !!(msg.payload && msg.payload.enabled);
    if (enabled) {
      applyEntry();
      scheduleRetry();
    } else {
      if (ctxEl) closeCtx();
      clearSelAndHighlight();
    }
    post('PICTURE_TOOLS_RESULT', { success: true, enabled: enabled }, msg.requestId);
  });

  post('PICTURE_TOOLS_READY', { enabled: enabled });
})();
