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
  const PROPERTY_PANEL_SELECTOR = '#entryCode > div.entryVariablePanelWorkspace';
  const PROPERTY_SEARCH_CLASS = 'entry-debugger-property-search';
  const PROPERTY_SEARCH_INPUT_CLASS = 'entry-debugger-property-search-input';
  const PROPERTY_HIDDEN_ATTR = 'data-entry-debugger-property-search-hidden';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  const Patches = window.EntryDebuggerPatchRegistry || null;
  const HangulSearch = window.EntryDebuggerHangulSearch || null;
  const TARGET_MENUS = {
    variables: true,
    lists: true,
    messages: true
  };

  let enabled = false;
  let blockMenuEnabled = true;
  let propertyPanelEnabled = true;
  let retryTimer = null;
  let retryUntil = 0;
  let propertyPanelRetryTimer = null;
  let propertyPanelRetryUntil = 0;
  let propertyPanelObserver = null;
  let propertyPanelEl = null;

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
      '}',
      '.entry-debugger-property-search {',
      '  position: sticky;',
      '  top: 0;',
      '  z-index: 5;',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  padding: 8px 12px;',
      '  background: #ecf8ff;',
      '  border-bottom: 1px solid #d6e9f4;',
      '}',
      '.entry-debugger-property-search-input {',
      '  display: block;',
      '  width: 100%;',
      '  height: 30px;',
      '  box-sizing: border-box;',
      '  margin: 0;',
      '  padding: 0 9px;',
      '  border: 1px solid #d5dde7;',
      '  border-radius: 5px;',
      '  outline: none;',
      '  background: #fff;',
      '  color: #2f3740;',
      '  font-family: NanumGothic, "Nanum Gothic", "Malgun Gothic", sans-serif;',
      '  font-size: 13px;',
      '}',
      '.entry-debugger-property-search-input:focus {',
      '  border-color: #4f80ff;',
      '  box-shadow: 0 0 0 2px rgba(79, 128, 255, 0.16);',
      '}',
      '.entry-debugger-property-search-input::placeholder {',
      '  color: #9aa4ae;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function isTargetField(field) {
    return !!(field && TARGET_MENUS[field._menuName]);
  }

  function canUseBlockMenuSearch() {
    return !!(enabled && blockMenuEnabled);
  }

  function canUsePropertyPanelSearch() {
    return !!(enabled && propertyPanelEnabled);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function matchesSearch(text, query) {
    if (HangulSearch && typeof HangulSearch.matches === 'function') {
      return HangulSearch.matches(text, query);
    }
    const normalizedQuery = normalizeText(query);
    return !normalizedQuery || normalizeText(text).indexOf(normalizedQuery) !== -1;
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
    if (!canUseBlockMenuSearch() || !isTargetField(field) || !container) return;

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
      const query = input.value;
      visibleRows = rows.filter(function (row) {
        return matchesSearch(row.label, query);
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

  function getPropertyPanel() {
    return document.querySelector(PROPERTY_PANEL_SELECTOR);
  }

  function getPropertySearchInput(panel) {
    const wrapper = panel && panel.querySelector('.' + PROPERTY_SEARCH_CLASS);
    return wrapper ? wrapper.querySelector('.' + PROPERTY_SEARCH_INPUT_CLASS) : null;
  }

  function getPropertySearchHost(panel) {
    return panel ? panel.querySelector('.entryVariableListWorkspace') : null;
  }

  function createPropertySearch(panel) {
    const host = getPropertySearchHost(panel);
    if (!host) return null;

    let wrapper = panel.querySelector('.' + PROPERTY_SEARCH_CLASS);
    if (wrapper) {
      if (wrapper.parentNode !== host) {
        host.insertBefore(wrapper, host.firstChild);
      }
      return wrapper.querySelector('.' + PROPERTY_SEARCH_INPUT_CLASS);
    }

    ensureStyle();

    wrapper = document.createElement('div');
    wrapper.className = PROPERTY_SEARCH_CLASS;

    const input = document.createElement('input');
    input.className = PROPERTY_SEARCH_INPUT_CLASS;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '속성 검색';
    input.addEventListener('input', function () {
      filterPropertyPanel(panel);
    });

    wrapper.appendChild(input);
    host.insertBefore(wrapper, host.firstChild);
    return input;
  }

  function isPropertyListItem(node) {
    return !!(
      node &&
      node.classList &&
      node.classList.contains('list') &&
      node.querySelector &&
      node.querySelector('.inpt_box')
    );
  }

  function getPropertyListItems(root) {
    return Array.from(root.querySelectorAll('.list')).filter(isPropertyListItem);
  }

  function getPropertyItemText(item) {
    const parts = [item.textContent || ''];
    const nameField = item.nameField;
    if (nameField) {
      if (typeof nameField.value === 'string') parts.push(nameField.value);
      if (typeof nameField.textContent === 'string') parts.push(nameField.textContent);
    }
    Array.from(item.querySelectorAll('input, textarea')).forEach(function (input) {
      parts.push(input.value || '');
    });
    return normalizeText(parts.join(' '));
  }

  function setPropertyHidden(node, hidden) {
    if (!node) return;
    if (hidden) {
      node.setAttribute(PROPERTY_HIDDEN_ATTR, 'true');
      node.style.display = 'none';
      return;
    }

    if (node.hasAttribute(PROPERTY_HIDDEN_ATTR)) {
      node.removeAttribute(PROPERTY_HIDDEN_ATTR);
      node.style.display = '';
    }
  }

  function updatePropertyGroups(panel, query) {
    Array.from(panel.querySelectorAll('.entryVariableSplitterWorkspace')).forEach(function (group) {
      if (!query) {
        setPropertyHidden(group, false);
        return;
      }

      const items = getPropertyListItems(group);
      const hasVisibleItem = items.some(function (item) {
        return !item.hasAttribute(PROPERTY_HIDDEN_ATTR);
      });
      setPropertyHidden(group, items.length > 0 && !hasVisibleItem);
    });
  }

  function filterPropertyPanel(panel) {
    if (!panel) return;
    const input = getPropertySearchInput(panel);
    const query = input ? input.value : '';
    const items = getPropertyListItems(panel);

    items.forEach(function (item) {
      const matches = matchesSearch(getPropertyItemText(item), query);
      setPropertyHidden(item, !matches);
    });
    updatePropertyGroups(panel, normalizeText(query));
  }

  function resetPropertyPanel(panel) {
    if (!panel) return;
    Array.from(panel.querySelectorAll('[' + PROPERTY_HIDDEN_ATTR + ']')).forEach(function (node) {
      setPropertyHidden(node, false);
    });
  }

  function clearPropertyPanelRetry() {
    if (propertyPanelRetryTimer) {
      clearTimeout(propertyPanelRetryTimer);
      propertyPanelRetryTimer = null;
    }
  }

  function observePropertyPanel(panel) {
    if (propertyPanelObserver && propertyPanelEl === panel) return;
    if (propertyPanelObserver) {
      propertyPanelObserver.disconnect();
      propertyPanelObserver = null;
    }

    propertyPanelEl = panel;
    propertyPanelObserver = new MutationObserver(function () {
      if (!canUsePropertyPanelSearch()) return;
      if (!propertyPanelEl || !document.body.contains(propertyPanelEl)) {
        propertyPanelEl = null;
        schedulePropertyPanelSearch();
        return;
      }
      createPropertySearch(propertyPanelEl);
      filterPropertyPanel(propertyPanelEl);
    });
    propertyPanelObserver.observe(panel, { childList: true, subtree: true });
  }

  function applyPropertyPanelSearchNow() {
    if (!canUsePropertyPanelSearch()) return false;

    const panel = getPropertyPanel();
    if (!panel) return false;

    createPropertySearch(panel);
    observePropertyPanel(panel);
    filterPropertyPanel(panel);
    return true;
  }

  function schedulePropertyPanelSearch() {
    clearPropertyPanelRetry();
    if (!canUsePropertyPanelSearch()) return;

    propertyPanelRetryUntil = Date.now() + RETRY_TIMEOUT;

    function tick() {
      propertyPanelRetryTimer = null;
      const ready = applyPropertyPanelSearchNow();
      if (!ready && Date.now() < propertyPanelRetryUntil) {
        propertyPanelRetryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function cleanupPropertyPanelSearch() {
    clearPropertyPanelRetry();
    if (propertyPanelObserver) {
      propertyPanelObserver.disconnect();
      propertyPanelObserver = null;
    }

    const panel = propertyPanelEl || getPropertyPanel();
    if (panel) {
      resetPropertyPanel(panel);
      Array.from(panel.querySelectorAll('.' + PROPERTY_SEARCH_CLASS)).forEach(function (wrapper) {
        wrapper.remove();
      });
    }
    propertyPanelEl = null;
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
          if (canUseBlockMenuSearch() && isTargetField(this)) {
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

  function setEnabled(payload) {
    payload = payload || {};
    enabled = !!payload.enabled;
    blockMenuEnabled = payload.blockMenuEnabled !== false;
    propertyPanelEnabled = payload.propertyPanelEnabled !== false;

    if (canUseBlockMenuSearch()) {
      scheduleApply();
    } else {
      clearRetry();
    }

    if (canUsePropertyPanelSearch()) {
      schedulePropertyPanelSearch();
    } else {
      cleanupPropertyPanelSearch();
    }
  }

  onMessage(function (msg) {
    if (msg.type === 'SET_DROPDOWN_SEARCH_ENABLED') {
      setEnabled(msg.payload);
      post('DROPDOWN_SEARCH_RESULT', {
        success: true,
        enabled: enabled,
        blockMenuEnabled: canUseBlockMenuSearch(),
        propertyPanelEnabled: canUsePropertyPanelSearch()
      }, msg.requestId);
    }
  });

  post('DROPDOWN_SEARCH_READY', {
    enabled: enabled,
    blockMenuEnabled: canUseBlockMenuSearch(),
    propertyPanelEnabled: canUsePropertyPanelSearch()
  });
})();
