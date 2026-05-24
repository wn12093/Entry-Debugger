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
  const CONSOLE_MODE_CLASS_MAP = {
    '': '',
    entryDebuggerLog: '',
    'ask ': 'ask ',
    'speak ': 'speak ',
    'targetChecker fail simplebar-mask': 'targetChecker fail simplebar-mask',
    entryDimmed: 'entryDimmed'
  };
  const RUNTIME_PATCH_MARK = '__entryDebuggerConsoleDebuggingRuntimePatched';

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

  function isConsoleMode(mode) {
    return Object.prototype.hasOwnProperty.call(CONSOLE_MODE_CLASS_MAP, mode);
  }

  function formatDialogMessage(message) {
    var entry = safeGetEntry();

    if (message === '') {
      message = '    ';
    } else if (typeof message === 'boolean') {
      message = message ? 'True' : 'False';
    } else {
      message = '' + message;
    }

    try {
      if (entry && typeof entry.convertToRoundedDecimals === 'function') {
        return entry.convertToRoundedDecimals(message, 3);
      }
    } catch (e) {}

    return message;
  }

  function printConsoleMessage(message, mode) {
    var entry = safeGetEntry();
    var consoleClass = CONSOLE_MODE_CLASS_MAP[mode];

    if (!enabled) return;
    if (!entry || !entry.console || typeof entry.console.print !== 'function') return;

    entry.console.print(message, consoleClass);
  }

  function patchDialogRuntime(block) {
    if (!block || typeof block.func !== 'function' || block[RUNTIME_PATCH_MARK]) {
      return false;
    }

    var nativeFunc = block.func;
    block.func = function (sprite, script) {
      var mode = script.getField('OPTION', script);
      if (isConsoleMode(mode)) {
        var message = script.getValue('VALUE', script);
        printConsoleMessage(formatDialogMessage(message), mode);
        return script.callReturn();
      }

      return nativeFunc.apply(this, arguments);
    };
    block[RUNTIME_PATCH_MARK] = true;
    return true;
  }

  function patchDialogTimeRuntime(block) {
    if (!block || typeof block.func !== 'function' || block[RUNTIME_PATCH_MARK]) {
      return false;
    }

    var nativeFunc = block.func;
    block.func = function (sprite, script) {
      var mode = script.getField('OPTION', script);
      if (!isConsoleMode(mode)) {
        return nativeFunc.apply(this, arguments);
      }

      if (!script.isStart) {
        var entry = safeGetEntry();
        var values = script.getValues(['SECOND', 'VALUE'], script);
        var timeValue = Number(values[0]);
        var message = formatDialogMessage(values[1]);
        var timeoutId = 0;

        script.isStart = true;
        script.timeFlag = 1;
        printConsoleMessage(message, mode);

        var stopConsoleWait = function () {
          script.timeFlag = 0;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = 0;
          }
        };

        script.__entryDebuggerConsoleStop = stopConsoleWait;
        try {
          if (entry && entry.engine && typeof entry.engine.setTimeout === 'function') {
            timeoutId = entry.engine.setTimeout(stopConsoleWait, timeValue * 1000);
          } else {
            timeoutId = setTimeout(stopConsoleWait, timeValue * 1000);
          }
        } catch (e) {
          stopConsoleWait();
        }
      }

      if (script.timeFlag == 0) {
        delete script.timeFlag;
        delete script.isStart;
        delete script.__entryDebuggerConsoleStop;
        return script.callReturn();
      }

      return script;
    };
    block[RUNTIME_PATCH_MARK] = true;
    return true;
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
    patchDialogRuntime(block.dialog);
    patchDialogTimeRuntime(block.dialog_time);
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
