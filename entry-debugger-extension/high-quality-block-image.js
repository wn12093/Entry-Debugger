/**
 * high-quality-block-image.js - Saves Entry block images at a configurable high scale.
 *
 * This is an experimental, UI-only patch. It does not modify Entry project JSON.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_HIGH_QUALITY_BLOCK_IMAGE_INJECTED__) return;
  window.__ENTRY_DEBUGGER_HIGH_QUALITY_BLOCK_IMAGE_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const DEFAULT_SCALE = 10;
  const MIN_SCALE = 2;
  const MAX_SCALE = 20;
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;

  let enabled = false;
  let targetScale = DEFAULT_SCALE;
  let retryTimer = null;
  let retryUntil = 0;

  function safeGetEntry() {
    if (Adapter && typeof Adapter.getEntry === 'function') {
      return Adapter.getEntry();
    }
    try {
      return window.Entry || null;
    } catch (e) {
      return null;
    }
  }

  function post(type, payload, requestId) {
    if (Bridge && typeof Bridge.post === 'function') {
      Bridge.post(type, payload, requestId);
      return;
    }
    window.postMessage({
      channel: CHANNEL,
      type: type,
      payload: payload || null,
      requestId: requestId || null
    }, window.location.origin);
  }

  function onMessage(handler) {
    if (Bridge && typeof Bridge.onMessage === 'function') {
      Bridge.onMessage(handler);
      return;
    }
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

  function patchEntry(entry) {
    var proto = entry && entry.BlockView && entry.BlockView.prototype;
    if (!proto || typeof proto.getDataUrl !== 'function') return false;

    return patchMethod(proto, 'getDataUrl', 'high-quality-block-image', function (originalGetDataUrl) {
      return function () {
        if (!enabled) {
          return originalGetDataUrl.apply(this, arguments);
        }
        return callWithHighQualityScale(this, originalGetDataUrl, arguments);
      };
    });
  }

  function callWithHighQualityScale(blockView, originalGetDataUrl, args) {
    var board = getBoard(blockView);
    var svgGroup = blockView && blockView.svgGroup;
    var currentScale = readScale(board);

    if (!board || !svgGroup || !Number.isFinite(currentScale) || currentScale <= 0) {
      return originalGetDataUrl.apply(blockView, args);
    }

    var scaleMultiplier = targetScale / currentScale;
    var originalBoardScale = board.scale;
    var restoreRect = patchBoundingRect(svgGroup, scaleMultiplier);
    board.scale = targetScale;

    try {
      return originalGetDataUrl.apply(blockView, args);
    } catch (e) {
      throw e;
    } finally {
      restoreHighQualityState(board, originalBoardScale, restoreRect);
    }
  }

  function getBoard(blockView) {
    try {
      if (blockView && typeof blockView.getBoard === 'function') {
        return blockView.getBoard();
      }
    } catch (e) {}
    return null;
  }

  function readScale(board) {
    var scale = Number(board && board.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function patchBoundingRect(svgGroup, multiplier) {
    if (!svgGroup || typeof svgGroup.getBoundingClientRect !== 'function') {
      return function () {};
    }

    var original = svgGroup.getBoundingClientRect;
    var restored = false;

    function scaledBoundingRect() {
      var rect = original.apply(this, arguments);
      return scaleRect(rect, multiplier);
    }

    try {
      svgGroup.getBoundingClientRect = scaledBoundingRect;
    } catch (e) {
      try {
        Object.defineProperty(svgGroup, 'getBoundingClientRect', {
          configurable: true,
          writable: true,
          value: scaledBoundingRect
        });
      } catch (ignored) {
        return function () {};
      }
    }

    return function () {
      if (restored) return;
      restored = true;
      try {
        svgGroup.getBoundingClientRect = original;
      } catch (e) {
        try {
          Object.defineProperty(svgGroup, 'getBoundingClientRect', {
            configurable: true,
            writable: true,
            value: original
          });
        } catch (ignored) {}
      }
    };
  }

  function scaleRect(rect, multiplier) {
    var left = Number(rect && rect.left) || 0;
    var top = Number(rect && rect.top) || 0;
    var width = Math.max(1, (Number(rect && rect.width) || 0) * multiplier);
    var height = Math.max(1, (Number(rect && rect.height) || 0) * multiplier);

    return {
      x: left,
      y: top,
      left: left,
      top: top,
      width: width,
      height: height,
      right: left + width,
      bottom: top + height
    };
  }

  function restoreHighQualityState(board, originalBoardScale, restoreRect) {
    try {
      board.scale = originalBoardScale;
    } catch (e) {}
    try {
      restoreRect && restoreRect();
    } catch (e) {}
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function schedulePatchRetry() {
    clearRetry();
    retryUntil = Date.now() + RETRY_TIMEOUT;

    function tick() {
      retryTimer = null;
      var patched = patchEntry(safeGetEntry());
      if (!patched && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function normalizeScale(value) {
    var scale = Number(value);
    if (!Number.isFinite(scale)) scale = DEFAULT_SCALE;
    if (scale < MIN_SCALE) return MIN_SCALE;
    if (scale > MAX_SCALE) return MAX_SCALE;
    return scale;
  }

  function normalizeScalePercent(value) {
    var percent = Number(value);
    if (!Number.isFinite(percent)) percent = DEFAULT_SCALE * 100;
    if (percent < MIN_SCALE * 100) return MIN_SCALE * 100;
    if (percent > MAX_SCALE * 100) return MAX_SCALE * 100;
    return Math.round(percent);
  }

  function updateTargetScale(payload) {
    payload = payload || {};
    if (typeof payload.scalePercent !== 'undefined') {
      targetScale = normalizeScalePercent(payload.scalePercent) / 100;
      return;
    }
    if (typeof payload.scale !== 'undefined') {
      targetScale = normalizeScale(payload.scale);
    }
  }

  function getScalePayload() {
    return {
      scale: targetScale,
      scalePercent: Math.round(targetScale * 100)
    };
  }

  onMessage(function (msg) {
    if (msg.type !== 'SET_HIGH_QUALITY_BLOCK_IMAGE_ENABLED') return;
    updateTargetScale(msg.payload);
    enabled = !!(msg.payload && msg.payload.enabled);
    if (enabled) {
      schedulePatchRetry();
    } else {
      clearRetry();
    }
    post('HIGH_QUALITY_BLOCK_IMAGE_RESULT', Object.assign({
      success: true,
      enabled: enabled
    }, getScalePayload()), msg.requestId);
  });

  schedulePatchRetry();
  post('HIGH_QUALITY_BLOCK_IMAGE_READY', Object.assign({
    enabled: enabled
  }, getScalePayload()));
})();
