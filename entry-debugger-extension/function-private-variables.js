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
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;

  let enabled = false;
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

  function getNoTargetLabel(entry) {
    try {
      if (Adapter && typeof Adapter.getLangBlock === 'function') {
        return Adapter.getLangBlock('no_target', '대상 없음');
      }
      return window.Lang?.Blocks?.no_target ||
        entry?.Lang?.Blocks?.no_target ||
        '대상 없음';
    } catch (e) {
      return '대상 없음';
    }
  }

  function resolveObject(entry, object) {
    if (!object) {
      return Adapter && typeof Adapter.getCurrentObject === 'function'
        ? Adapter.getCurrentObject()
        : entry?.playground?.object || null;
    }
    if (object.id) {
      return object;
    }
    try {
      if (Adapter && typeof Adapter.getObjectById === 'function') {
        return Adapter.getObjectById(object);
      }
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
    if (Adapter && typeof Adapter.getItemName === 'function') {
      return Adapter.getItemName(item);
    }
    try {
      if (typeof item.getName === 'function') return item.getName();
    } catch (e) {}
    return item?.name_ || item?.name || item?.id_ || item?.id || '';
  }

  function getItemId(item) {
    if (Adapter && typeof Adapter.getItemId === 'function') {
      return Adapter.getItemId(item);
    }
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
    if (Adapter && typeof Adapter.refreshBlockMenu === 'function') {
      Adapter.refreshBlockMenu('variable');
      try {
        Adapter.getEntry()?.getMainWS?.()?.overlayBoard?.reDraw?.();
      } catch (e) {}
      return;
    }

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

    const patched = Patches && typeof Patches.patchMethod === 'function'
      ? Patches.patchMethod(container, 'getDropdownList', 'function-private-variables', function (nativeGetDropdownList) {
        return async function (menuName, object) {
          const entryNow = safeGetEntry();
          const targetObject = resolveObject(entryNow, object);

          if (shouldUsePrivateVariableDropdown(entryNow, menuName, targetObject)) {
            return buildDropdownList(entryNow, menuName, targetObject);
          }

          return nativeGetDropdownList.apply(this, arguments);
        };
      })
      : false;
    container[PATCH_MARK] = patched;
    return patched;
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

    const patched = Patches && typeof Patches.patchMethod === 'function'
      ? Patches.patchMethod(proto, 'getTextByValue', 'function-private-variables', function (nativeGetTextByValue) {
        return function (value) {
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
      })
      : false;
    proto[PATCH_MARK] = patched;
    return patched;
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

  onMessage(function (msg) {
    switch (msg.type) {
      case 'SET_FUNCTION_PRIVATE_VARIABLES_ENABLED':
        setEnabled(!!(msg.payload && msg.payload.enabled));
        post('FUNCTION_PRIVATE_VARIABLES_RESULT', { success: true, enabled: enabled }, msg.requestId);
        break;
    }
  });

  post('FUNCTION_PRIVATE_VARIABLES_READY');
})();
