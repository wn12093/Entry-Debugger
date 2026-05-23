/**
 * function-usage-inspector.js - Main World function usage indexer
 *
 * Entry native property view only says "함수에 조립되어 있어요." when a
 * variable/list/message/function is used inside a function. This script keeps a
 * separate index for those internal function references and exposes it to the
 * content script through the Entry Debugger message channel.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_FUNCTION_USAGE_INSPECTOR__) return;
  window.__ENTRY_DEBUGGER_FUNCTION_USAGE_INSPECTOR__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const POLL_INTERVAL = 500;
  const NATIVE_SECTION_CLASS = 'ed-native-function-usage';
  const VARIABLE_BLOCK_TYPES = [
    'get_variable',
    'change_variable',
    'set_variable',
    'show_variable',
    'hide_variable',
    'value_of_index_from_list',
    'add_value_to_list',
    'remove_value_from_list',
    'insert_value_to_list',
    'change_value_list_index',
    'length_of_list',
    'is_included_in_list',
    'show_list',
    'hide_list',
  ];

  let pollingTimer = null;
  let prevSnapshotJSON = '';

  function safeGetEntry() {
    try {
      return window.Entry || null;
    } catch (e) {
      return null;
    }
  }

  function safeGetContainer() {
    const entry = safeGetEntry();
    return entry && entry.variableContainer ? entry.variableContainer : null;
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toObjectValues(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value)
      .map(function (key) { return value[key]; })
      .filter(Boolean);
  }

  function getId(item) {
    return item ? (item.id_ || item.id || '') : '';
  }

  function getName(item, fallback) {
    if (!item) return fallback || '(이름 없음)';
    return String(item.name_ || item.name || item.description || fallback || '(이름 없음)');
  }

  function getFunctionName(func) {
    if (!func) return '(함수 없음)';
    return String(func.description || func.name || ('함수 ' + (func.id || '')));
  }

  function getBlockType(block) {
    return block ? (block.type || (block.data && block.data.type) || '') : '';
  }

  function getBlockParams(block) {
    if (!block) return [];
    if (Array.isArray(block.params)) return block.params;
    if (block.data && Array.isArray(block.data.params)) return block.data.params;
    return [];
  }

  function stripText(value) {
    return String(value || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getBlockLabel(block, targetType, targetName) {
    const type = getBlockType(block);
    const langBlocks = window.Lang && window.Lang.Blocks;
    let label = '';

    if (targetType === 'message' && langBlocks) {
      label = langBlocks['START_' + type] || '';
    } else if ((targetType === 'variable' || targetType === 'list') && langBlocks) {
      label = langBlocks['VARIABLE_' + type] || '';
    }

    if (!label && targetType === 'function') {
      label = '함수 호출: ' + targetName;
    }

    return stripText(label) || type || '(블록 이름 없음)';
  }

  function makeTarget(type, id, name) {
    return {
      targetType: type,
      targetId: id,
      targetName: name,
      refs: [],
    };
  }

  function addKnownTargets(map, list, type) {
    toArray(list).forEach(function (item) {
      const id = getId(item);
      if (!id || map[id]) return;
      map[id] = makeTarget(type, id, getName(item));
    });
  }

  function addKnownFunctions(map, functions) {
    toObjectValues(functions).forEach(function (func) {
      const id = func.id;
      if (!id || map[id]) return;
      map[id] = makeTarget('function', id, getFunctionName(func));
    });
  }

  function getFunctionBlockList(func) {
    if (!func || !func.content) return [];
    if (typeof func.content.getBlockList === 'function') {
      try {
        return func.content.getBlockList(false) || [];
      } catch (e) {
        return [];
      }
    }

    if (func.content._blockMap) {
      return toObjectValues(func.content._blockMap);
    }

    return [];
  }

  function addRef(target, ownerFunc, block, blockIndex, paramIndexes) {
    target.refs.push({
      ownerFunctionId: ownerFunc.id || '',
      ownerFunctionName: getFunctionName(ownerFunc),
      ownerFunctionType: ownerFunc.type || 'normal',
      blockId: block.id || '',
      blockType: getBlockType(block),
      blockLabel: getBlockLabel(block, target.targetType, target.targetName),
      blockIndex: blockIndex,
      paramIndexes: paramIndexes,
    });
  }

  function collectRefsForBlock(targetsById, ownerFunc, block, blockIndex) {
    const type = getBlockType(block);
    const directMatches = {};

    getBlockParams(block).forEach(function (param, index) {
      if (typeof param !== 'string') return;
      const target = targetsById[param];
      if (!target) return;

      if (!directMatches[param]) {
        directMatches[param] = [];
      }
      directMatches[param].push(index);
    });

    Object.keys(directMatches).forEach(function (targetId) {
      const target = targetsById[targetId];
      const isKnownUsageType =
        target.targetType === 'function' ||
        VARIABLE_BLOCK_TYPES.indexOf(type) !== -1 ||
        type === 'when_message_cast' ||
        type === 'message_cast' ||
        type === 'message_cast_wait';

      if (isKnownUsageType) {
        addRef(target, ownerFunc, block, blockIndex, directMatches[targetId]);
      }
    });

    if (type.indexOf('func_') === 0) {
      const functionId = type.slice(5);
      const target = targetsById[functionId];
      if (target && target.targetType === 'function') {
        addRef(target, ownerFunc, block, blockIndex, []);
      }
    }
  }

  function buildFunctionUsageSnapshot() {
    const container = safeGetContainer();
    if (!container) {
      return {
        ready: false,
        items: [],
        totals: { targets: 0, refs: 0, functions: 0 },
      };
    }

    const targetsById = {};
    addKnownTargets(targetsById, container.variables_ || [], 'variable');
    addKnownTargets(targetsById, container.lists_ || [], 'list');
    addKnownTargets(targetsById, container.messages_ || [], 'message');
    addKnownFunctions(targetsById, container.functions_ || {});

    const functions = toObjectValues(container.functions_ || {});
    functions.forEach(function (func) {
      const blocks = getFunctionBlockList(func);
      let visibleBlockIndex = 0;

      blocks.forEach(function (block) {
        const type = getBlockType(block);
        if (!type) return;

        if (type !== 'function_create' && type !== 'function_create_value') {
          visibleBlockIndex += 1;
        }

        collectRefsForBlock(targetsById, func, block, visibleBlockIndex);
      });
    });

    const items = Object.keys(targetsById)
      .map(function (id) { return targetsById[id]; })
      .filter(function (item) { return item.refs.length > 0; })
      .sort(function (a, b) {
        const typeCompare = usageTypeOrder(a.targetType) - usageTypeOrder(b.targetType);
        if (typeCompare) return typeCompare;
        return a.targetName.localeCompare(b.targetName);
      });

    const refs = items.reduce(function (sum, item) {
      return sum + item.refs.length;
    }, 0);

    return {
      ready: true,
      items: items,
      totals: {
        targets: items.length,
        refs: refs,
        functions: functions.length,
      },
    };
  }

  function usageTypeOrder(type) {
    switch (type) {
      case 'variable': return 1;
      case 'list': return 2;
      case 'message': return 3;
      case 'function': return 4;
      default: return 9;
    }
  }

  function getSelectedAttributeTarget() {
    const container = safeGetContainer();
    if (!container || !container.selected) return null;

    const selected = container.selected;
    const id = getId(selected);
    let targetType = null;

    if (selected.type === 'list') {
      targetType = 'list';
    } else if (selected.type === 'variable' || selected.type === 'slide') {
      targetType = 'variable';
    } else if (id && toArray(container.messages_).some(function (message) {
      return message === selected || getId(message) === id;
    })) {
      targetType = 'message';
    } else if (id && container.functions_ && container.functions_[id] === selected) {
      targetType = 'function';
    }

    if (!targetType || !id) return null;

    return {
      targetType: targetType,
      targetId: id,
      targetName: getName(selected),
      listElement: selected.listElement || null,
    };
  }

  function getNativeListSelector(targetType) {
    switch (targetType) {
      case 'variable':
        return '.list.default_val, .list.cloud_variable, .list.real_time_variable, .list.local_val';
      case 'list':
        return '.list.default_list, .list.cloud_list, .list.real_time_list, .list.local_list';
      case 'message':
        return '.list.default_message';
      case 'function':
        return '.list.default_func';
      default:
        return '.list';
    }
  }

  function isInDocument(element) {
    return !!(element && document.documentElement && document.documentElement.contains(element));
  }

  function addUniqueElement(list, element) {
    if (!element || typeof element.querySelector !== 'function') return;
    if (!isInDocument(element)) return;
    if (list.indexOf(element) === -1) {
      list.push(element);
    }
  }

  function getNativeTargetListElements(target) {
    const elements = [];
    addUniqueElement(elements, target.listElement);

    const selector = getNativeListSelector(target.targetType)
      .split(',')
      .map(function (part) {
        return '.entryVariableListWorkspace ' + part.trim();
      })
      .join(', ');

    document.querySelectorAll(selector).forEach(function (element) {
      if (!element.classList.contains('unfold') && !element.classList.contains('selected')) {
        return;
      }
      addUniqueElement(elements, element);
    });

    return elements;
  }

  function findNativeUsageAnchor(listElement) {
    if (!listElement || typeof listElement.querySelector !== 'function') return null;

    const selectedBox = listElement.querySelector('.attr_inner_box') || listElement;
    return selectedBox.querySelector('.use_obj, .use_block') || selectedBox;
  }

  function clearNativeFunctionUsageSections() {
    const sections = document.querySelectorAll('.' + NATIVE_SECTION_CLASS);
    sections.forEach(function (section) {
      section.remove();
    });
  }

  function findUsageItem(snapshot, target) {
    if (!snapshot || !Array.isArray(snapshot.items) || !target) return null;
    return snapshot.items.find(function (item) {
      return item.targetType === target.targetType && item.targetId === target.targetId;
    }) || null;
  }

  function renderNativeFunctionUsage(snapshot) {
    const target = getSelectedAttributeTarget();
    clearNativeFunctionUsageSections();

    if (!target || !snapshot || !snapshot.ready) return;

    const item = findUsageItem(snapshot, target);
    if (!item || !item.refs.length) return;

    getNativeTargetListElements(target).forEach(function (listElement) {
      const anchor = findNativeUsageAnchor(listElement);
      if (!anchor) return;
      anchor.appendChild(createNativeFunctionUsageSection(item));
    });
  }

  function createNativeFunctionUsageSection(item) {
    const section = document.createElement('div');
    section.className = NATIVE_SECTION_CLASS;

    const title = document.createElement('span');
    title.className = 'box_sjt ed-native-function-usage-title';
    title.textContent = '함수에서 사용';
    section.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'obj_list ed-native-function-usage-list';
    section.appendChild(list);

    item.refs.forEach(function (ref) {
      list.appendChild(createNativeFunctionUsageItem(item, ref));
    });

    return section;
  }

  function createNativeFunctionUsageItem(item, ref) {
    const row = document.createElement('li');
    row.className = 'ed-native-function-usage-item';
    row.title = ref.ownerFunctionName + ' : ' + (ref.blockLabel || ref.blockType);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', row.title);

    const open = function (event) {
      event.preventDefault();
      event.stopPropagation();
      openFunctionUsage({
        targetType: item.targetType,
        targetId: item.targetId,
        ownerFunctionId: ref.ownerFunctionId,
        blockId: ref.blockId,
      }, null);
    };

    row.addEventListener('click', open);
    row.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        open(event);
      }
    });

    const thumb = document.createElement('span');
    thumb.className = 'thmb ed-native-function-usage-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    row.appendChild(thumb);

    const text = document.createElement('span');
    text.className = 'text ed-native-function-usage-text';
    text.textContent = ref.ownerFunctionName + ' : ' + (ref.blockLabel || ref.blockType);

    row.appendChild(text);
    return row;
  }

  function post(type, payload, requestId) {
    window.postMessage({
      channel: CHANNEL,
      type: type,
      payload: payload || null,
      requestId: requestId || null,
    }, window.location.origin);
  }

  function pollAndBroadcast(force) {
    const snapshot = buildFunctionUsageSnapshot();
    const json = JSON.stringify(snapshot);

    renderNativeFunctionUsage(snapshot);

    if (force || json !== prevSnapshotJSON) {
      prevSnapshotJSON = json;
      post('FUNCTION_USAGE_SNAPSHOT', snapshot);
    }
  }

  function startPolling() {
    if (pollingTimer) return;
    prevSnapshotJSON = '';
    pollingTimer = setInterval(function () {
      pollAndBroadcast(false);
    }, POLL_INTERVAL);
    pollAndBroadcast(true);
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    clearNativeFunctionUsageSections();
  }

  function openFunctionUsage(payload, requestId) {
    const entry = safeGetEntry();
    const container = safeGetContainer();

    if (!entry || !container) {
      post('FUNCTION_USAGE_OPEN_RESULT', {
        success: false,
        error: 'Entry를 찾을 수 없습니다.',
      }, requestId);
      return;
    }

    const ownerFunctionId = payload && payload.ownerFunctionId;
    const blockId = payload && payload.blockId;
    const func = container.functions_ && container.functions_[ownerFunctionId];

    if (!func) {
      post('FUNCTION_USAGE_OPEN_RESULT', {
        success: false,
        error: '함수를 찾을 수 없습니다: ' + ownerFunctionId,
      }, requestId);
      return;
    }

    try {
      if (typeof entry.do === 'function') {
        const command = entry.do('funcEditStart', ownerFunctionId);
        if (command && typeof command.isPass === 'function') {
          command.isPass(true);
        }
      } else if (entry.Func && typeof entry.Func.edit === 'function') {
        entry.Func.edit(ownerFunctionId);
      }
    } catch (e) {
      post('FUNCTION_USAGE_OPEN_RESULT', {
        success: false,
        error: e.message,
      }, requestId);
      return;
    }

    focusBlockWhenReady(func, blockId, 0, requestId);
  }

  function focusBlockWhenReady(func, blockId, attempt, requestId) {
    const entry = safeGetEntry();
    const workspace = entry && typeof entry.getMainWS === 'function' ? entry.getMainWS() : null;
    const block = func && func.content && typeof func.content.findById === 'function'
      ? func.content.findById(blockId)
      : null;
    const view = block && block.view;
    const board = view && typeof view.getBoard === 'function'
      ? view.getBoard()
      : workspace && workspace.overlayBoard;

    if (block && view && board) {
      try {
        if (typeof board.activateBlock === 'function') {
          board.activateBlock(block);
        }
        if (typeof board.setSelectedBlock === 'function') {
          board.setSelectedBlock(view);
        }
        post('FUNCTION_USAGE_OPEN_RESULT', { success: true }, requestId);
        return;
      } catch (e) {
        post('FUNCTION_USAGE_OPEN_RESULT', {
          success: false,
          error: e.message,
        }, requestId);
        return;
      }
    }

    if (attempt >= 12) {
      post('FUNCTION_USAGE_OPEN_RESULT', {
        success: !!block,
        error: block ? null : '대상 블록을 찾을 수 없습니다: ' + blockId,
      }, requestId);
      return;
    }

    setTimeout(function () {
      focusBlockWhenReady(func, blockId, attempt + 1, requestId);
    }, 120);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    const msg = event.data;

    switch (msg.type) {
      case 'START_FUNCTION_USAGE_POLLING':
        startPolling();
        break;

      case 'STOP_FUNCTION_USAGE_POLLING':
        stopPolling();
        break;

      case 'REQUEST_FUNCTION_USAGE':
        pollAndBroadcast(true);
        break;

      case 'OPEN_FUNCTION_USAGE':
        openFunctionUsage(msg.payload || {}, msg.requestId);
        break;
    }
  });

  post('FUNCTION_USAGE_INSPECTOR_READY');
})();
