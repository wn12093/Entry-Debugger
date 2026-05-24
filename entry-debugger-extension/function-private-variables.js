/**
 * function-private-variables.js - Show object-local variables in function edit mode.
 *
 * Entry normally hides variables/lists whose object_ is set while Entry.Func.isEdit is true.
 * This module keeps the original JSON model untouched and only changes dropdown generation
 * while the experimental setting is enabled.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_FUNCTION_PRIVATE_VARIABLES_INJECTED__) return;
  window.__ENTRY_DEBUGGER_FUNCTION_PRIVATE_VARIABLES_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const PATCH_MARK = '__entryDebuggerFunctionPrivateVariablesPatched';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;

  let enabled = false;
  let retryTimer = null;
  let retryUntil = 0;

  function safeGetEntry() {
    try {
      return window.Entry || null;
    } catch (e) {
      return null;
    }
  }

  function getNoTargetLabel(entry) {
    try {
      return window.Lang?.Blocks?.no_target ||
        entry?.Lang?.Blocks?.no_target ||
        '대상 없음';
    } catch (e) {
      return '대상 없음';
    }
  }

  function resolveObject(entry, object) {
    if (!object) {
      return entry?.playground?.object || null;
    }
    if (object.id) {
      return object;
    }
    try {
      return entry?.container?.getObject?.(object) || null;
    } catch (e) {
      return null;
    }
  }

  function shouldUsePrivateVariableDropdown(entry, menuName, object) {
    return !!(
      enabled &&
      entry &&
      entry.Func &&
      entry.Func.isEdit &&
      object &&
      (menuName === 'variables' || menuName === 'lists')
    );
  }

  function getItemName(item) {
    try {
      if (typeof item.getName === 'function') return item.getName();
    } catch (e) {}
    return item?.name_ || item?.name || item?.id_ || item?.id || '';
  }

  function getItemId(item) {
    try {
      if (typeof item.getId === 'function') return item.getId();
    } catch (e) {}
    return item?.id_ || item?.id || '';
  }

  function buildDropdownList(entry, menuName, object) {
    const variableContainer = entry?.variableContainer;
    const source = menuName === 'lists'
      ? variableContainer?.lists_
      : variableContainer?.variables_;
    const result = [];

    if (!Array.isArray(source)) {
      return [[getNoTargetLabel(entry), 'null']];
    }

    source.forEach(function (item) {
      if (item.object_ && item.object_ !== object.id) {
        return;
      }

      result.push([getItemName(item), getItemId(item)]);
    });

    return result.length ? result : [[getNoTargetLabel(entry), 'null']];
  }

  function refreshVariableBlocks() {
    const entry = safeGetEntry();
    const blockMenu = entry?.playground?.blockMenu;

    try {
      blockMenu?.deleteRendered?.('variable');
    } catch (e) {}

    try {
      entry?.playground?.reloadPlayground?.();
    } catch (e) {}

    try {
      entry?.getMainWS?.()?.overlayBoard?.reDraw?.();
    } catch (e) {}
  }

  function patchContainer(entry) {
    const container = entry?.container;
    if (!container || typeof container.getDropdownList !== 'function') {
      return false;
    }
    if (container[PATCH_MARK]) {
      return true;
    }

    const nativeGetDropdownList = container.getDropdownList;
    container.getDropdownList = async function (menuName, object) {
      const entryNow = safeGetEntry();
      const targetObject = resolveObject(entryNow, object);

      if (shouldUsePrivateVariableDropdown(entryNow, menuName, targetObject)) {
        return buildDropdownList(entryNow, menuName, targetObject);
      }

      return nativeGetDropdownList.apply(this, arguments);
    };
    container[PATCH_MARK] = true;
    return true;
  }

  function patchDynamicDropdown(entry) {
    const DynamicDropdown = entry?.FieldDropdownDynamic;
    const BaseDropdown = entry?.FieldDropdown;
    const proto = DynamicDropdown?.prototype;

    if (!proto || !BaseDropdown?.prototype?.getTextByValue) {
      return false;
    }
    if (proto[PATCH_MARK]) {
      return true;
    }

    const nativeGetTextByValue = proto.getTextByValue;
    proto.getTextByValue = function (value) {
      const menuName = this?._menuName;
      if (
        enabled &&
        (menuName === 'variables' || menuName === 'lists') &&
        typeof this._isBlockInBoardWhenFunctionEdit === 'function' &&
        this._isBlockInBoardWhenFunctionEdit()
      ) {
        return BaseDropdown.prototype.getTextByValue.call(this, value);
      }

      return nativeGetTextByValue.apply(this, arguments);
    };
    proto[PATCH_MARK] = true;
    return true;
  }

  function applyNow() {
    const entry = safeGetEntry();
    if (!entry) return false;

    const containerReady = patchContainer(entry);
    const dropdownReady = patchDynamicDropdown(entry);
    return !!(containerReady && dropdownReady);
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleApply(shouldRefresh) {
    clearRetry();
    retryUntil = Date.now() + RETRY_TIMEOUT;

    function tick() {
      retryTimer = null;
      const ready = applyNow();
      if (ready) {
        if (shouldRefresh) refreshVariableBlocks();
      } else if (Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function setEnabled(nextEnabled) {
    const changed = enabled !== !!nextEnabled;
    enabled = !!nextEnabled;
    scheduleApply(changed);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    const msg = event.data;

    switch (msg.type) {
      case 'SET_FUNCTION_PRIVATE_VARIABLES_ENABLED':
        setEnabled(!!(msg.payload && msg.payload.enabled));
        window.postMessage({
          channel: CHANNEL,
          type: 'FUNCTION_PRIVATE_VARIABLES_RESULT',
          payload: { success: true, enabled: enabled },
          requestId: msg.requestId
        }, window.location.origin);
        break;
    }
  });

  window.postMessage({
    channel: CHANNEL,
    type: 'FUNCTION_PRIVATE_VARIABLES_READY'
  }, window.location.origin);
})();
