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

    var originalInit = entry.init;
    entry.init = function (container, options) {
      options = applyBoostOption(options || {});
      var result = originalInit.call(this, container, options);
      markEntryOptions(this);
      return result;
    };

    entry.__ENTRY_DEBUGGER_BOOST_PATCHED__ = true;
    markEntryOptions(entry);
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
      var patched = patchEntry(entryValue || window.Entry);
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
      patchEntry(window.Entry);
      schedulePatchRetry();
      return;
    }

    if (descriptor && 'value' in descriptor && descriptor.value) {
      entryValue = descriptor.value;
      patchEntry(entryValue);
    } else if (window.Entry) {
      entryValue = window.Entry;
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
      patchEntry(window.Entry);
    }

    schedulePatchRetry();
  }

  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    writeStoredEnabled(enabled);
    patchEntry(entryValue || window.Entry);
    schedulePatchRetry();
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    var msg = event.data;
    if (msg.type !== 'SET_BOOST_MODE_ENABLED') return;

    setEnabled(!!(msg.payload && msg.payload.enabled));
    window.postMessage({
      channel: CHANNEL,
      type: 'BOOST_MODE_RESULT',
      payload: { success: true, enabled: enabled },
      requestId: msg.requestId
    }, window.location.origin);
  });

  installEntryHook();

  window.postMessage({
    channel: CHANNEL,
    type: 'BOOST_MODE_READY',
    payload: { enabled: enabled }
  }, window.location.origin);
})();
