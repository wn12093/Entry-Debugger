/**
 * entry-adapter.js - Shared Entry access helpers.
 *
 * Keep direct Entry internals behind this adapter so Entry updates can be handled
 * from a smaller surface area.
 */
(function () {
  'use strict';

  if (window.EntryDebuggerEntryAdapter) return;

  function getEntry() {
    try {
      return window.Entry || null;
    } catch (e) {
      return null;
    }
  }

  function getVariableContainer() {
    var entry = getEntry();
    return entry && entry.variableContainer ? entry.variableContainer : null;
  }

  function getContainer() {
    var entry = getEntry();
    return entry && entry.container ? entry.container : null;
  }

  function getPlayground() {
    var entry = getEntry();
    return entry && entry.playground ? entry.playground : null;
  }

  function getEngine() {
    var entry = getEntry();
    return entry && entry.engine ? entry.engine : null;
  }

  function getObjectById(objectId) {
    var entry = getEntry();
    if (!entry || !objectId) return null;

    if (entry.container && typeof entry.container.getObject === 'function') {
      try {
        var found = entry.container.getObject(objectId);
        if (found) return found;
      } catch (e) {}
    }

    var objects = entry.container && (entry.container.objects_ || entry.container.objects);
    if (Array.isArray(objects)) {
      return objects.find(function (obj) {
        return obj && (obj.id === objectId || obj.id_ === objectId);
      }) || null;
    }

    return null;
  }

  function getCurrentObject() {
    var entry = getEntry();
    if (!entry) return null;

    var playground = getPlayground();
    if (playground && playground.object) {
      return playground.object;
    }

    if (entry.container && typeof entry.container.getCurrentObject === 'function') {
      try {
        return entry.container.getCurrentObject() || null;
      } catch (e) {}
    }

    return null;
  }

  function readObjectName(object, fallbackName) {
    if (!object) return fallbackName || '(오브젝트 없음)';
    if (typeof object.getName === 'function') {
      try {
        return object.getName() || fallbackName || '(오브젝트 없음)';
      } catch (e) {}
    }
    return object.name || object.name_ || object.objectName || fallbackName || '(오브젝트 없음)';
  }

  function getItemName(item, fallbackName) {
    if (!item) return fallbackName || '';
    if (typeof item.getName === 'function') {
      try {
        return item.getName() || fallbackName || '';
      } catch (e) {}
    }
    return item.name_ || item.name || item.id_ || item.id || fallbackName || '';
  }

  function getItemId(item) {
    if (!item) return '';
    if (typeof item.getId === 'function') {
      try {
        return item.getId() || '';
      } catch (e) {}
    }
    return item.id_ || item.id || '';
  }

  function getLangBlock(key, fallback) {
    try {
      return (window.Lang && window.Lang.Blocks && window.Lang.Blocks[key]) ||
        (getEntry() && getEntry().Lang && getEntry().Lang.Blocks && getEntry().Lang.Blocks[key]) ||
        fallback;
    } catch (e) {
      return fallback;
    }
  }

  function refreshBlockMenu(category) {
    var playground = getPlayground();
    try {
      if (playground && playground.blockMenu && typeof playground.blockMenu.deleteRendered === 'function') {
        playground.blockMenu.deleteRendered(category);
      }
    } catch (e) {}

    try {
      if (playground && typeof playground.reloadPlayground === 'function') {
        playground.reloadPlayground();
      }
    } catch (e) {}
  }

  function isFunctionEdit() {
    var entry = getEntry();
    return !!(entry && entry.Func && entry.Func.isEdit);
  }

  window.EntryDebuggerEntryAdapter = Object.freeze({
    getEntry: getEntry,
    getVariableContainer: getVariableContainer,
    getContainer: getContainer,
    getPlayground: getPlayground,
    getEngine: getEngine,
    getObjectById: getObjectById,
    getCurrentObject: getCurrentObject,
    readObjectName: readObjectName,
    getItemName: getItemName,
    getItemId: getItemId,
    getLangBlock: getLangBlock,
    refreshBlockMenu: refreshBlockMenu,
    isFunctionEdit: isFunctionEdit
  });
})();
