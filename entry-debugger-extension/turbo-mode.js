/**
 * turbo-mode.js - Main World speed panel turbo mode
 *
 * Adds an infinity speed cell. Selecting it keeps FPS at 60 and enables Entry.isTurbo.
 */
(function () {
  'use strict';

  if (window.__ENTRY_DEBUGGER_TURBO_MODE_INJECTED__) return;
  window.__ENTRY_DEBUGGER_TURBO_MODE_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const TURBO_SPEED = Infinity;
  const TURBO_FPS = 60;
  const STYLE_ID = 'entry-debugger-turbo-mode-style';
  const SPEED_BUTTON_SELECTOR = '.entrySpeedButtonWorkspace';
  const SPEED_BUTTON_BLINK_CLASS = 'entry-debugger-turbo-button-blink';
  const RETRY_INTERVAL = 300;
  const RETRY_TIMEOUT = 30000;

  let enabled = false;
  let blinkPending = false;
  let retryTimer = null;
  let retryUntil = 0;

  function safeGetEntry() {
    try {
      return window.Entry || null;
    } catch (e) {
      return null;
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#entrySpeedProgressWorkspace.entry-debugger-turbo-speed > tr > td {',
      '  width: 16.6667%;',
      '  position: relative;',
      '  text-align: center;',
      '  vertical-align: middle;',
      '}',
      '#entrySpeedProgressWorkspace.entry-debugger-speed-labeled .progressCell {',
      '  position: relative;',
      '  overflow: hidden;',
      '  color: #183b73;',
      '  font-family: Arial, sans-serif;',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '  line-height: 30px;',
      '  text-align: center;',
      '}',
      '#entrySpeedProgressWorkspace.entry-debugger-speed-labeled .progressCell.on {',
      '  background-position: calc(50% + 18px) 50%;',
      '}',
      '#entrySpeedProgressWorkspace.entry-debugger-speed-labeled .progressCell.on .entry-debugger-speed-label {',
      '  font-weight: 800;',
      '}',
      '#entrySpeedProgressWorkspace .entry-debugger-speed-label {',
      '  position: absolute;',
      '  inset: 0;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  pointer-events: none;',
      '}',
      '#entrySpeedProgressWorkspace.entry-debugger-speed-labeled #progressCell3 .entry-debugger-speed-label,',
      '#entrySpeedProgressWorkspace.entry-debugger-speed-labeled #progressCell4 .entry-debugger-speed-label,',
      '#entrySpeedProgressWorkspace.entry-debugger-speed-labeled .entry-debugger-turbo-cell .entry-debugger-speed-label {',
      '  color: #fff;',
      '}',
      '#entrySpeedProgressWorkspace .entry-debugger-turbo-cell {',
      '  background-color: #2f56d9;',
      '  color: #fff;',
      '  font-weight: 700;',
      '  font-size: 14px;',
      '}',
      '.entrySpeedButtonWorkspace.entry-debugger-turbo-button-blink {',
      '  animation: entryDebuggerTurboButtonBlink 0.28s ease-in-out 0s 4;',
      '}',
      '@keyframes entryDebuggerTurboButtonBlink {',
      '  0%, 100% {',
      '    filter: none;',
      '    box-shadow: none;',
      '  }',
      '  50% {',
      '    filter: brightness(1.25);',
      '    box-shadow: 0 0 0 2px rgba(79, 128, 255, 0.45), 0 0 12px rgba(79, 128, 255, 0.75);',
      '  }',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function getSpeedButton(entry) {
    var button = entry && entry.engine && entry.engine.speedButton;
    if (button && button.classList) return button;
    return document.querySelector(SPEED_BUTTON_SELECTOR);
  }

  function blinkSpeedButton(entry) {
    ensureStyle();

    var button = getSpeedButton(entry);
    if (!button || !button.classList) return false;

    button.classList.remove(SPEED_BUTTON_BLINK_CLASS);
    void button.offsetWidth;
    button.classList.add(SPEED_BUTTON_BLINK_CLASS);

    var removeBlink = function () {
      button.classList.remove(SPEED_BUTTON_BLINK_CLASS);
    };
    button.addEventListener('animationend', removeBlink, { once: true });
    window.setTimeout(removeBlink, 1400);
    return true;
  }

  function ensureTurboSpeed(engine) {
    if (!engine || !Array.isArray(engine.speeds)) return;
    if (engine.speeds.indexOf(TURBO_SPEED) < 0) {
      engine.speeds.push(TURBO_SPEED);
    }
  }

  function removeTurboSpeed(engine) {
    if (!engine || !Array.isArray(engine.speeds)) return;
    var index = engine.speeds.indexOf(TURBO_SPEED);
    if (index >= 0) {
      engine.speeds.splice(index, 1);
    }
  }

  function getTurboIndex(engine) {
    return engine && Array.isArray(engine.speeds) ? engine.speeds.indexOf(TURBO_SPEED) : -1;
  }

  function decoratePanel(engine) {
    if (!engine || !engine.speedPanelOn) return;

    ensureStyle();

    var table = document.getElementById('entrySpeedProgressWorkspace');
    if (table) {
      table.classList.add('entry-debugger-turbo-speed');
      table.classList.add('entry-debugger-speed-labeled');
    }

    var turboIndex = getTurboIndex(engine);
    if (turboIndex < 0) return;

    var cell = ensureTurboCell(engine, turboIndex);
    if (!cell) return;

    cell.classList.add('entry-debugger-turbo-cell');
    cell.title = '터보 모드';
    ensureSpeedLabels(engine);
  }

  function getSpeedLabel(speed) {
    return speed === TURBO_SPEED ? '\u221E' : String(speed);
  }

  function ensureSpeedLabels(engine) {
    if (!engine || !Array.isArray(engine.speeds)) return;

    var cells = document.querySelectorAll('#entrySpeedProgressWorkspace .progressCell');
    Array.from(cells).forEach(function (cell, index) {
      var speed = engine.speeds[index];
      if (typeof speed === 'undefined') return;

      var label = getSpeedLabel(speed);
      var labelEl = cell.querySelector('.entry-debugger-speed-label');
      if (!labelEl) {
        labelEl = document.createElement('span');
        labelEl.className = 'entry-debugger-speed-label';
        cell.appendChild(labelEl);
      }
      if (labelEl.textContent !== label) {
        labelEl.textContent = label;
      }
      if (speed !== TURBO_SPEED) {
        cell.title = label;
      }
    });
  }

  function ensureTurboCell(engine, turboIndex) {
    var cell = document.getElementById('progressCell' + turboIndex);
    if (cell) return cell;

    var table = document.getElementById('entrySpeedProgressWorkspace');
    var row = table && table.querySelector('tr');
    if (!row) return null;

    cell = document.createElement('td');
    cell.id = 'progressCell' + turboIndex;
    cell.className = 'progressCell';
    cell.addEventListener('click', function () {
      engine.setSpeedMeter(TURBO_SPEED);
    });
    row.appendChild(cell);
    return cell;
  }

  function removeTurboCell(engine) {
    var turboIndex = getTurboIndex(engine);
    var table = document.getElementById('entrySpeedProgressWorkspace');
    if (table) {
      table.classList.remove('entry-debugger-turbo-speed');
      table.classList.remove('entry-debugger-speed-labeled');
      Array.from(table.querySelectorAll('.entry-debugger-speed-label')).forEach(function (label) {
        label.remove();
      });
    }

    if (turboIndex >= 0) {
      var cell = document.getElementById('progressCell' + turboIndex);
      if (cell) cell.remove();
    }
  }

  function markTurboCell(engine) {
    if (!engine || !engine.speedPanelOn) return;

    decoratePanel(engine);

    var turboIndex = getTurboIndex(engine);
    if (turboIndex < 0) return;

    var cells = document.querySelectorAll('#entrySpeedProgressWorkspace .progressCell');
    Array.from(cells).forEach(function (cell, index) {
      cell.className = cell.className.replace(/\bon\b/g, '').trim();
      if (cell.className.indexOf('progressCell') < 0) {
        cell.className = ('progressCell ' + cell.className).trim();
      }
      if (index === turboIndex) {
        cell.className = (cell.className + ' on').trim();
      }
    });
  }

  function patchEnginePrototype(entry) {
    if (!entry || !entry.Engine || !entry.Engine.prototype) return false;

    var proto = entry.Engine.prototype;
    if (proto.__ENTRY_DEBUGGER_TURBO_PATCHED__) return true;
    if (typeof proto.setSpeedMeter !== 'function' || typeof proto.toggleSpeedPanel !== 'function') {
      return false;
    }

    var originalSetSpeedMeter = proto.setSpeedMeter;
    var originalToggleSpeedPanel = proto.toggleSpeedPanel;

    proto.setSpeedMeter = function (FPS) {
      if (!enabled) {
        entry.isTurbo = false;
        this.__ENTRY_DEBUGGER_TURBO_ACTIVE__ = false;
        return originalSetSpeedMeter.call(this, FPS);
      }

      ensureTurboSpeed(this);

      if (FPS === TURBO_SPEED) {
        entry.isTurbo = true;
        this.__ENTRY_DEBUGGER_TURBO_ACTIVE__ = true;
        if (entry.FPS !== TURBO_FPS) {
          originalSetSpeedMeter.call(this, TURBO_FPS);
        }
        markTurboCell(this);
        blinkSpeedButton(entry);
        return;
      }

      if (this.__ENTRY_DEBUGGER_TURBO_PANEL_OPENING__ && this.__ENTRY_DEBUGGER_TURBO_ACTIVE__) {
        originalSetSpeedMeter.call(this, TURBO_FPS);
        entry.isTurbo = true;
        markTurboCell(this);
        return;
      }

      entry.isTurbo = false;
      this.__ENTRY_DEBUGGER_TURBO_ACTIVE__ = false;
      var result = originalSetSpeedMeter.call(this, FPS);
      if (this.speedPanelOn) {
        decoratePanel(this);
      }
      return result;
    };

    proto.toggleSpeedPanel = function () {
      if (enabled) {
        ensureTurboSpeed(this);
      }

      this.__ENTRY_DEBUGGER_TURBO_PANEL_OPENING__ = true;
      var result;
      try {
        result = originalToggleSpeedPanel.apply(this, arguments);
      } finally {
        this.__ENTRY_DEBUGGER_TURBO_PANEL_OPENING__ = false;
      }

      if (enabled && this.speedPanelOn) {
        decoratePanel(this);
        if (this.__ENTRY_DEBUGGER_TURBO_ACTIVE__ || entry.isTurbo) {
          this.__ENTRY_DEBUGGER_TURBO_ACTIVE__ = true;
          entry.isTurbo = true;
          markTurboCell(this);
        }
      }

      return result;
    };

    proto.__ENTRY_DEBUGGER_TURBO_PATCHED__ = true;
    return true;
  }

  function patchCurrentEngine(entry) {
    if (!entry || !entry.engine) return false;
    if (enabled) {
      ensureTurboSpeed(entry.engine);
      if (entry.engine.speedPanelOn) decoratePanel(entry.engine);
      if (blinkPending && blinkSpeedButton(entry)) {
        blinkPending = false;
      }
    }
    return true;
  }

  function applyNow() {
    var entry = safeGetEntry();
    if (!entry) return false;

    var patched = patchEnginePrototype(entry);
    patchCurrentEngine(entry);
    return patched;
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
      var ready = applyNow();
      if (!ready && Date.now() < retryUntil) {
        retryTimer = setTimeout(tick, RETRY_INTERVAL);
      }
    }

    tick();
  }

  function disableTurbo() {
    var entry = safeGetEntry();
    if (!entry) return;
    entry.isTurbo = false;
    if (entry.engine) {
      entry.engine.__ENTRY_DEBUGGER_TURBO_ACTIVE__ = false;
      removeTurboCell(entry.engine);
      removeTurboSpeed(entry.engine);
    }
  }

  function setEnabled(nextEnabled) {
    var wasEnabled = enabled;
    enabled = !!nextEnabled;
    if (enabled) {
      if (!wasEnabled) {
        blinkPending = true;
      }
      scheduleApply();
    } else {
      blinkPending = false;
      clearRetry();
      disableTurbo();
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    var msg = event.data;
    if (msg.type !== 'SET_TURBO_MODE_ENABLED') return;

    setEnabled(!!(msg.payload && msg.payload.enabled));
    window.postMessage({
      channel: CHANNEL,
      type: 'TURBO_MODE_RESULT',
      payload: { success: true, enabled: enabled },
      requestId: msg.requestId
    }, window.location.origin);
  });

  window.postMessage({
    channel: CHANNEL,
    type: 'TURBO_MODE_READY'
  }, window.location.origin);
})();
