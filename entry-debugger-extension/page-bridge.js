/**
 * page-bridge.js - Shared page-world message helpers.
 *
 * Page-world modules talk to the isolated content script through window.postMessage.
 * This bridge keeps the channel/origin checks and response shape in one place.
 */
(function () {
  'use strict';

  if (window.EntryDebuggerPageBridge) return;

  var CHANNEL = '__ENTRY_DEBUGGER__';

  function isValidEvent(event) {
    return !!(
      event &&
      event.origin === window.location.origin &&
      event.data &&
      event.data.channel === CHANNEL
    );
  }

  function post(type, payload, requestId) {
    window.postMessage({
      channel: CHANNEL,
      type: type,
      payload: payload || null,
      requestId: requestId || null
    }, window.location.origin);
  }

  function result(type, payload, requestId) {
    post(type, payload, requestId);
  }

  function ready(type, payload) {
    post(type, payload || null, null);
  }

  function onMessage(handler) {
    var listener = function (event) {
      if (!isValidEvent(event)) return;
      handler(event.data, event);
    };
    window.addEventListener('message', listener);
    return function () {
      window.removeEventListener('message', listener);
    };
  }

  window.EntryDebuggerPageBridge = Object.freeze({
    CHANNEL: CHANNEL,
    isValidEvent: isValidEvent,
    post: post,
    result: result,
    ready: ready,
    onMessage: onMessage
  });
})();
