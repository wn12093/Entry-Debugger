/**
 * boost-mode.js - Main World boost mode hook
 *
 * Boost mode must be applied before Entry.init calls GEHelper.INIT().
 * The setting is mirrored in localStorage so this script can read it at document_start.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_BOOST_MODE_INJECTED__) return;
  window.__ENTRY_DEBUGGER_BOOST_MODE_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const STORAGE_KEY = '__ENTRY_DEBUGGER_BOOST_MODE_ENABLED__';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;

  let enabled = readStoredEnabled();
  let entryValue = null;
  let entryHookInstalled = false;
  let retryTimer = null;
  let retryUntil = 0;

  function readStoredEnabled() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
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

  function writeStoredEnabled(nextEnabled) {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextEnabled ? '1' : '0');
    } catch (e) {}
  }

  function applyBoostOption(options) {
    options = options || {};
    if (enabled) {
      options.useWebGL = '1';
    }
    return options;
  }

  function markEntryOptions(entry) {
    if (!entry || !entry.options) return;

    if (enabled) {
      entry.options.useWebGL = '1';
      entry.__ENTRY_DEBUGGER_BOOST_FORCED__ = true;
    } else if (entry.__ENTRY_DEBUGGER_BOOST_FORCED__) {
      delete entry.options.useWebGL;
      entry.__ENTRY_DEBUGGER_BOOST_FORCED__ = false;
    }
  }

  function patchEntry(entry) {
    if (!entry || entry.__ENTRY_DEBUGGER_BOOST_PATCHED__) {
      markEntryOptions(entry);
      return !!(entry && entry.__ENTRY_DEBUGGER_BOOST_PATCHED__);
    }

    if (typeof entry.init !== 'function') {
      markEntryOptions(entry);
      return false;
    }

    var patched = false;
    if (Patches && typeof Patches.patchMethod === 'function') {
      patched = Patches.patchMethod(entry, 'init', 'boost-mode', function (originalInit) {
        return function (container, options) {
          options = applyBoostOption(options || {});
          var result = originalInit.call(this, container, options);
          markEntryOptions(this);
          return result;
        };
      });
    } else {
      var originalInit = entry.init;
      entry.init = function (container, options) {
        options = applyBoostOption(options || {});
        var result = originalInit.call(this, container, options);
        markEntryOptions(this);
        return result;
      };
      patched = true;
    }

    entry.__ENTRY_DEBUGGER_BOOST_PATCHED__ = patched;
    markEntryOptions(entry);
    return patched;
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
      var patched = patchEntry(entryValue || safeGetEntry());
      if (!patched && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function installEntryHook() {
    if (entryHookInstalled) return;
    entryHookInstalled = true;

    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(window, 'Entry');
    } catch (e) {
      descriptor = null;
    }

    if (descriptor && descriptor.configurable === false) {
      patchEntry(safeGetEntry());
      schedulePatchRetry();
      return;
    }

    if (descriptor && 'value' in descriptor && descriptor.value) {
      entryValue = descriptor.value;
      patchEntry(entryValue);
    } else if (safeGetEntry()) {
      entryValue = safeGetEntry();
      patchEntry(entryValue);
    }

    try {
      Object.defineProperty(window, 'Entry', {
        configurable: true,
        enumerable: true,
        get: function () {
          return entryValue;
        },
        set: function (value) {
          entryValue = value;
          patchEntry(entryValue);
        }
      });
    } catch (e) {
      patchEntry(safeGetEntry());
    }

    schedulePatchRetry();
  }

  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    writeStoredEnabled(enabled);
    patchEntry(entryValue || safeGetEntry());
    schedulePatchRetry();
  }

  onMessage(function (msg) {
    if (msg.type !== 'SET_BOOST_MODE_ENABLED') return;

    setEnabled(!!(msg.payload && msg.payload.enabled));
    post('BOOST_MODE_RESULT', { success: true, enabled: enabled }, msg.requestId);
  });

  installEntryHook();

  post('BOOST_MODE_READY', { enabled: enabled });
})();
