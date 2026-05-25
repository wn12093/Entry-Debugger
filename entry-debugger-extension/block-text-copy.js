/**
 * block-text-copy.js - Adds "텍스트로 복사하기" to Entry block context menus.
 *
 * This is an experimental, UI-only feature. It does not modify Entry project JSON.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_BLOCK_TEXT_COPY_INJECTED__) return;
  window.__ENTRY_DEBUGGER_BLOCK_TEXT_COPY_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;
  const MENU_TEXT = '텍스트로 복사하기';
  const ALL_CODE_MENU_TEXT = '모든 코드 텍스트로 복사하기';
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;

  let enabled = false;
  let activeBlockView = null;
  let activeBoard = null;
  let activeUntil = 0;
  let retryTimer = null;
  let retryUntil = 0;
  let renderContextObject = null;

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
      var patched = patchEntry(safeGetEntry());
      if (!patched && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function patchEntry(entry) {
    if (!entry || !entry.BlockView || !entry.ContextMenu) return false;

    var blockViewProto = entry.BlockView && entry.BlockView.prototype;
    var boardProto = entry.Board && entry.Board.prototype;
    var contextMenu = entry.ContextMenu;
    var blockPatched = patchMethod(blockViewProto, '_rightClick', 'block-text-copy', function (originalRightClick) {
      return function () {
        activeBlockView = this;
        activeUntil = Date.now() + 1000;

        try {
          return originalRightClick.apply(this, arguments);
        } finally {
          var blockView = this;
          setTimeout(function () {
            if (activeBlockView === blockView) {
              activeBlockView = null;
            }
          }, 0);
        }
      };
    });

    var boardPatched = !boardProto || patchMethod(boardProto, '_rightClick', 'block-text-copy-board', function (originalRightClick) {
      return function () {
        activeBoard = this;
        activeUntil = Date.now() + 1000;

        try {
          return originalRightClick.apply(this, arguments);
        } finally {
          var board = this;
          setTimeout(function () {
            if (activeBoard === board) {
              activeBoard = null;
            }
          }, 0);
        }
      };
    });

    var menuPatched = patchMethod(contextMenu, 'show', 'block-text-copy', function (originalShow) {
      return function (options, className, coordinate) {
        var blockView = activeBlockView && Date.now() <= activeUntil ? activeBlockView : null;
        var board = activeBoard && Date.now() <= activeUntil ? activeBoard : null;
        activeBlockView = null;
        activeBoard = null;

        if (enabled && shouldAddMenu(options, blockView)) {
          options = options.slice();
          options.push(createCopyTextOption(blockView));
        } else if (enabled && shouldAddAllCodeMenu(options, board, blockView)) {
          options = options.slice();
          options.push(createCopyAllCodeOption(board));
        }

        return originalShow.call(this, options, className, coordinate);
      };
    });

    return !!(blockPatched && boardPatched && menuPatched);
  }

  function patchMethod(owner, methodName, patchId, createWrapper) {
    if (Patches && typeof Patches.patchMethod === 'function') {
      return Patches.patchMethod(owner, methodName, patchId, createWrapper);
    }

    if (!owner || typeof owner[methodName] !== 'function') return false;
    var mark = '__entryDebugger_' + patchId.replace(/[^a-z0-9]/gi, '_') + '_' + methodName;
    if (owner[mark]) return true;
    owner[methodName] = createWrapper(owner[methodName]);
    owner[mark] = true;
    return true;
  }

  function shouldAddMenu(options, blockView) {
    return !!(
      Array.isArray(options) &&
      blockView &&
      blockView.block &&
      !blockView.isInBlockMenu &&
      !options.some(function (option) { return option && option.text === MENU_TEXT; })
    );
  }

  function shouldAddAllCodeMenu(options, board, blockView) {
    return !!(
      Array.isArray(options) &&
      board &&
      !blockView &&
      !options.some(function (option) { return option && option.text === ALL_CODE_MENU_TEXT; })
    );
  }

  function createCopyTextOption(blockView) {
    return {
      text: MENU_TEXT,
      enable: true,
      callback: function () {
        var text;
        try {
          text = buildBlockStackText(blockView);
        } catch (e) {
          console.error('[Entry Debugger] Failed to build block text.', e);
          showToast('텍스트 생성에 실패했습니다.', 'error');
          return;
        }
        copyText(text)
          .then(function () {
            showToast('복사되었습니다.');
          })
          .catch(function () {
            showToast('텍스트 복사에 실패했습니다.', 'error');
          });
      }
    };
  }

  function createCopyAllCodeOption(board) {
    return {
      text: ALL_CODE_MENU_TEXT,
      enable: true,
      callback: function () {
        var text;
        try {
          text = buildObjectCodeText(board);
        } catch (e) {
          console.error('[Entry Debugger] Failed to build object code text.', e);
          showToast('텍스트 생성에 실패했습니다.', 'error');
          return;
        }
        copyText(text)
          .then(function () {
            showToast('복사되었습니다.');
          })
          .catch(function () {
            showToast('텍스트 복사에 실패했습니다.', 'error');
          });
      }
    };
  }

  function buildBlockStackText(blockView) {
    var block = blockView && blockView.block;
    return withRenderContext(getBlockObject(block), function () {
      return buildBlockChainText(block);
    });
  }

  function buildBlockChainText(block) {
    var lines = [];
    var visited = [];

    while (block && visited.indexOf(block) < 0) {
      visited.push(block);
      lines = lines.concat(renderBlock(block, 0, false));
      block = typeof block.getNextBlock === 'function' ? block.getNextBlock() : null;
    }

    return lines.join('\n').trim() || '(비어 있는 블록)';
  }

  function buildObjectCodeText(board) {
    var object = getBoardObject(board) || getCurrentObject();
    var objectName = readObjectDisplayName(object);
    var code = board && board.code || object && object.script || null;
    var body = withRenderContext(object, function () {
      var threads = getCodeThreads(code);
      var threadTexts = threads
        .map(buildThreadText)
        .filter(function (text) { return !!text; });
      return threadTexts.length ? threadTexts.join('\n\n') : '(코드 없음)';
    });

    return '# ' + objectName + ' 오브젝트의 코드\n\n' + body;
  }

  function withRenderContext(object, callback) {
    var prevObject = renderContextObject;
    renderContextObject = object || renderContextObject || getCurrentObject();
    try {
      return callback();
    } finally {
      renderContextObject = prevObject;
    }
  }

  function getBlockObject(block) {
    try {
      var code = block && typeof block.getCode === 'function' && block.getCode();
      if (code && code.object) return code.object;
    } catch (e) {}

    try {
      var thread = block && typeof block.getThread === 'function' && block.getThread();
      var threadCode = thread && typeof thread.getCode === 'function' && thread.getCode();
      if (threadCode && threadCode.object) return threadCode.object;
    } catch (e) {}

    return getCurrentObject();
  }

  function buildThreadText(thread) {
    var firstBlock = getFirstCodeBlock(thread);
    if (!firstBlock) return '';
    return buildBlockChainText(firstBlock);
  }

  function getFirstCodeBlock(thread) {
    if (!thread) return null;

    if (typeof thread.getFirstBlock === 'function') {
      try {
        var firstBlock = thread.getFirstBlock();
        if (isEntryBlock(firstBlock)) return firstBlock;
      } catch (e) {}
    }

    var blocks = getThreadBlocks(thread);
    for (var i = 0; i < blocks.length; i++) {
      if (isEntryBlock(blocks[i])) return blocks[i];
    }

    return null;
  }

  function getCodeThreads(code) {
    if (!code) return [];
    if (typeof code.getThreads === 'function') {
      try {
        return code.getThreads() || [];
      } catch (e) {
        return [];
      }
    }
    return Array.isArray(code) ? code : [];
  }

  function getBoardObject(board) {
    if (board && board.code && board.code.object) return board.code.object;
    var workspace = board && board.workspace;
    if (workspace && workspace.object) return workspace.object;
    return null;
  }

  function readObjectDisplayName(object) {
    if (Adapter && typeof Adapter.readObjectName === 'function') {
      return Adapter.readObjectName(object, '오브젝트');
    }

    if (!object) return '오브젝트';
    try {
      if (typeof object.getName === 'function') return object.getName() || '오브젝트';
    } catch (e) {}
    return object.name || object.name_ || object.objectName || '오브젝트';
  }

  function renderBlock(block, depth, inline) {
    if (!block) return [''];

    var specialText = renderSpecialValueBlock(block);
    if (specialText != null) {
      return [specialText];
    }

    if (isFieldBlock(block)) {
      return [renderFieldBlock(block)];
    }

    var line = renderBlockLine(block, inline);
    var lines = [indent(depth) + line];
    var statements = Array.isArray(block.statements) ? block.statements : [];

    statements.forEach(function (statement) {
      var blocks = getThreadBlocks(statement);
      if (!blocks.length) return;
      blocks.forEach(function (childBlock) {
        lines = lines.concat(renderBlock(childBlock, depth + 1, false));
      });
    });

    if (inline) {
      return [lines.map(function (item) { return item.trim(); }).join(' ')];
    }
    return lines;
  }

  function renderSpecialValueBlock(block) {
    var type = block && block.type;
    var params = Array.isArray(block && block.params) ? block.params : [];
    var firstValue = firstPrimitive(
      params.length ? params[0] : null,
      block && block.id,
      block && block.id_,
      block && block.value
    );
    if (firstValue == null) firstValue = '';

    if (type === 'get_sounds') {
      return resolveObjectAssetName('sounds', firstValue) || normalizeVisualText(firstValue);
    }

    if (type === 'get_pictures') {
      return resolveObjectAssetName('pictures', firstValue) || normalizeVisualText(firstValue);
    }

    if (type === 'get_variable') {
      var variableName = resolveDynamicName('variables', firstValue) || normalizeVisualText(firstValue);
      return variableName ? variableName + ' 값' : normalizeVisualText(firstValue);
    }

    if (type === 'text' || type === 'number' || type === 'angle' || type === 'boolean') {
      return normalizeVisualText(firstValue);
    }

    return null;
  }

  function renderBlockLine(block, inline) {
    var contentText = renderBlockLineFromContents(block, inline);
    if (contentText) return contentText;

    var visualText = extractBlockVisualText(block);
    if (visualText) return visualText;

    return renderBlockLineFromTemplate(block, inline);
  }

  function renderBlockLineFromContents(block, inline) {
    var contents = block && block.view && block.view._contents;
    if (!Array.isArray(contents) || !contents.length) return '';

    var parts = [];
    var params = getSchemaParams(block);
    contents.forEach(function (content, contentIndex) {
      if (!content || isLineBreakContent(content)) return;

      if (isStaticTextContent(content)) {
        parts.push(readContentText(content));
        return;
      }

      var paramIndex = getContentParamIndex(content, contentIndex);
      var paramDef = params[paramIndex];
      var valueBlock = getContentValueBlock(content);
      var text = valueBlock ? renderBlock(valueBlock, 0, true)[0] : readContentText(content);
      if (!text) return;
      if (!valueBlock) {
        text = renderParam(text, paramDef, block, paramIndex) || text;
      }
      if (text === '[object Object]') return;

      parts.push(shouldWrapParam(inline, valueBlock) ? wrapParamText(text) : text);
    });

    return normalizeVisualText(parts.join(' '));
  }

  function renderBlockLineFromTemplate(block, inline) {
    var template = getTemplate(block);
    var params = getSchemaParams(block);
    var values = Array.isArray(block.params) ? block.params : [];

    if (!template) {
      return normalizeText(block.type || '(알 수 없는 블록)');
    }

    var text = String(template);
    values.forEach(function (value, index) {
      var paramText = renderParam(value, params[index], block, index);
      if (shouldWrapParam(inline, value)) {
        paramText = wrapParamText(paramText);
      }
      text = text.replace(new RegExp('%' + (index + 1), 'g'), paramText);
    });

    text = text.replace(/%\d+/g, '');
    return normalizeText(text) || normalizeText(block.type || '(알 수 없는 블록)');
  }

  function isLineBreakContent(content) {
    var name = content && content.constructor && content.constructor.name;
    return name === 'FieldLineBreak';
  }

  function isStaticTextContent(content) {
    return !!(
      content &&
      typeof content._text === 'string' &&
      content._content === undefined &&
      !getContentValueBlock(content)
    );
  }

  function getContentValueBlock(content) {
    var valueBlock = getNestedBlockFromObjectParam(content);

    if (!valueBlock && content && typeof content.getValueBlock === 'function') {
      try {
        valueBlock = content.getValueBlock();
      } catch (e) {
        valueBlock = null;
      }
    }

    if (!valueBlock && content && typeof content.getValue === 'function') {
      try {
        var value = content.getValue();
        if (isEntryBlock(value)) valueBlock = value;
      } catch (e) {
        valueBlock = null;
      }
    }

    return isEntryBlock(valueBlock) ? valueBlock : null;
  }

  function getContentParamIndex(content, fallback) {
    var candidates = [content && content._index, content && content.index, content && content._paramIndex];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === 'number' && candidates[i] >= 0) return candidates[i];
    }
    return fallback;
  }

  function readContentText(content) {
    var text = '';

    if (content && content.textElement) {
      text = content.textElement.textContent;
    }

    if (!text && content && content.svgGroup) {
      var root = getSvgNode(content.svgGroup);
      text = root && root.textContent;
    }

    if (!text) {
      text = readOptionLabelFromContent(content);
    }

    if (content && typeof content.getTextValue === 'function') {
      try {
        var textValue = content.getTextValue();
        if (!text && isEntryBlock(textValue)) {
          text = renderBlock(textValue, 0, true)[0];
        } else if (!text && textValue != null && typeof textValue !== 'object') {
          text = textValue;
        }
      } catch (e) {
        text = text || '';
      }
    }

    return normalizeVisualText(text);
  }

  function readOptionLabelFromContent(content) {
    var options = content && content._contents && content._contents.options;
    if (!Array.isArray(options) || !options.length) return '';

    var value = null;
    if (typeof content.getValue === 'function') {
      try {
        value = content.getValue();
      } catch (e) {
        value = null;
      }
    } else if ('value' in content) {
      value = content.value;
    }

    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      if (!Array.isArray(option)) continue;
      if (String(option[1]) === String(value)) {
        return normalizeVisualText(option[0]);
      }
    }

    return '';
  }

  function shouldWrapParam(inline, value) {
    if (!inline) return true;
    return isCompoundInlineBlock(value);
  }

  function isCompoundInlineBlock(value) {
    if (!isEntryBlock(value)) return false;

    var template = getTemplate(value) || '';
    if (/[+\-*/×÷=<>]/.test(template)) return true;
    if (/\b(?:and|or)\b/i.test(template)) return true;
    if (/(그리고|또는|이상|이하|초과|미만|같|크|작)/.test(template)) return true;

    var type = value.type || '';
    return /(?:calc|operator|boolean|compare|arithmetic|coordinate_.*(?:plus|minus)|_plus|_minus|_multi|_divide)/i.test(type);
  }

  function wrapParamText(text) {
    text = normalizeVisualText(text);
    return text ? '(' + text + ')' : '';
  }

  function extractBlockVisualText(block) {
    var view = block && block.view;
    var root = getSvgNode(view && (view.contentSvgGroup || view.svgGroup));
    if (!root || typeof root.querySelectorAll !== 'function') return '';

    var texts = Array.prototype.slice.call(root.querySelectorAll('text'))
      .map(readSvgText)
      .filter(function (item) {
        return item && item.text && item.text !== '?' && item.text !== '？';
      });

    if (!texts.length) return '';

    texts.sort(compareSvgTextPosition);
    return normalizeVisualText(texts.map(function (item) { return item.text; }).join(' '));
  }

  function getSvgNode(group) {
    if (!group) return null;
    if (typeof group.querySelectorAll === 'function') return group;
    if (group.node && typeof group.node.querySelectorAll === 'function') return group.node;
    if (group[0] && typeof group[0].querySelectorAll === 'function') return group[0];
    if (group.elem && typeof group.elem.querySelectorAll === 'function') return group.elem;
    return null;
  }

  function readSvgText(element) {
    var text = normalizeText(element && element.textContent);
    if (!text) return null;

    var position = getSvgTextPosition(element);
    return {
      text: text,
      x: position.x,
      y: position.y,
      index: getDomIndex(element)
    };
  }

  function getSvgTextPosition(element) {
    try {
      if (element && typeof element.getBoundingClientRect === 'function') {
        var rect = element.getBoundingClientRect();
        if (rect && (rect.left || rect.top || rect.width || rect.height)) {
          return { x: rect.left, y: rect.top };
        }
      }
    } catch (e) {}

    var x = readNumberAttribute(element, 'x');
    var y = readNumberAttribute(element, 'y');
    var transform = readTranslate(element);
    return { x: x + transform.x, y: y + transform.y };
  }

  function readNumberAttribute(element, name) {
    try {
      var value = element && element.getAttribute && element.getAttribute(name);
      var parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (e) {
      return 0;
    }
  }

  function readTranslate(element) {
    var x = 0;
    var y = 0;
    var node = element;

    while (node && node.nodeType === 1) {
      try {
        var transform = node.getAttribute && node.getAttribute('transform');
        var match = transform && /translate\(\s*([-0-9.]+)(?:[,\s]+([-0-9.]+))?/.exec(transform);
        if (match) {
          x += parseFloat(match[1]) || 0;
          y += parseFloat(match[2]) || 0;
        }
      } catch (e) {}
      node = node.parentNode;
    }

    return { x: x, y: y };
  }

  function getDomIndex(element) {
    var index = 0;
    var node = element;
    while (node && node.previousSibling) {
      node = node.previousSibling;
      index++;
    }
    return index;
  }

  function compareSvgTextPosition(a, b) {
    var yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 20) return yDiff;
    var xDiff = a.x - b.x;
    if (Math.abs(xDiff) > 1) return xDiff;
    return a.index - b.index;
  }

  function getTemplate(block) {
    try {
      if (block.view && typeof block.view._getTemplate === 'function') {
        return block.view._getTemplate();
      }
    } catch (e) {}

    var schema = getBlockSchema(block);
    return schema && (schema.template || getLangTemplate(block.type));
  }

  function getSchemaParams(block) {
    try {
      if (block.view && typeof block.view._getSchemaParams === 'function') {
        return block.view._getSchemaParams() || [];
      }
    } catch (e) {}

    var schema = getBlockSchema(block);
    return schema && schema.params || [];
  }

  function getBlockSchema(block) {
    if (!block) return null;
    if (block._schema) return block._schema;
    var entry = safeGetEntry();
    return entry && entry.block && entry.block[block.type] || null;
  }

  function getLangTemplate(type) {
    try {
      return window.Lang && window.Lang.template && window.Lang.template[type];
    } catch (e) {
      return '';
    }
  }

  function renderParam(value, paramDef, ownerBlock, paramIndex) {
    if (value == null) return '';

    if (isEntryBlock(value)) {
      return renderBlock(value, 0, true)[0];
    }

    if (Array.isArray(value)) {
      return value.map(function (item) {
        return renderParam(item, paramDef, ownerBlock, paramIndex);
      }).join(', ');
    }

    if (typeof value === 'object') {
      var objectText = renderObjectParam(value, paramDef, ownerBlock, paramIndex);
      if (objectText) return objectText;
      return '';
    }

    var raw = String(value);
    var optionLabel = findOptionLabel(paramDef, raw);
    if (optionLabel) return optionLabel;

    var menuName = inferParamMenuName(ownerBlock, paramIndex, paramDef);
    if (menuName) {
      return resolveDynamicName(menuName, raw) || raw;
    }

    return raw;
  }

  function renderObjectParam(value, paramDef, ownerBlock, paramIndex) {
    if (!value) return '';

    if (isEntryBlock(value)) {
      return renderBlock(value, 0, true)[0];
    }

    var nestedBlock = getNestedBlockFromObjectParam(value);
    if (nestedBlock) {
      return renderBlock(nestedBlock, 0, true)[0];
    }

    var candidate = firstPrimitive(value.value, value.text, value.name, value.id, value.data);
    if (candidate != null) {
      return renderParam(candidate, paramDef, ownerBlock, paramIndex);
    }

    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      var text = normalizeText(value.toString());
      return text === '[object Object]' ? '' : text;
    }

    return '';
  }

  function getNestedBlockFromObjectParam(value) {
    var direct = value && (
      value.block ||
      value.valueBlock ||
      value._valueBlock ||
      value.value ||
      value._value ||
      value.data ||
      value._data
    );
    if (isEntryBlock(direct)) return direct;

    if (value && typeof value.getValueBlock === 'function') {
      try {
        var valueBlock = value.getValueBlock();
        if (isEntryBlock(valueBlock)) return valueBlock;
      } catch (e) {}
    }

    if (value && typeof value.getValue === 'function') {
      try {
        var innerValue = value.getValue();
        if (isEntryBlock(innerValue)) return innerValue;
      } catch (e) {}
    }

    return null;
  }

  function firstPrimitive() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value == null) continue;
      if (typeof value !== 'object' && typeof value !== 'function') return value;
    }
    return null;
  }

  function findOptionLabel(paramDef, value) {
    var options = paramDef && paramDef.options;
    if (typeof options === 'function') {
      try {
        options = options();
      } catch (e) {
        options = null;
      }
    }
    if (!Array.isArray(options)) return '';

    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      if (!Array.isArray(option)) continue;
      if (String(option[1]) === String(value)) {
        return normalizeText(option[0]);
      }
    }
    return '';
  }

  function inferParamMenuName(block, index, paramDef) {
    var directMenuName = normalizeMenuName(paramDef && paramDef.menuName, block);
    if (directMenuName) return directMenuName;

    var schema = getBlockSchema(block) || {};
    var keyMap = schema.paramsKeyMap || {};
    if (keyMap.VARIABLE === index) return 'variables';
    if (keyMap.LIST === index) return 'lists';
    if (keyMap.MESSAGE === index || keyMap.VALUE === index && isMessageBlockType(block && block.type)) {
      return 'messages';
    }

    var type = block && block.type || '';
    var known = {
      'get_variable:0': 'variables',
      'set_variable:0': 'variables',
      'change_variable:0': 'variables',
      'show_variable:0': 'variables',
      'hide_variable:0': 'variables',
      'get_sounds:0': 'sounds',
      'sound_something_with_block:0': 'sounds',
      'sound_something_second_with_block:0': 'sounds',
      'sound_from_to:0': 'sounds',
      'sound_something_wait_with_block:0': 'sounds',
      'sound_something_second_wait_with_block:0': 'sounds',
      'sound_from_to_and_wait:0': 'sounds',
      'get_pictures:0': 'pictures',
      'change_to_some_shape:0': 'pictures'
    };

    return known[type + ':' + index] || '';
  }

  function normalizeMenuName(menuName, block) {
    if (typeof menuName === 'string') return menuName;
    if (typeof menuName === 'function') {
      try {
        var generated = menuName(block);
        return typeof generated === 'string' ? generated : '';
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function isMessageBlockType(type) {
    return /message|signal|cast/.test(String(type || ''));
  }

  function resolveDynamicName(menuName, id) {
    var entry = safeGetEntry();
    if (!entry) return '';
    var vc = entry.variableContainer || {};

    var item = null;
    try {
      if (menuName === 'variables') {
        if (typeof vc.getVariable === 'function') {
          item = vc.getVariable(id, renderContextObject || entry.playground && entry.playground.object);
        }
        if (!item) item = findById(vc.variables_ || [], id);
      } else if (menuName === 'lists') {
        if (typeof vc.getList === 'function') {
          item = vc.getList(id);
        }
        if (!item) item = findById(vc.lists_ || [], id);
      } else if (menuName === 'messages') {
        if (typeof vc.getMessage === 'function') {
          item = vc.getMessage(id);
        }
        if (!item) item = findById(vc.messages_ || [], id);
      } else if (menuName === 'functions') {
        item = findById(vc.functions_ || [], id);
      } else if (menuName === 'pictures' || menuName === 'sounds') {
        item = findObjectAsset(menuName, id);
      } else if (menuName === 'sprites' || menuName === 'spritesWithMouse' || menuName === 'spritesWithSelf' || menuName === 'allSprites') {
        item = findById(getEntryObjects(entry), id);
      } else if (menuName === 'scenes' && entry.scene && typeof entry.scene.getScenes === 'function') {
        item = findById(entry.scene.getScenes(), id);
      }
    } catch (e) {
      item = null;
    }

    return readName(item);
  }

  function findObjectAsset(menuName, id) {
    var listName = menuName === 'pictures' ? 'pictures' : 'sounds';
    var objects = [];
    var currentObject = renderContextObject || getCurrentObject();
    if (currentObject) objects.push(currentObject);
    objects = objects.concat(getEntryObjects(safeGetEntry()));

    for (var i = 0; i < objects.length; i++) {
      var object = objects[i];
      var item = findById(object && object[listName], id);
      if (item) return item;
    }
    return null;
  }

  function resolveObjectAssetName(listName, id) {
    var menuName = listName === 'pictures' ? 'pictures' : 'sounds';
    return readName(findObjectAsset(menuName, id));
  }

  function getCurrentObject() {
    if (Adapter && typeof Adapter.getCurrentObject === 'function') {
      return Adapter.getCurrentObject();
    }
    var entry = safeGetEntry();
    return entry && entry.playground && entry.playground.object || null;
  }

  function getEntryObjects(entry) {
    var container = entry && entry.container;
    if (!container) return [];

    if (typeof container.getAllObjects === 'function') {
      try {
        return container.getAllObjects() || [];
      } catch (e) {}
    }

    if (Array.isArray(container.objects_)) return container.objects_;
    if (Array.isArray(container.objects)) return container.objects;
    return [];
  }

  function findById(items, id) {
    if (!Array.isArray(items)) return null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (String(item && (item.id_ || item.id)) === String(id)) return item;
    }
    return null;
  }

  function readName(item) {
    if (!item) return '';
    try {
      if (typeof item.getName === 'function') return item.getName() || '';
    } catch (e) {}
    return item.name_ || item.name || '';
  }

  function getThreadBlocks(statement) {
    if (!statement) return [];
    if (typeof statement.getBlocks === 'function') {
      try {
        return statement.getBlocks() || [];
      } catch (e) {
        return [];
      }
    }
    return Array.isArray(statement) ? statement : [];
  }

  function isEntryBlock(value) {
    var entry = safeGetEntry();
    return !!(
      value &&
      (
        entry && entry.Block && value instanceof entry.Block ||
        typeof value.type === 'string' && (
          value.params ||
          value.statements ||
          value._schema ||
          value.view ||
          value.id ||
          value.id_ ||
          value.value ||
          typeof value.getNextBlock === 'function'
        )
      )
    );
  }

  function isFieldBlock(block) {
    var schema = getBlockSchema(block) || {};
    var skeleton = schema.skeleton;
    if (hasRenderableParams(schema)) return false;
    return skeleton === 'basic_string_field' || skeleton === 'basic_boolean_field';
  }

  function renderFieldBlock(block) {
    var params = Array.isArray(block.params) ? block.params : [];
    var paramText = firstPrimitive.apply(null, params);
    if (paramText != null) return normalizeText(paramText);

    var schemaParams = getSchemaParams(block);
    var texts = schemaParams
      .filter(function (param) { return param && param.type === 'Text' && param.text; })
      .map(function (param) { return param.text; });
    return normalizeText(texts.join(' '));
  }

  function hasRenderableParams(schema) {
    var params = Array.isArray(schema && schema.params) ? schema.params : [];
    return params.some(function (param) {
      if (!param || !param.type) return false;
      return ['Block', 'Output', 'Dropdown', 'DropdownDynamic', 'Keyboard', 'Color', 'Angle'].indexOf(param.type) >= 0;
    });
  }

  function normalizeText(text) {
    return String(text == null ? '' : text)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeVisualText(text) {
    return normalizeText(text)
      .replace(/\s+([,.:;%\]\)])/g, '$1')
      .replace(/([\[\(])\s+/g, '$1');
  }

  function indent(depth) {
    return new Array(depth + 1).join('  ');
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopyText(text);
      });
    }
    return fallbackCopyText(text);
  }

  function fallbackCopyText(text) {
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        if (document.execCommand('copy')) {
          resolve();
        } else {
          reject(new Error('copy command failed'));
        }
      } catch (e) {
        reject(e);
      } finally {
        textarea.remove();
      }
    });
  }

  function showToast(message, type) {
    post('BLOCK_TEXT_COPY_TOAST', {
      message: message,
      type: type || 'info'
    });
  }

  onMessage(function (msg) {
    if (msg.type !== 'SET_BLOCK_TEXT_COPY_ENABLED') return;
    enabled = !!(msg.payload && msg.payload.enabled);
    patchEntry(safeGetEntry());
    schedulePatchRetry();
    post('BLOCK_TEXT_COPY_RESULT', { success: true, enabled: enabled }, msg.requestId);
  });

  schedulePatchRetry();
  post('BLOCK_TEXT_COPY_READY', { enabled: enabled });
})();
