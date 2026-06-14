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

  function getAllObjects() {
    var container = getContainer();
    if (!container) return [];
    if (typeof container.getAllObjects === 'function') {
      try {
        return container.getAllObjects() || [];
      } catch (e) {}
    }
    return container.objects_ || container.objects || [];
  }

  function getPictureListWidget() {
    var playground = getPlayground();
    return playground && playground.pictureSortableListWidget
      ? playground.pictureSortableListWidget
      : null;
  }

  function getPictureListItems(widget) {
    widget = widget || getPictureListWidget();
    return widget && widget._data && Array.isArray(widget._data.items)
      ? widget._data.items
      : null;
  }

  function setPictureListItems(widget, items, render) {
    if (!widget || !widget._data || !Array.isArray(items)) return false;
    if (render !== false && typeof widget.setData === 'function') {
      widget.setData(Object.assign({}, widget._data, { items: items }));
    } else {
      widget._data.items = items;
    }
    return true;
  }

  function doCommand() {
    var entry = getEntry();
    if (!entry || typeof entry.do !== 'function') {
      throw new Error('Entry command API is unavailable.');
    }
    return entry.do.apply(entry, arguments);
  }

  function getOrderedName(name, items) {
    var entry = getEntry();
    if (entry && typeof entry.getOrderedName === 'function') {
      return entry.getOrderedName(name, items || []);
    }
    return name;
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
    getAllObjects: getAllObjects,
    getPictureListWidget: getPictureListWidget,
    getPictureListItems: getPictureListItems,
    setPictureListItems: setPictureListItems,
    doCommand: doCommand,
    getOrderedName: getOrderedName,
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
