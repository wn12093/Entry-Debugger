/**
 * console-debugging.js - Main World console debugging feature
 *
 * Entry looks/dialog block definitions pass OPTION values through to Dialog/console.
 * This script exposes hidden yell mode and console log style modes in the dropdown.
 */
(function () {
  'use strict';

  if (window.__ENTRY_CONSOLE_DEBUGGING_INJECTED__) return;
  window.__ENTRY_CONSOLE_DEBUGGING_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const INJECTED_MARK = '__entryDebuggerConsoleDebuggingOption';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;

  const LOG_OPTIONS = [
    { label: '[LOG]', value: 'entryDebuggerLog' },
    { label: '[INFO]', value: 'ask ' },
    { label: '[WARN]', value: 'speak ' },
    { label: '[ERROR]', value: 'targetChecker fail simplebar-mask' },
    { label: '[DEBUG]', value: 'entryDimmed' }
  ];

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

  function getYellLabel() {
    try {
      if (window.Lang && window.Lang.Blocks && window.Lang.Blocks.yell) {
        return window.Lang.Blocks.yell;
      }
      var entry = safeGetEntry();
      if (entry && entry.Lang && entry.Lang.Blocks && entry.Lang.Blocks.yell) {
        return entry.Lang.Blocks.yell;
      }
    } catch (e) {}
    return '외치기';
  }

  function getExtraOptions() {
    return [{ label: getYellLabel(), value: 'yell' }].concat(LOG_OPTIONS);
  }

  function createMarkedOption(optionData) {
    var option = [optionData.label, optionData.value];
    option[INJECTED_MARK] = true;
    return option;
  }

  function hasOptionValue(options, value) {
    return Array.isArray(options) && options.some(function (option) {
      return Array.isArray(option) && option[1] === value;
    });
  }

  function addExtraOptions(options) {
    if (!Array.isArray(options)) return false;

    var changed = false;
    getExtraOptions().forEach(function (optionData) {
      if (!hasOptionValue(options, optionData.value)) {
        options.push(createMarkedOption(optionData));
        changed = true;
      }
    });

    return changed;
  }

  function removeInjectedExtraOptions(options) {
    if (!Array.isArray(options)) return false;

    var extraValues = getExtraOptions().map(function (optionData) {
      return optionData.value;
    });
    var changed = false;
    for (var i = options.length - 1; i >= 0; i--) {
      var option = options[i];
      if (
        Array.isArray(option) &&
        option[INJECTED_MARK] &&
        extraValues.indexOf(option[1]) !== -1
      ) {
        options.splice(i, 1);
        changed = true;
      }
    }
    return changed;
  }

  function patchOptions(options) {
    return enabled ? addExtraOptions(options) : removeInjectedExtraOptions(options);
  }

  function patchBlock(block, dropdownParamIndex) {
    if (!block) return false;

    var changed = false;
    if (block.params && block.params[dropdownParamIndex]) {
      changed = patchOptions(block.params[dropdownParamIndex].options) || changed;
    }

    var pySyntax = block.syntax && block.syntax.py;
    if (Array.isArray(pySyntax)) {
      pySyntax.forEach(function (syntax) {
        var textParams = syntax && syntax.textParams;
        if (textParams && textParams[2]) {
          changed = patchOptions(textParams[2].options) || changed;
        }
      });
    }

    return changed;
  }

  function patchEntryBlocks() {
    var entry = safeGetEntry();
    var block = entry && entry.block;
    if (!block) return { ready: false, changed: false };

    var dialogReady = !!(block.dialog && block.dialog.params);
    var dialogTimeReady = !!(block.dialog_time && block.dialog_time.params);
    if (!dialogReady && !dialogTimeReady) {
      return { ready: false, changed: false };
    }

    var changed = false;
    changed = patchBlock(block.dialog, 1) || changed;
    changed = patchBlock(block.dialog_time, 2) || changed;

    return { ready: true, changed: changed };
  }

  function refreshLooksBlocks() {
    var entry = safeGetEntry();
    if (!entry || !entry.playground) return;

    try {
      if (entry.playground.blockMenu && typeof entry.playground.blockMenu.deleteRendered === 'function') {
        entry.playground.blockMenu.deleteRendered('looks');
      }
    } catch (e) {}

    try {
      if (typeof entry.playground.reloadPlayground === 'function') {
        entry.playground.reloadPlayground();
      }
    } catch (e) {}
  }

  function applyNow() {
    var result = patchEntryBlocks();
    if (result.changed) {
      refreshLooksBlocks();
    }
    return result.ready;
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleApply() {
    clearRetry();
    retryUntil = Date.now() + RETRY_TIMEOUT;

    function tick() {
      retryTimer = null;
      var ready = applyNow();
      if (!ready && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    if (enabled) {
      scheduleApply();
    } else {
      clearRetry();
      applyNow();
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    var msg = event.data;

    switch (msg.type) {
      case 'SET_CONSOLE_DEBUGGING_ENABLED':
        setEnabled(!!(msg.payload && msg.payload.enabled));
        window.postMessage({
          channel: CHANNEL,
          type: 'CONSOLE_DEBUGGING_RESULT',
          payload: { success: true, enabled: enabled },
          requestId: msg.requestId
        }, window.location.origin);
        break;
    }
  });

  window.postMessage({
    channel: CHANNEL,
    type: 'CONSOLE_DEBUGGING_READY'
  }, window.location.origin);
})();
