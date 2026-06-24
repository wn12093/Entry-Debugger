/**
 * single-block-drag.js - Alt+drag only the clicked block in a connected stack.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_SINGLE_BLOCK_DRAG_INJECTED__) return;
  window.__ENTRY_DEBUGGER_SINGLE_BLOCK_DRAG_INJECTED__ = true;

  var CHANNEL = '__ENTRY_DEBUGGER__';
  var RETRY_INTERVAL = 300;
  var RETRY_TIMEOUT = 30000;
  var PATCH_ID = 'single-block-drag';
  var Bridge = window.EntryDebuggerPageBridge || null;
  var Adapter = window.EntryDebuggerEntryAdapter || null;
  var Patches = window.EntryDebuggerPatchRegistry || null;

  var enabled = false;
  var retryTimer = null;
  var retryUntil = 0;

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

  function patchEntry(entry) {
    var proto = entry && entry.BlockView && entry.BlockView.prototype;
    if (
      !entry ||
      !proto ||
      typeof proto.onMouseDown !== 'function' ||
      typeof proto.onMouseMove !== 'function' ||
      typeof proto.terminateDrag !== 'function'
    ) {
      return false;
    }

    var downPatched = patchMethod(proto, 'onMouseDown', PATCH_ID, function (originalOnMouseDown) {
      return function (event) {
        this.__entryDebuggerSingleDragRequested = shouldRequestSingleDrag(this, event);
        this.__entryDebuggerSingleDragPrepared = false;
        this.__entryDebuggerSingleDragMarker = null;
        // onMouseMove는 인스턴스 바인딩이라 prototype 패치가 닿지 않는다 → 인스턴스에서 감싼다.
        if (this.__entryDebuggerSingleDragRequested) {
          installInstanceMoveHook(entry, this);
        }
        return originalOnMouseDown.apply(this, arguments);
      };
    });

    var terminatePatched = patchMethod(proto, 'terminateDrag', PATCH_ID, function (originalTerminateDrag) {
      return function () {
        var prepared = !!this.__entryDebuggerSingleDragPrepared;
        var marker = this.__entryDebuggerSingleDragMarker || null;
        try {
          return originalTerminateDrag.apply(this, arguments);
        } finally {
          if (prepared) {
            markFinalDragCommandAsPass(entry, marker);
          }
          clearSingleDragState(this);
        }
      };
    });

    return !!(downPatched && terminatePatched);
  }

  // Entry는 BlockView 생성자에서 onMouseMove를 인스턴스에 바인딩한다
  // (block_view.js: this.onMouseMove = this.onMouseMove.bind(this)). 그래서
  // prototype.onMouseMove 패치는 이미 렌더된(또는 기능을 켜기 전에 생성된) 블록에
  // 닿지 않는다. prototype으로 도는 onMouseDown에서 인스턴스 핸들러를 직접 감싸,
  // Entry가 onMouseDown 안에서 this.onMouseMove를 mousemove에 바인딩하기 전에 교체한다.
  function installInstanceMoveHook(entry, blockView) {
    if (!blockView || blockView.__entryDebuggerMoveHookInstalled) return;
    var instanceMove = blockView.onMouseMove;
    if (typeof instanceMove !== 'function') return;
    blockView.onMouseMove = function (event) {
      if (shouldPrepareOnMove(entry, blockView, event)) {
        prepareSingleBlockDrag(entry, blockView);
      }
      return instanceMove.apply(blockView, arguments);
    };
    blockView.__entryDebuggerMoveHookInstalled = true;
  }

  function shouldRequestSingleDrag(blockView, event) {
    return !!(
      enabled &&
      event &&
      event.altKey &&
      blockView &&
      !blockView.isInBlockMenu &&
      blockView.block &&
      blockView.movable !== false &&
      !blockView.readOnly &&
      !(blockView.getBoard && blockView.getBoard() && blockView.getBoard().readOnly)
    );
  }

  function shouldPrepareOnMove(entry, blockView, event) {
    if (
      !enabled ||
      !blockView ||
      !blockView.__entryDebuggerSingleDragRequested ||
      blockView.__entryDebuggerSingleDragPrepared ||
      blockView.isInBlockMenu ||
      !blockView.block ||
      !blockView.dragInstance ||
      !blockView.mouseDownCoordinate
    ) {
      return false;
    }

    if (blockView.dragMode === entry.DRAG_MODE_DRAG) {
      return false;
    }

    var mouseEvent = getMouseEvent(event);
    if (!mouseEvent) return false;

    var diff = Math.sqrt(
      Math.pow(mouseEvent.pageX - blockView.mouseDownCoordinate.x, 2) +
      Math.pow(mouseEvent.pageY - blockView.mouseDownCoordinate.y, 2)
    );
    var radius = entry.BlockView && entry.BlockView.DRAG_RADIUS || 3;
    return diff > radius && canPrepareSingleBlockDrag(entry, blockView.block);
  }

  function getMouseEvent(event) {
    if (!event) return null;
    if (event.originalEvent && event.originalEvent.touches) return event.originalEvent.touches[0];
    if (event.touches) return event.touches[0];
    return event;
  }

  function canPrepareSingleBlockDrag(entry, block) {
    if (!block || !block.view) return false;
    if (typeof block.getBlockType === 'function' && block.getBlockType() !== 'basic') return false;
    if (typeof block.getNextBlock !== 'function' || !block.getNextBlock()) return false;

    var prevBlock = typeof block.getPrevBlock === 'function' ? block.getPrevBlock() : null;
    if (prevBlock) return true;

    var thread = typeof block.getThread === 'function' ? block.getThread() : block.thread;
    return isTopLevelThread(entry, thread) || isStatementThread(entry, thread);
  }

  function isTopLevelThread(entry, thread) {
    return !!(
      thread &&
      entry.Thread &&
      thread instanceof entry.Thread &&
      thread.parent &&
      entry.Code &&
      thread.parent instanceof entry.Code
    );
  }

  function isStatementThread(entry, thread) {
    return !!(
      thread &&
      entry.Thread &&
      thread instanceof entry.Thread &&
      thread.parent &&
      entry.Block &&
      thread.parent instanceof entry.Block &&
      thread.parent.statements &&
      thread.parent.statements.indexOf(thread) > -1
    );
  }

  function prepareSingleBlockDrag(entry, blockView) {
    var block = blockView && blockView.block;
    if (!canPrepareSingleBlockDrag(entry, block)) return false;

    var prevBlock = block.getPrevBlock();
    var nextBlock = block.getNextBlock();
    var originalThread = typeof block.getThread === 'function' ? block.getThread() : null;
    var isFirstStatementBlock = !prevBlock && isStatementThread(entry, originalThread);
    var didPrepare = false;

    try {
      if (prevBlock) {
        entry.do('separateBlock', block, entry.DRAG_MODE_MOUSEDOWN);
        entry.do('insertBlock', nextBlock, prevBlock, getBlockCountFrom(nextBlock)).isPass(true);
        didPrepare = true;
      } else if (isFirstStatementBlock) {
        entry.do('separateBlock', block, entry.DRAG_MODE_MOUSEDOWN);
        entry.do('insertBlock', nextBlock, originalThread, getBlockCountFrom(nextBlock)).isPass(true);
        didPrepare = true;
      } else {
        entry.do('separateBlock', nextBlock, entry.DRAG_MODE_MOUSEDOWN);
        didPrepare = true;
      }

      if (didPrepare) {
        blockView.__entryDebuggerSingleDragPrepared = true;
        blockView.__entryDebuggerSingleDragMarker = getLastCommand(entry);
        blockView.fromBlockMenu = false;
      }
      return didPrepare;
    } catch (e) {
      console.warn('[Entry Debugger] Alt single-block drag failed.', e);
      blockView.__entryDebuggerSingleDragPrepared = false;
      return false;
    }
  }

  function getBlockCountFrom(block) {
    try {
      var thread = block && typeof block.getThread === 'function' ? block.getThread() : null;
      if (thread && typeof thread.getCount === 'function') {
        return thread.getCount(block);
      }
    } catch (e) {}
    return undefined;
  }

  function getLastCommand(entry) {
    try {
      if (
        entry &&
        entry.stateManager &&
        typeof entry.stateManager.getLastCommand === 'function'
      ) {
        return entry.stateManager.getLastCommand() || null;
      }
    } catch (e) {}
    return null;
  }

  function markFinalDragCommandAsPass(entry, marker) {
    var lastCommand = getLastCommand(entry);
    if (!lastCommand || lastCommand === marker) return;

    try {
      if (entry && typeof entry.isPass === 'function') {
        entry.isPass(true);
      }
    } catch (e) {}
  }

  function clearSingleDragState(blockView) {
    if (!blockView) return;
    delete blockView.__entryDebuggerSingleDragRequested;
    delete blockView.__entryDebuggerSingleDragPrepared;
    delete blockView.__entryDebuggerSingleDragMarker;
  }

  onMessage(function (msg) {
    if (msg.type !== 'SET_SINGLE_BLOCK_DRAG_ENABLED') return;
    enabled = !!(msg.payload && msg.payload.enabled);
    patchEntry(safeGetEntry());
    schedulePatchRetry();
    post('SINGLE_BLOCK_DRAG_RESULT', { success: true, enabled: enabled }, msg.requestId);
  });

  schedulePatchRetry();
  post('SINGLE_BLOCK_DRAG_READY', { enabled: enabled });
})();
