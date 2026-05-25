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
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;

  let enabled = false;
  let activeBlockView = null;
  let activeUntil = 0;
  let retryTimer = null;
  let retryUntil = 0;

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

    var menuPatched = patchMethod(contextMenu, 'show', 'block-text-copy', function (originalShow) {
      return function (options, className, coordinate) {
        var blockView = activeBlockView && Date.now() <= activeUntil ? activeBlockView : null;
        activeBlockView = null;

        if (enabled && shouldAddMenu(options, blockView)) {
          options = options.slice();
          options.push(createCopyTextOption(blockView));
        }

        return originalShow.call(this, options, className, coordinate);
      };
    });

    return !!(blockPatched && menuPatched);
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

  function createCopyTextOption(blockView) {
    return {
      text: MENU_TEXT,
      enable: true,
      callback: function () {
        var text = buildBlockStackText(blockView);
        copyText(text)
          .then(function () {
            showToast('블록을 텍스트로 복사했습니다.');
          })
          .catch(function () {
            showToast('텍스트 복사에 실패했습니다.');
          });
      }
    };
  }

  function buildBlockStackText(blockView) {
    var block = blockView && blockView.block;
    var lines = [];
    var visited = [];

    while (block && visited.indexOf(block) < 0) {
      visited.push(block);
      lines = lines.concat(renderBlock(block, 0, false));
      block = typeof block.getNextBlock === 'function' ? block.getNextBlock() : null;
    }

    return lines.join('\n').trim() || '(비어 있는 블록)';
  }

  function renderBlock(block, depth, inline) {
    if (!block) return [''];

    if (isFieldBlock(block)) {
      return [renderFieldBlock(block)];
    }

    var line = renderBlockLine(block);
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

  function renderBlockLine(block) {
    var template = getTemplate(block);
    var params = getSchemaParams(block);
    var values = Array.isArray(block.params) ? block.params : [];

    if (!template) {
      return normalizeText(block.type || '(알 수 없는 블록)');
    }

    var text = String(template);
    values.forEach(function (value, index) {
      var paramText = renderParam(value, params[index]);
      text = text.replace(new RegExp('%' + (index + 1), 'g'), paramText);
    });

    text = text.replace(/%\d+/g, '');
    return normalizeText(text) || normalizeText(block.type || '(알 수 없는 블록)');
  }

  function getTemplate(block) {
    try {
      if (block.view && typeof block.view._getTemplate === 'function') {
        return block.view._getTemplate();
      }
    } catch (e) {}

    var schema = block._schema || (safeGetEntry()?.block && safeGetEntry().block[block.type]) || null;
    return schema && (schema.template || getLangTemplate(block.type));
  }

  function getSchemaParams(block) {
    try {
      if (block.view && typeof block.view._getSchemaParams === 'function') {
        return block.view._getSchemaParams() || [];
      }
    } catch (e) {}

    var schema = block._schema || (safeGetEntry()?.block && safeGetEntry().block[block.type]) || null;
    return schema && schema.params || [];
  }

  function getLangTemplate(type) {
    try {
      return window.Lang && window.Lang.template && window.Lang.template[type];
    } catch (e) {
      return '';
    }
  }

  function renderParam(value, paramDef) {
    if (value == null) return '';

    if (isEntryBlock(value)) {
      return renderBlock(value, 0, true)[0];
    }

    if (Array.isArray(value)) {
      return value.map(function (item) { return renderParam(item, paramDef); }).join(', ');
    }

    var raw = String(value);
    var optionLabel = findOptionLabel(paramDef, raw);
    if (optionLabel) return optionLabel;

    if (paramDef && paramDef.type === 'DropdownDynamic') {
      return resolveDynamicName(paramDef.menuName, raw) || raw;
    }

    return raw;
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

  function resolveDynamicName(menuName, id) {
    var entry = safeGetEntry();
    var vc = entry && entry.variableContainer;
    if (!vc) return '';

    var item = null;
    try {
      if (menuName === 'variables' && typeof vc.getVariable === 'function') {
        item = vc.getVariable(id, entry.playground && entry.playground.object);
      } else if (menuName === 'lists' && typeof vc.getList === 'function') {
        item = vc.getList(id);
      } else if (menuName === 'messages' && typeof vc.getMessage === 'function') {
        item = vc.getMessage(id);
      } else if (menuName === 'functions') {
        item = findById(vc.functions_ || [], id);
      }
    } catch (e) {
      item = null;
    }

    return readName(item);
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
        value.type && (value.params || value.statements || value._schema)
      )
    );
  }

  function isFieldBlock(block) {
    var skeleton = block && block._schema && block._schema.skeleton;
    return skeleton === 'basic_string_field' || skeleton === 'basic_boolean_field';
  }

  function renderFieldBlock(block) {
    var params = Array.isArray(block.params) ? block.params : [];
    return normalizeText(params.length ? params[0] : '');
  }

  function normalizeText(text) {
    return String(text == null ? '' : text)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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

  function showToast(message) {
    var entry = safeGetEntry();
    try {
      if (entry && entry.toast && typeof entry.toast.alert === 'function') {
        entry.toast.alert('Entry Debugger', message);
      }
    } catch (e) {}
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
