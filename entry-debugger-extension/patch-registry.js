/**
 * patch-registry.js - Shared method patch helpers.
 *
 * Stores original functions and prevents duplicate wrapping across SPA reloads.
 */
(function () {
  'use strict';

  if (window.EntryDebuggerPatchRegistry) return;

  var REGISTRY_KEY = '__entryDebuggerPatchRegistry';

  function getRegistry(owner) {
    if (!owner) return null;
    if (!owner[REGISTRY_KEY]) {
      try {
        Object.defineProperty(owner, REGISTRY_KEY, {
          configurable: true,
          enumerable: false,
          writable: true,
          value: {}
        });
      } catch (e) {
        owner[REGISTRY_KEY] = {};
      }
    }
    return owner[REGISTRY_KEY];
  }

  function patchMethod(owner, methodName, patchId, createWrapper) {
    if (!owner || typeof owner[methodName] !== 'function') return false;

    var registry = getRegistry(owner);
    if (!registry) return false;

    var key = patchId + ':' + methodName;
    if (registry[key]) return true;

    var nativeMethod = owner[methodName];
    var wrapped = createWrapper(nativeMethod);
    if (typeof wrapped !== 'function') return false;

    registry[key] = {
      methodName: methodName,
      nativeMethod: nativeMethod,
      wrapped: wrapped
    };
    owner[methodName] = wrapped;
    return true;
  }

  function getNative(owner, methodName, patchId) {
    var registry = owner && owner[REGISTRY_KEY];
    var entry = registry && registry[patchId + ':' + methodName];
    return entry ? entry.nativeMethod : null;
  }

  function hasPatch(owner, methodName, patchId) {
    var registry = owner && owner[REGISTRY_KEY];
    return !!(registry && registry[patchId + ':' + methodName]);
  }

  function createRetryController(apply, interval, timeout) {
    var timer = null;
    var retryUntil = 0;

    function clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function schedule(onReady) {
      clear();
      retryUntil = Date.now() + (timeout || 30000);

      function tick() {
        timer = null;
        var ready = !!apply();
        if (ready) {
          if (typeof onReady === 'function') onReady();
          return;
        }
        if (Date.now() < retryUntil) {
          timer = setTimeout(tick, interval || 300);
        }
      }

      tick();
    }

    return {
      clear: clear,
      schedule: schedule
    };
  }

  window.EntryDebuggerPatchRegistry = Object.freeze({
    patchMethod: patchMethod,
    getNative: getNative,
    hasPatch: hasPatch,
    createRetryController: createRetryController
  });
})();
