/**
 * dropdown-search.js - Searchable Entry variable/message/list dropdowns.
 *
 * This module only replaces the open dropdown UI for variables, messages, and lists.
 * It keeps Entry block params and project JSON untouched.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_DROPDOWN_SEARCH_INJECTED__) return;
  window.__ENTRY_DEBUGGER_DROPDOWN_SEARCH_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const STYLE_ID = 'entry-debugger-dropdown-search-style';
  const PATCH_MARK = '__entryDebuggerDropdownSearchPatched';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;
  const TARGET_MENUS = {
    variables: true,
    lists: true,
    messages: true
  };

  let enabled = false;
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

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.entry-debugger-search-dropdown {',
      '  width: 230px;',
      '  box-sizing: border-box;',
      '  background: #fff;',
      '  border: 1px solid rgba(0, 0, 0, 0.08);',
      '  border-radius: 6px;',
      '  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);',
      '  font-family: NanumGothic, "Nanum Gothic", "Malgun Gothic", sans-serif;',
      '  overflow: hidden;',
      '}',
      '.entry-debugger-search-input-row {',
      '  display: flex;',
      '  align-items: center;',
      '  height: 54px;',
      '  box-sizing: border-box;',
      '  padding: 0 18px;',
      '  border-bottom: 1px solid #edf1f5;',
      '  background: #fff;',
      '}',
      '.entry-debugger-search-input {',
      '  display: block;',
      '  width: 100%;',
      '  height: 54px;',
      '  margin: 0;',
      '  padding: 0;',
      '  box-sizing: border-box;',
      '  border: 0;',
      '  border-radius: 0;',
      '  outline: none;',
      '  background: transparent;',
      '  color: #2f3740;',
      '  font: inherit;',
      '  font-size: 18px;',
      '  line-height: 54px;',
      '}',
      '.entry-debugger-search-input:focus {',
      '  border: 0;',
      '  box-shadow: none;',
      '}',
      '.entry-debugger-search-input::placeholder {',
      '  color: #a9b1bb;',
      '}',
      '.entry-debugger-search-list {',
      '  max-height: 260px;',
      '  overflow-y: auto;',
      '  background: #fff;',
      '}',
      '.entry-debugger-search-list::-webkit-scrollbar {',
      '  width: 10px;',
      '}',
      '.entry-debugger-search-list::-webkit-scrollbar-track {',
      '  background: transparent;',
      '}',
      '.entry-debugger-search-list::-webkit-scrollbar-thumb {',
      '  background: #b6cadb;',
      '  border: 2px solid #fff;',
      '  border-radius: 10px;',
      '}',
      '.entry-debugger-search-item {',
      '  display: block;',
      '  width: 100%;',
      '  min-height: 54px;',
      '  padding: 0 18px;',
      '  box-sizing: border-box;',
      '  border: 0;',
      '  border-bottom: 1px solid #edf1f5;',
      '  background: #fff;',
      '  color: #2f3740;',
      '  text-align: left;',
      '  font: inherit;',
      '  font-size: 18px;',
      '  line-height: 54px;',
      '  cursor: pointer;',
      '}',
      '.entry-debugger-search-item:last-child {',
      '  border-bottom: 0;',
      '}',
      '.entry-debugger-search-item:hover,',
      '.entry-debugger-search-item.entry-debugger-search-item-active {',
      '  background: #f6f8fa;',
      '  color: #2f3740;',
      '}',
      '.entry-debugger-search-empty {',
      '  height: 54px;',
      '  padding: 0 18px;',
      '  color: #9aa4ae;',
      '  font-size: 16px;',
      '  line-height: 54px;',
      '}',
      '.entry-debugger-search-host {',
      '  z-index: 100000 !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function isTargetField(field) {
    return !!(field && TARGET_MENUS[field._menuName]);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function getOptionLabel(field, option) {
    try {
      return field._convert(option[0], option[1]);
    } catch (e) {
      return String(option[0] == null ? '' : option[0]);
    }
  }

  function applySelectedValue(field, value) {
    field.applyValue(value);
    field.destroyOption();

    try {
      const thread = field._block.getThread();
      const view = thread && thread.view ? thread.view : {};
      if (view.reDraw) {
        view.reDraw();
      } else if (field._block.view && field._block.view.reDraw) {
        field._block.view.reDraw();
      }
    } catch (e) {}
  }

  function createOptionGroup() {
    const entry = safeGetEntry();
    if (entry && typeof entry.Dom === 'function' && window.$) {
      return entry.Dom('div', {
        class: 'entry-widget-dropdown entry-debugger-search-host',
        parent: window.$('body')
      });
    }

    const node = document.createElement('div');
    node.className = 'entry-widget-dropdown entry-debugger-search-host';
    document.body.appendChild(node);
    return {
      0: node,
      remove: function () {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  function positionOptionGroup(field, container) {
    const rect = field.svgGroup && field.svgGroup.getBoundingClientRect
      ? field.svgGroup.getBoundingClientRect()
      : null;
    const dropdownWidth = 230;
    const margin = 8;
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    let left = rect ? rect.left + scrollX : scrollX + margin;
    let top = rect ? rect.bottom + scrollY + 4 : scrollY + margin;
    const viewportLeft = scrollX + margin;
    const viewportRight = scrollX + window.innerWidth - margin;

    if (left + dropdownWidth > viewportRight) {
      left = viewportRight - dropdownWidth;
    }
    if (left < viewportLeft) {
      left = viewportLeft;
    }

    container.style.position = 'absolute';
    container.style.left = Math.round(left) + 'px';
    container.style.top = Math.round(top) + 'px';
    container.style.zIndex = '100000';
  }

  function attachOutsideClose(field, container) {
    let attached = true;
    const onPointerDown = function (event) {
      const target = event.target;
      const svgGroup = field.svgGroup;

      if (container.contains(target)) return;
      if (svgGroup && (svgGroup === target || (svgGroup.contains && svgGroup.contains(target)))) {
        return;
      }

      field.destroyOption();
    };

    setTimeout(function () {
      if (!attached) return;
      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('touchstart', onPointerDown, true);
    }, 0);

    field.documentDownEvent = {
      destroy: function () {
        attached = false;
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('touchstart', onPointerDown, true);
      }
    };
  }

  function buildSearchDropdown(field, container) {
    if (!enabled || !isTargetField(field) || !container) return;

    const options = Array.isArray(field._contents && field._contents.options)
      ? field._contents.options
      : [];

    ensureStyle();

    const root = document.createElement('div');
    root.className = 'entry-debugger-search-dropdown';

    const inputRow = document.createElement('div');
    inputRow.className = 'entry-debugger-search-input-row';

    const input = document.createElement('input');
    input.className = 'entry-debugger-search-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '검색';

    const list = document.createElement('div');
    list.className = 'entry-debugger-search-list';

    inputRow.appendChild(input);
    root.appendChild(inputRow);
    root.appendChild(list);
    container.appendChild(root);

    const rows = options.map(function (option) {
      return {
        label: getOptionLabel(field, option),
        value: option[1]
      };
    });
    let visibleRows = rows.slice();
    let activeIndex = 0;

    function renderRows() {
      const query = normalizeText(input.value);
      visibleRows = rows.filter(function (row) {
        return !query || normalizeText(row.label).indexOf(query) !== -1;
      });
      if (activeIndex >= visibleRows.length) activeIndex = visibleRows.length - 1;
      if (activeIndex < 0) activeIndex = 0;

      list.textContent = '';
      if (!visibleRows.length) {
        const empty = document.createElement('div');
        empty.className = 'entry-debugger-search-empty';
        empty.textContent = '검색 결과가 없습니다.';
        list.appendChild(empty);
        return;
      }

      visibleRows.forEach(function (row, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'entry-debugger-search-item';
        if (index === activeIndex) {
          button.classList.add('entry-debugger-search-item-active');
        }
        button.textContent = row.label;
        button.addEventListener('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
          applySelectedValue(field, row.value);
        });
        button.addEventListener('touchstart', function (event) {
          event.stopPropagation();
          applySelectedValue(field, row.value);
        }, { passive: true });
        list.appendChild(button);
      });
    }

    function moveActive(delta) {
      if (!visibleRows.length) return;
      activeIndex = (activeIndex + delta + visibleRows.length) % visibleRows.length;
      renderRows();
      const active = list.querySelector('.entry-debugger-search-item-active');
      if (active) {
        active.scrollIntoView({ block: 'nearest' });
      }
    }

    input.addEventListener('mousedown', function (event) {
      event.stopPropagation();
    });
    input.addEventListener('touchstart', function (event) {
      event.stopPropagation();
    }, { passive: true });
    input.addEventListener('input', function () {
      activeIndex = 0;
      renderRows();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (visibleRows[activeIndex]) {
          applySelectedValue(field, visibleRows[activeIndex].value);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        field.destroyOption();
      }
    });

    renderRows();
    setTimeout(function () {
      input.focus();
      input.select();
    }, 0);
  }

  function renderSearchOptions(field) {
    field.optionGroup = createOptionGroup();
    const container = field.optionGroup[0];
    positionOptionGroup(field, container);
    buildSearchDropdown(field, container);
    attachOutsideClose(field, container);
    field.optionDomCreated();
  }

  function patchDropdownDynamic(entry) {
    const proto = entry && entry.FieldDropdownDynamic && entry.FieldDropdownDynamic.prototype;
    if (!proto || typeof proto.renderOptions !== 'function') {
      return false;
    }
    if (proto[PATCH_MARK]) {
      return true;
    }

    const patched = Patches && typeof Patches.patchMethod === 'function'
      ? Patches.patchMethod(proto, 'renderOptions', 'dropdown-search', function (nativeRenderOptions) {
        return function () {
          if (enabled && isTargetField(this)) {
            try {
              renderSearchOptions(this);
              return;
            } catch (e) {}
          }

          return nativeRenderOptions.apply(this, arguments);
        };
      })
      : false;
    proto[PATCH_MARK] = patched;
    return patched;
  }

  function applyNow() {
    return patchDropdownDynamic(safeGetEntry());
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
      const ready = applyNow();
      if (!ready && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    scheduleApply();
  }

  onMessage(function (msg) {
    if (msg.type === 'SET_DROPDOWN_SEARCH_ENABLED') {
      setEnabled(!!(msg.payload && msg.payload.enabled));
      post('DROPDOWN_SEARCH_RESULT', { success: true, enabled: enabled }, msg.requestId);
    }
  });

  post('DROPDOWN_SEARCH_READY');
})();
