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
  var REORDER_CMD = 100000; // custom stateManager message for our undoable picture reorder
  var MAX_GIF_FRAMES = 2000;
  var MAX_GIF_FRAME_PIXELS = 16777216;
  var MAX_EXPORT_BYTES = 512 * 1024 * 1024;
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

  function getStateManager() {
    var entry = safeGetEntry();
    return entry && entry.stateManager ? entry.stateManager : null;
  }

  function getAllObjects() {
    if (Adapter && typeof Adapter.getAllObjects === 'function') {
      return Adapter.getAllObjects();
    }
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
      scale: (p.scale != null ? p.scale : 100),
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

  var renderSuppression = null;

  function getPictureListWidget() {
    if (Adapter && typeof Adapter.getPictureListWidget === 'function') {
      return Adapter.getPictureListWidget();
    }
    var pg = getPlayground();
    return pg && pg.pictureSortableListWidget ? pg.pictureSortableListWidget : null;
  }

  function getPictureListItems(widget) {
    if (Adapter && typeof Adapter.getPictureListItems === 'function') {
      return Adapter.getPictureListItems(widget);
    }
    return widget && widget._data && Array.isArray(widget._data.items)
      ? widget._data.items
      : null;
  }

  function setPictureListItems(widget, items, render) {
    if (Adapter && typeof Adapter.setPictureListItems === 'function') {
      return Adapter.setPictureListItems(widget, items, render);
    }
    if (!widget || !widget._data || !Array.isArray(items)) return false;
    if (render !== false && typeof widget.setData === 'function') {
      widget.setData(Object.assign({}, widget._data, { items: items }));
    } else {
      widget._data.items = items;
    }
    return true;
  }

  function withSuppressedPictureRender(pg, suppressReload, callback) {
    if (!pg) return callback();
    if (renderSuppression && renderSuppression.pg !== pg) {
      throw new Error('다른 작업공간의 모양 렌더링이 이미 처리 중입니다.');
    }
    if (!renderSuppression) {
      renderSuppression = {
        pg: pg,
        depth: 0,
        injectPicture: pg.injectPicture,
        reloadPlayground: pg.reloadPlayground,
        reloadSuppressed: false
      };
      pg.injectPicture = function () {};
    }
    renderSuppression.depth++;
    if (suppressReload && !renderSuppression.reloadSuppressed) {
      pg.reloadPlayground = function () {};
      renderSuppression.reloadSuppressed = true;
    }
    try {
      return callback();
    } finally {
      renderSuppression.depth--;
      if (renderSuppression.depth === 0) {
        pg.injectPicture = renderSuppression.injectPicture;
        pg.reloadPlayground = renderSuppression.reloadPlayground;
        renderSuppression = null;
      }
    }
  }

  function doEntryCommand() {
    if (Adapter && typeof Adapter.doCommand === 'function') {
      return Adapter.doCommand.apply(Adapter, arguments);
    }
    var entry = safeGetEntry();
    if (!entry || typeof entry.do !== 'function') {
      throw new Error('Entry 명령 API를 사용할 수 없습니다.');
    }
    return entry.do.apply(entry, arguments);
  }

  // Merge several Entry.do command results into ONE undo/redo step. Entry's undo/redo keeps
  // processing while the popped command's isPass === true, so mark every result but the first.
  function groupUndoCommands(results) {
    for (var i = 1; i < results.length; i++) {
      var r = results[i];
      try { if (r && typeof r.isPass === 'function') r.isPass(true); } catch (e) {}
    }
  }

  function getOrderedPictureName(name, pictures) {
    if (Adapter && typeof Adapter.getOrderedName === 'function') {
      return Adapter.getOrderedName(name, pictures);
    }
    var entry = safeGetEntry();
    return entry && typeof entry.getOrderedName === 'function'
      ? entry.getOrderedName(name, pictures)
      : name;
  }

  function addPicturesWithCommands(targetObj, pictures) {
    var pg = getPlayground();
    var added = [];
    var results = [];
    if (!targetObj || !pg) return added;
    withSuppressedPictureRender(pg, false, function () {
      pictures.forEach(function (source) {
        var picture = clonePic(source, targetObj.id);
        picture.name = getOrderedPictureName(picture.name, targetObj.pictures);
        results.push(doEntryCommand('objectAddPicture', targetObj.id, picture, false));
        added.push(picture);
      });
    });
    groupUndoCommands(results); // one Ctrl+Z undoes the whole batch
    return added;
  }

  function visibleByText(text, root) {
    var i, el;
    root = root || document;
    var ab = root.querySelectorAll('a, button');
    for (i = 0; i < ab.length; i++) {
      el = ab[i];
      if (el.offsetParent !== null && el.textContent.trim() === text) return el;
    }
    var others = root.querySelectorAll('div, span, li');
    for (i = 0; i < others.length; i++) {
      el = others[i];
      if (el.offsetParent !== null && el.textContent.trim() === text) return el.closest('a, button') || el;
    }
    return null;
  }

  function waitFor(fn, timeout, interval, isCancelled) {
    timeout = timeout || 10000;
    interval = interval || 120;
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function tick() {
        if (isCancelled && isCancelled()) {
          reject(new Error('작업이 취소되었습니다.'));
          return;
        }
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

  function progClear() {
    clearTimeout(progTimer);
    progTimer = null;
    if (progEl) {
      progEl.remove();
      progEl = null;
    }
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

  function gifToPngFrames(file, onProgress, isCancelled) {
    return (async function () {
      if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported('image/gif'))) {
        throw new Error('이 브라우저는 GIF 디코딩을 지원하지 않습니다(ImageDecoder 없음)');
      }
      var dec = null;
      try {
        if (isCancelled && isCancelled()) return [];
        dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
        await dec.tracks.ready;
        var n = (dec.tracks.selectedTrack && dec.tracks.selectedTrack.frameCount) || 1;
        if (n > MAX_GIF_FRAMES) {
          throw new Error('GIF 프레임은 최대 ' + MAX_GIF_FRAMES + '개까지 처리할 수 있습니다.');
        }
        var base = file.name.replace(/\.gif$/i, '');
        var pad = String(n).length;
        var frames = [];
        for (var i = 0; i < n; i++) {
          if (isCancelled && isCancelled()) return [];
          var decoded = await dec.decode({ frameIndex: i });
          var image = decoded.image;
          try {
            if (image.displayWidth * image.displayHeight > MAX_GIF_FRAME_PIXELS) {
              throw new Error('GIF 한 프레임의 해상도가 너무 큽니다.');
            }
            var cv = document.createElement('canvas');
            cv.width = image.displayWidth; cv.height = image.displayHeight;
            cv.getContext('2d').drawImage(image, 0, 0);
            var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
            if (!blob) throw new Error('GIF 프레임을 PNG로 변환하지 못했습니다.');
            frames.push(new File([blob], base + '_' + String(i + 1).padStart(pad, '0') + '.png', { type: 'image/png' }));
          } finally {
            image.close();
          }
          if (onProgress) onProgress(i + 1, n);
        }
        return frames;
      } finally {
        if (dec && dec.close) dec.close();
      }
    })();
  }

  function expandFiles(files, isCancelled) {
    return (async function () {
      var out = [];
      for (var i = 0; i < files.length; i++) {
        if (isCancelled && isCancelled()) return [];
        var f = files[i];
        if (/\.gif$/i.test(f.name) || f.type === 'image/gif') {
          prog('GIF 분해 중', f.name);
          /* eslint-disable no-loop-func */
          var frames = await gifToPngFrames(f, (function (name) {
            return function (idx, nn) { prog('GIF 분해 중', name + ' (' + idx + '/' + nn + ' 프레임)'); };
          })(f.name), isCancelled);
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
  var uploadRoot = null;
  var uploadSessionId = 0;
  var filePickerSessionId = 0;

  function stage(input, files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closeAlertIfAny() {
    return (async function () {
      var roots = document.querySelectorAll('#entry_global_modal, #entry_global_dialog, #entry_ws_modal');
      for (var i = 0; i < roots.length; i++) {
        var ok = visibleByText('확인', roots[i]);
        if (ok) {
          ok.click();
          await sleep(150);
          return;
        }
      }
    })();
  }

  var staging = false;
  var stageQueue = [];
  var stageTotal = 0; // running grand total (grows when more files are queued mid-staging)
  var activeStageSessionId = 0;

  function findUploadRoot(element) {
    return element && (
      element.closest('#EntryPopupContainer') ||
      element.closest('.modal') ||
      element.closest('[class*="popup_wrap"]')
    );
  }

  function hasNativeUploadInput(root) {
    return !!(root && document.body.contains(root) && root.querySelector('#inpt_file'));
  }

  function isUploadSessionActive(sessionId) {
    return !!(
      enabled &&
      sessionId === uploadSessionId &&
      hasNativeUploadInput(uploadRoot)
    );
  }

  function cancelUploadWork() {
    uploadSessionId++;
    filePickerSessionId = uploadSessionId;
    activeStageSessionId = 0;
    staging = false;
    stageQueue.length = 0;
    stageTotal = 0;
    uploadRoot = null;
    if (fileInput) fileInput.value = '';
    progClear();
  }

  function activateUploadSession(box) {
    var nextRoot = findUploadRoot(box);
    if (!nextRoot) return 0;
    if (uploadRoot !== nextRoot || !hasNativeUploadInput(uploadRoot)) {
      cancelUploadWork();
      uploadRoot = nextRoot;
    }
    filePickerSessionId = uploadSessionId;
    return filePickerSessionId;
  }

  function isUploadCloseAction(target) {
    if (!uploadRoot || !target || !uploadRoot.contains(target)) return false;
    if (target.closest('[class*="imbtn_pop_close"], [class*="btn_back"]')) return true;
    var action = target.closest('a, button');
    return !!(action && action.textContent.trim() === '추가하기');
  }

  function onUploadModalAction(e) {
    if (isUploadCloseAction(e.target)) cancelUploadWork();
  }

  function stageFiles(files, sessionId) {
    if (!files.length || !isUploadSessionActive(sessionId)) return Promise.resolve();
    var input = uploadRoot.querySelector('#inpt_file');
    if (!input) return Promise.resolve();

    // Entry already supports up to ten files in a single native change event. Keep that
    // path unchanged and do not show the extension staging progress UI.
    if (!staging && files.length <= BATCH) {
      progClear();
      stage(input, files);
      return Promise.resolve();
    }

    // Already staging: queue the new files instead of dropping them; the running loop
    // drains the queue when the current batch finishes (so re-uploading mid-upload works).
    // stageTotal also grows so the "현재/총량" progress stays accurate.
    if (staging) {
      if (sessionId !== activeStageSessionId) return Promise.resolve();
      stageQueue.push.apply(stageQueue, files);
      stageTotal += files.length;
      return Promise.resolve();
    }
    staging = true;
    activeStageSessionId = sessionId;
    stageTotal = files.length;
    return (async function () {
      try {
        var staged = 0;
        var batch = files.slice();
        while (batch.length) {
          var chunks = [];
          for (var i = 0; i < batch.length; i += BATCH) chunks.push(batch.slice(i, i + BATCH));
          for (var c = 0; c < chunks.length; c++) {
            if (!isUploadSessionActive(sessionId)) return;
            var chunk = chunks[c];
            stage(input, chunk); // re-set input.files -> Entry stages cumulatively
            staged += chunk.length;
            prog('이미지 추가 중', staged + '/' + stageTotal + '장 준비 중…');
            var lastName = chunk[chunk.length - 1].name;
            try {
              await waitFor(
                (function (name) { return function () { return visibleByText(name, uploadRoot); }; })(lastName),
                3000,
                120,
                function () { return !isUploadSessionActive(sessionId); }
              );
            } catch (e) {
              if (!isUploadSessionActive(sessionId)) return;
            }
            await closeAlertIfAny();
            await sleep(350);
            if (!isUploadSessionActive(sessionId)) return;
          }
          // drain files queued (via stageFiles) while we were staging
          batch = stageQueue.length ? stageQueue.splice(0, stageQueue.length) : [];
        }
        prog('스테이징 완료', stageTotal + '장 준비됨 — "추가하기"를 누르면 적용돼요.');
        progEnd(5000);
      } catch (e) { prog('오류', e.message, true); progEnd(4000); }
      finally {
        if (activeStageSessionId === sessionId) {
          staging = false;
          activeStageSessionId = 0;
          stageQueue.length = 0;
          stageTotal = 0;
        }
      }
    })();
  }

  function handlePickedFiles() {
    var raw = [].slice.call(fileInput.files);
    var sessionId = filePickerSessionId;
    fileInput.value = '';
    if (!raw.length || !isUploadSessionActive(sessionId)) return;
    (async function () {
      var files = raw;
      var hasGif = raw.some(function (f) { return /\.gif$/i.test(f.name) || f.type === 'image/gif'; });
      if (hasGif) {
        try {
          files = await expandFiles(raw, function () {
            return !isUploadSessionActive(sessionId);
          });
        }
        catch (e) { prog('GIF 분해 오류', e.message, true); progEnd(4000); return; }
      }
      if (!isUploadSessionActive(sessionId)) return;
      if (files.length <= BATCH) progClear();
      if (files.length) await stageFiles(files, sessionId);
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
    if (fileInput && activateUploadSession(box)) fileInput.click();
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

  function startObserver() {
    if (mo && enabled) {
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  function stopObserver() {
    if (mo) mo.disconnect();
  }

  function onMutation() {
    if (uploadRoot && !hasNativeUploadInput(uploadRoot)) {
      cancelUploadWork();
    }
    schedule();
  }

  function applyHighlight() {
    var o = curObj();
    // Reset selection when the object changes (the first run keeps it: lastObjId === null).
    if (o) {
      if (lastObjId !== null && o.id !== lastObjId) { selClear(); anchorIdx = null; }
      lastObjId = o.id;
    }
    if (selSize() === 0 && !document.querySelector('.ed-pt-sel')) return;
    stopObserver();
    var rows = allRows();
    for (var i = 0; i < rows.length; i++) {
      var p = o && o.pictures[i];
      if (p && selHas(p.id)) rows[i].classList.add('ed-pt-sel');
      else rows[i].classList.remove('ed-pt-sel');
    }
    startObserver();
  }

  function schedule() {
    if (!enabled || dragging || scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      if (enabled) applyHighlight();
    });
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
    var autoEdgeSince = 0, autoLastDir = 0;
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
      if (!autoDir || !scrollerEl || !lastEv) return;
      var r = scrollerEl.getBoundingClientRect();
      if (lastEv.clientX < r.left || lastEv.clientX > r.right) {
        autoDir = 0;
        autoEdgeSince = 0;
        autoLastDir = 0;
        return;
      }
      var EDGE = 90;
      var distance = autoDir < 0 ? lastEv.clientY - r.top : r.bottom - lastEv.clientY;
      var depth = (EDGE - Math.max(0, distance)) / EDGE;
      var t = (window.performance && performance.now) ? performance.now() : Date.now();
      if (!autoEdgeSince || autoLastDir !== autoDir) autoEdgeSince = t;
      autoLastDir = autoDir;
      var accel = 1 + 2 * Math.min((t - autoEdgeSince) / 700, 1);
      var speed = scrollerEl.scrollHeight * 0.014 * depth * accel;
      speed = Math.max(10, Math.min(3000, speed));
      scrollerEl.scrollTop += autoDir * speed; // scroll event -> onScroll -> processMove updates line
      autoRAF = requestAnimationFrame(autoTick);
    }

    function processMove() {
      raf = 0;
      var ev = lastEv;
      if (!ev || !ghost) return;
      ghost.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 12) + 'px)';
      if (scrollerEl) {
        var r = scrollerEl.getBoundingClientRect(), EDGE = 90;
        var overList = ev.clientX >= r.left && ev.clientX <= r.right;
        var nextDir = overList ? (ev.clientY < r.top + EDGE ? -1 : ev.clientY > r.bottom - EDGE ? 1 : 0) : 0;
        if (!nextDir) {
          autoEdgeSince = 0;
          autoLastDir = 0;
        } else if (nextDir !== autoDir) {
          autoEdgeSince = 0;
        }
        autoDir = nextDir;
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
      autoEdgeSince = 0;
      autoLastDir = 0;
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
    var o = curObj();
    if (!o) return;
    var beforeIds = o.pictures.map(function (p) { return p.id; });
    var rest = o.pictures.filter(function (p) { return !selHas(p.id); });
    var block = o.pictures.filter(function (p) { return selHas(p.id); });
    var result = rest.slice(0, insertAt).concat(block, rest.slice(insertAt));
    var afterIds = result.map(function (p) { return p.id; });
    if (beforeIds.join() === afterIds.join()) { applyHighlight(); return; } // dropped in place: no-op
    applyPictureOrder(o, afterIds);
    registerReorderUndo(o, beforeIds, afterIds);
    applyHighlight();
  }

  // Reorder o.pictures to match orderIds, then re-render — but only when it is the visible
  // object (otherwise just fix the data; it renders correctly when the object is shown).
  function applyPictureOrder(o, orderIds) {
    if (!o || !o.pictures) return false;
    var byId = {};
    o.pictures.forEach(function (p) { byId[p.id] = p; });
    var arr = [];
    for (var i = 0; i < orderIds.length; i++) { var p = byId[orderIds[i]]; if (p) arr.push(p); }
    if (arr.length !== o.pictures.length) return false; // ids no longer match (e.g. a picture was deleted)
    o.pictures.length = 0;
    for (var j = 0; j < arr.length; j++) o.pictures.push(arr[j]);
    if (o === getCurrentObject()) {
      var pg = getPlayground();
      if (!reorderDomFast(o)) keepScroll(function () { try { if (pg) pg.injectPicture(); } catch (err) {} });
    }
    return true;
  }

  // Make a group reorder undoable via Entry's own undo/redo stack. Entry has no native
  // picture-reorder command, so we push a custom command through stateManager.addCommand:
  // the stored func applies an order and re-registers its inverse, returning the
  // { value, isPass } shape StateManager.redo() expects (it calls ret.isPass(...)).
  // Returns the registered command (so callers can fold it into a larger undo group), or null.
  function registerReorderUndo(o, beforeIds, afterIds) {
    var sm = getStateManager();
    if (!sm || typeof sm.addCommand !== 'function') return null;
    function makeFunc(applyIds, inverseIds) {
      return function () {
        applyPictureOrder(o, applyIds);
        var st = sm.addCommand(REORDER_CMD, null, makeFunc(inverseIds, applyIds));
        return { value: undefined, isPass: function (pass) { if (st) st.isPass = pass; } };
      };
    }
    // First undo restores beforeIds; redo restores afterIds (the order the drag just applied).
    try { return sm.addCommand(REORDER_CMD, null, makeFunc(beforeIds, afterIds)); } catch (e) { return null; }
  }

  function updatePictureOrderLabels(o) {
    (o && o.pictures || []).forEach(function (picture, index) {
      if (picture && picture.view && picture.view.orderHolder) {
        picture.view.orderHolder.textContent = index + 1;
      }
    });
  }

  // Fast reorder: move rendered row DOM into the new order and sync the widget model,
  // instead of a full injectPicture re-render (slow with 1000+ pictures). Falls back if
  // any precondition (rendered view / widget / mapping) is missing.
  function reorderDomFast(o) {
    var pg = getPlayground();
    try {
      var w = getPictureListWidget();
      var widgetItems = getPictureListItems(w);
      if (!w || !widgetItems) return false;
      var el = function (v) { return v ? (v.nodeType ? v : v[0] || null) : null; };
      // A picture object duplicated in o.pictures (a malformed costume list — the same picture
      // appears at two indices) shares ONE rendered view. The DocumentFragment move below can
      // place that element in only one slot, so the empty leftover wrap rows stay behind and
      // surface at the TOP of the list (the reorder looks scrambled). Bail to the safe full
      // re-render, which draws a duplicated list in the correct visible order.
      var seenView = new Set();
      for (var di = 0; di < o.pictures.length; di++) {
        var dv = el(o.pictures[di].view);
        if (!dv || seenView.has(dv)) return false;
        seenView.add(dv);
      }
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
      var byView = new Map();
      widgetItems.forEach(function (it) {
        var key = el(it.item);
        if (key) byView.set(key, it);
      });
      var items = [];
      for (i = 0; i < o.pictures.length; i++) {
        var key2 = el(o.pictures[i].view);
        var item = key2 ? byView.get(key2) : null;
        if (!item) return false;
        items.push(item);
      }
      var sc = getScroller();
      var top = sc ? sc.scrollTop : 0;
      var frag = document.createDocumentFragment();
      wraps.forEach(function (wp) { frag.appendChild(wp); });
      container.appendChild(frag);
      if (!setPictureListItems(w, items, false)) return false;
      updatePictureOrderLabels(o);
      if (sc) sc.scrollTop = top;
      return true;
    } catch (e) { return false; }
  }

  // Fast bulk remove: suppress injectPicture during removePicture (it re-renders per call),
  // then drop only the deleted rows via widget.setData. Falls back to one injectPicture.
  function fastBulkRemove(o, ids) {
    var pg = getPlayground();
    var w = getPictureListWidget();
    var widgetItems = getPictureListItems(w);
    var el = function (v) { return v ? (v.nodeType ? v : v[0] || null) : null; };
    var canFast = !!(w && widgetItems);
    var delSet = {}, delLis = [];
    var pictures = [];
    ids.forEach(function (id) { delSet[id] = true; });
    o.pictures.forEach(function (p) {
      if (!delSet[p.id]) return;
      pictures.push(p);
      if (canFast) {
        var li = el(p.view);
        if (li) delLis.push(li);
      }
    });
    if (canFast && delLis.length !== pictures.length) canFast = false;
    var removed = [];
    var results = [];
    // Bottom of the undo group: Entry's addPicture (the inverse of remove) appends, so undoing a
    // delete would drop the pictures at the end. Register a restore-order command first (popped
    // last on undo) that puts them back in their original positions.
    var beforeIds = o.pictures.map(function (p) { return p.id; });
    var afterIds = beforeIds.filter(function (id) { return ids.indexOf(id) === -1; });
    var orderState = registerReorderUndo(o, beforeIds, afterIds);
    if (orderState) results.push(orderState);
    try {
      withSuppressedPictureRender(pg, true, function () {
        pictures.forEach(function (picture) {
          try {
            results.push(doEntryCommand('objectRemovePicture', o.id, picture));
            if (o.pictures.indexOf(picture) === -1) removed.push(picture);
          } catch (e) {}
        });
      });
    } catch (e) {}
    groupUndoCommands(results); // one Ctrl+Z restores the whole batch
    if (removed.length !== pictures.length) canFast = false;
    if (canFast) {
      try {
        var items = widgetItems.filter(function (it) { return delLis.indexOf(el(it.item)) === -1; });
        var sc = getScroller();
        var top = sc ? sc.scrollTop : 0;
        setPictureListItems(w, items, true);
        updatePictureOrderLabels(o);
        if (sc) sc.scrollTop = top;
        if (pg && typeof pg.reloadPlayground === 'function') pg.reloadPlayground();
        return removed.length;
      } catch (e) {}
    }
    keepScroll(function () { try { pg.injectPicture(); } catch (e) {} });
    try { if (pg && typeof pg.reloadPlayground === 'function') pg.reloadPlayground(); } catch (e) {}
    return removed.length;
  }

  // Copy the group to another object (originals kept). Target is offscreen and the current
  // object's pictures are unchanged, so suppress injectPicture entirely (data only).
  function copyPicturesTo(targetObj) {
    var pg = getPlayground();
    var o = curObj();
    if (!o || !targetObj || targetObj.id === o.id) return;
    var picks = picksFromSelection(o);
    try {
      var n = addPicturesWithCommands(targetObj, picks).length;
    } catch (err) {
      nativeToast('복사 오류', err.message, true);
      return;
    }
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
    var added;
    try {
      added = addPicturesWithCommands(o, pictureClipboard);
    } catch (err) {
      nativeToast('붙여넣기 오류', err.message, true);
      return;
    }
    keepScroll(function () { try { pg.injectPicture(); } catch (err) {} });
    applyHighlight();
    nativeToast('붙여넣기 완료', added.length + '개 모양을 추가했어요.');
  }

  // Duplicate selected pictures right after the group (originals kept). New pictures have
  // no rendered view yet, so a single injectPicture is used (reorderDomFast cannot apply).
  function duplicatePictures(picks) {
    var pg = getPlayground();
    var o = curObj();
    if (!o || !picks.length) return;
    var indices = picks.map(function (p) { return o.pictures.indexOf(p); });
    var anchor = o.pictures[Math.max.apply(null, indices)];
    var added;
    try {
      added = addPicturesWithCommands(o, picks);
    } catch (err) {
      nativeToast('복제 오류', err.message, true);
      return;
    }
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
      var ok = await nativeConfirm('모양 삭제', '선택한 모양 ' + cnt + '개를 한꺼번에 삭제할까요?');
      if (!ok) return;
      var removed = fastBulkRemove(o, ids);
      clearSelAndHighlight();
      nativeToast('삭제 완료', removed + '개 삭제 (남은 ' + o.pictures.length + '개).');
    })();
  }

  // Entry-styled text prompt (replaces the browser's window.prompt). Mirrors Entry's confirm
  // modal: blue header bar with white title + X, white body, 취소(white)/확인(blue) footer.
  // Resolves the entered value, or null on cancel.
  function styledPrompt(title, desc, defValue) {
    return new Promise(function (resolve) {
      var BLUE = 'rgb(79,128,255)';
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483600;display:flex;align-items:center;justify-content:center;';
      var card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:16px;overflow:hidden;width:400px;max-width:92vw;box-sizing:border-box;' +
        'box-shadow:0 12px 38px rgba(0,0,0,.34);font-family:NanumGothic,"맑은 고딕",sans-serif;color:#2c313d;';
      var head = document.createElement('div');
      head.style.cssText = 'background:' + BLUE + ';display:flex;align-items:center;justify-content:space-between;padding:16px 22px;';
      var ht = document.createElement('div');
      ht.textContent = title;
      ht.style.cssText = 'color:#fff;font-size:18px;font-weight:700;';
      var x = document.createElement('div');
      x.textContent = '✕';
      x.style.cssText = 'color:#fff;font-size:20px;font-weight:700;cursor:pointer;line-height:1;padding:2px 4px;';
      head.appendChild(ht); head.appendChild(x);
      card.appendChild(head);
      var body = document.createElement('div');
      body.style.cssText = 'padding:22px;';
      if (desc) {
        var d = document.createElement('div');
        d.textContent = desc;
        d.style.cssText = 'font-size:13px;font-weight:700;color:#73777f;margin-bottom:12px;';
        body.appendChild(d);
      }
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = defValue == null ? '' : defValue;
      inp.style.cssText = 'width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #c2c8d4;border-radius:6px;font-size:14px;font-family:inherit;color:#2c313d;outline:none;';
      inp.addEventListener('focus', function () { inp.style.borderColor = BLUE; });
      inp.addEventListener('blur', function () { inp.style.borderColor = '#c2c8d4'; });
      body.appendChild(inp);
      card.appendChild(body);
      var foot = document.createElement('div');
      foot.style.cssText = 'display:flex;gap:10px;padding:0 22px 22px;';
      var btn = 'flex:1;height:46px;border-radius:6px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid ' + BLUE + ';';
      var cancel = document.createElement('button');
      cancel.textContent = '취소';
      cancel.style.cssText = btn + 'background:#fff;color:' + BLUE + ';';
      var ok = document.createElement('button');
      ok.textContent = '확인';
      ok.style.cssText = btn + 'background:' + BLUE + ';color:#fff;';
      foot.appendChild(cancel); foot.appendChild(ok);
      card.appendChild(foot);
      ov.appendChild(card);
      document.body.appendChild(ov);
      var done = false;
      function close(val) { if (done) return; done = true; ov.remove(); resolve(val); }
      inp.addEventListener('keydown', function (e) {
        e.stopPropagation(); // keep Entry's global shortcuts from firing while typing
        if (e.key === 'Enter') { e.preventDefault(); close(inp.value); }
        else if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });
      ok.addEventListener('click', function () { close(inp.value); });
      cancel.addEventListener('click', function () { close(null); });
      x.addEventListener('click', function () { close(null); });
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(null); });
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
    });
  }

  function bulkRename(picks) {
    if (!picks.length) return;
    var o = curObj();
    var pg = getPlayground();
    var entry = safeGetEntry();
    var dflt = (picks[0].name || '').replace(/_\d+$/, '');
    styledPrompt('선택한 ' + picks.length + '개 모양의 새 이름', '뒤에 _번호가 자동으로 붙어요', dflt).then(function (input) {
      if (input == null) return;
      var base = input.trim();
      if (!base) {
        nativeToast('이름변경 불가', '모양 이름을 입력해 주세요.', true);
        return;
      }
      var width = Math.max(2, String(picks.length).length);
      var names = picks.map(function (_, i) {
        return base + '_' + String(i + 1).padStart(width, '0');
      });
      var reserved = Object.create(null);
      o.pictures.forEach(function (picture) {
        if (picks.indexOf(picture) === -1) reserved[picture.name] = true;
      });
      for (var n = 0; n < names.length; n++) {
        if (reserved[names[n]]) {
          nativeToast('이름변경 불가', '"' + names[n] + '" 이름이 이미 사용 중입니다.', true);
          return;
        }
        reserved[names[n]] = true;
      }
      var rows = allRows();
      picks.forEach(function (p, i) {
        var name = names[i];
        p.name = name;
        var row = rows[o.pictures.indexOf(p)];
        var inp = row && row.querySelector('input.entryPlaygroundPictureName');
        if (inp) inp.value = name;
      });
      var painter = pg && pg.painter;
      var selected = o.selectedPicture;
      if (painter && painter.file && selected && picks.indexOf(selected) !== -1) {
        painter.file.name = selected.name;
      }
      if (pg) {
        pg.nameViewFocus = false;
        if (typeof pg.reloadPlayground === 'function') pg.reloadPlayground();
      }
      if (entry && typeof entry.dispatchEvent === 'function') {
        picks.forEach(function (picture) {
          entry.dispatchEvent('pictureNameChanged', picture);
        });
      }
      nativeToast('이름변경 완료', picks.length + '개 → "' + base + '_' + '1'.padStart(width, '0') + '…"');
    });
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
        var files = [], used = Object.create(null), totalBytes = 0;
        for (var i = 0; i < picks.length; i++) {
          var p = picks[i];
          var url = new URL(p.fileurl, location.href).href;
          var res = await fetch(url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var data = new Uint8Array(await res.arrayBuffer());
          totalBytes += data.length;
          if (totalBytes > MAX_EXPORT_BYTES) {
            throw new Error('내보낼 이미지의 전체 크기가 너무 큽니다.');
          }
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
    document.addEventListener('click', onUploadModalAction, true);
    document.addEventListener('contextmenu', onCtxMenu, true);
    mo = new MutationObserver(onMutation);
    startObserver();
  }

  // Entry re-renders the whole picture list on every command (objectAddPicture /
  // objectRemovePicture each call injectPicture), so a grouped delete/duplicate undo does one
  // full re-render per picture — slow on large lists. Suppress injectPicture during the entire
  // undo/redo and render once at the end (only if a command asked for it), keeping the scroll.
  function patchUndoRedoScroll() {
    var sm = getStateManager();
    if (!sm) return false;
    function wrap(orig) {
      return function () {
        if (!enabled) return orig.apply(this, arguments);
        var self = this, args = arguments, ret;
        var pg = getPlayground();
        if (!pg || typeof pg.injectPicture !== 'function') {
          keepScroll(function () { ret = orig.apply(self, args); });
          return ret;
        }
        var realInject = pg.injectPicture;
        var requested = false, lastArgs = null;
        pg.injectPicture = function () { requested = true; lastArgs = arguments; };
        try {
          ret = orig.apply(self, args);
        } finally {
          pg.injectPicture = realInject;
        }
        if (requested) {
          keepScroll(function () { try { realInject.apply(pg, lastArgs || []); } catch (e) {} });
        }
        return ret;
      };
    }
    var a = patchMethod(sm, 'undo', PATCH_ID, wrap);
    var b = patchMethod(sm, 'redo', PATCH_ID, wrap);
    return a && b;
  }

  // Native "모양 추가" (and addPicture-based ops) call injectPicture, which re-renders the WHOLE
  // costume list via widget.setData. setData is O(N) on the TOTAL list size (~120ms+ at 800+
  // costumes) no matter how many were added, and the native flow calls injectPicture once PER added
  // costume — so uploading N costumes costs N × O(N), i.e. seconds of lag (same root cause as the
  // reorder lag). Fix: when the change is a pure append, build only the new rows synchronously
  // (cheap, ~0.1ms each) and COALESCE the one expensive setData — a single render after a burst of
  // adds instead of one render per costume.
  var pendingAppendFlush = null;

  function appendViewEl(v) { return v ? (v.nodeType ? v : v[0] || null) : null; }

  // True when the widget's current rows still map 1:1 to the first N pictures (so the rest are new).
  function isPictureAppendOnly(o, items) {
    if (!o || !o.pictures || !items || o.pictures.length <= items.length) return false;
    for (var i = 0; i < items.length; i++) {
      if (appendViewEl(o.pictures[i] && o.pictures[i].view) !== appendViewEl(items[i] && items[i].item)) return false;
    }
    // The same defense reorderDomFast needs: when a picture object is duplicated in o.pictures it
    // shares one view, so the incremental append would emit a repeated key/element and strand empty
    // rows. Treat such a list as "not a clean append" and let the full native re-render handle it.
    var seen = new Set();
    for (var k = 0; k < o.pictures.length; k++) {
      var v = appendViewEl(o.pictures[k] && o.pictures[k].view);
      if (v) { if (seen.has(v)) return false; seen.add(v); }
    }
    return true;
  }

  function cancelAppendFlush() {
    if (pendingAppendFlush) { clearTimeout(pendingAppendFlush); pendingAppendFlush = null; }
  }

  // The single coalesced render: append every picture past the current rows in one setData.
  function flushAppend(o) {
    pendingAppendFlush = null;
    try {
      var pg = getPlayground();
      if (!pg || pg.object !== o) return;            // object switched away → stale, skip
      var w = getPictureListWidget();
      var items = getPictureListItems(w);
      if (!isPictureAppendOnly(o, items)) return;    // no longer a clean append → leave to full render
      var ni = items.slice();
      for (var j = items.length; j < o.pictures.length; j++) {
        var pic = o.pictures[j];
        if (!pic.view) { try { pg.generatePictureElement(pic); } catch (e) {} }
        var pv = appendViewEl(pic.view);
        if (pv) {
          // generatePictureElement leaves the order badge blank; native injectPicture fills it by
          // index afterwards. Replicate that for the appended rows (1-based position).
          var orderEl = pv.querySelector('.entryPlaygroundPictureOrder');
          if (orderEl) orderEl.textContent = String(j + 1);
          ni.push({ key: o.id + '-' + pic.id, item: pic.view });
        }
      }
      if (ni.length !== o.pictures.length) return;   // a row failed to build → leave it for a full render
      var sc = getScroller();
      var top = sc ? sc.scrollTop : 0;
      if (setPictureListItems(w, ni, true) && sc) sc.scrollTop = top;
    } catch (e) {}
  }

  function patchIncrementalInject() {
    var pg = getPlayground();
    if (!pg || typeof pg.injectPicture !== 'function' || typeof pg.generatePictureElement !== 'function') return false;
    return patchMethod(pg, 'injectPicture', PATCH_ID, function (orig) {
      return function () {
        if (!enabled) return orig.apply(this, arguments);
        try {
          var p = getPlayground();
          var w = getPictureListWidget();
          var items = getPictureListItems(w);
          var o = p && p.object;
          if (isPictureAppendOnly(o, items)) {
            // Generate the new rows' elements now so they exist for selectPicture, but defer the one
            // costly setData; a trailing 50ms window coalesces a burst of adds into a single render.
            for (var j = items.length; j < o.pictures.length; j++) {
              var pic = o.pictures[j];
              if (!pic.view) { try { p.generatePictureElement(pic); } catch (e) {} }
            }
            cancelAppendFlush();
            (function (target) { pendingAppendFlush = setTimeout(function () { flushAppend(target); }, 50); })(o);
            return;
          }
        } catch (e) {}
        cancelAppendFlush();                          // a full re-render supersedes any pending append
        return orig.apply(this, arguments);
      };
    });
  }

  function applyEntry() {
    var entry = safeGetEntry();
    if (!entry || !entry.playground || !document.body) return false;
    installOnce();
    // ContextMenu.show is patched once and stays; the wrapper checks enabled itself.
    patchContextMenu();
    patchUndoRedoScroll();
    patchIncrementalInject();
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
      startObserver();
      scheduleRetry();
    } else {
      if (ctxEl) closeCtx();
      stopObserver();
      cancelUploadWork();
      clearSelAndHighlight();
    }
    post('PICTURE_TOOLS_RESULT', { success: true, enabled: enabled }, msg.requestId);
  });

  post('PICTURE_TOOLS_READY', { enabled: enabled });
})();
