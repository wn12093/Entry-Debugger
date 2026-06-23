/**
 * inject.js - Main World 실행 스크립트
 * Entry API에 직접 접근하여 변수/리스트/신호 데이터를 읽고,
 * 값 수정 및 신호 강제 발생을 수행합니다.
 * Content Script와 postMessage로 통신합니다.
 *
 * 보안: 모든 postMessage에 고유 채널 키를 사용하고,
 *       origin 검증을 통해 XSS를 방지합니다.
 */
(function () {
  'use strict';

  // 중복 주입 방지 (SPA 재초기화 시 script.remove() 이후 재주입 방지)
  if (window.__ENTRY_DEBUGGER_INJECTED__) return;
  window.__ENTRY_DEBUGGER_INJECTED__ = true;

  const CHANNEL = '__ENTRY_DEBUGGER__';
  const POLL_INTERVAL = 200; // ms
  const SYSTEM_VARIABLE_SHOW_X = 0;
  const SYSTEM_VARIABLE_SHOW_Y = 0;
  const SYSTEM_VARIABLE_HIDE_X = 500;
  const SYSTEM_VARIABLE_HIDE_Y = 0;
  const Bridge = window.EntryDebuggerPageBridge || null;
  const Adapter = window.EntryDebuggerEntryAdapter || null;
  let pollingTimer = null;
  let isPolling = false;

  /* ───────── 유틸리티 ───────── */

  function safeGetEntry() {
    if (Adapter && typeof Adapter.getEntry === 'function') {
      return Adapter.getEntry();
    }
    try {
      return window.Entry || null;
    } catch {
      return null;
    }
  }

  function safeGetContainer() {
    if (Adapter && typeof Adapter.getVariableContainer === 'function') {
      return Adapter.getVariableContainer();
    }
    const entry = safeGetEntry();
    return entry && entry.variableContainer ? entry.variableContainer : null;
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

  /**
   * 변수 배열을 직렬화 가능한 형태로 변환
   */
  function getEntryVariableType(v) {
    return v && (v.type || v.variableType || v.variableType_ || '');
  }

  function isSystemVariable(v) {
    var type = getEntryVariableType(v);
    return type === 'timer' || type === 'answer';
  }

  function readVariableName(v, fallbackName) {
    if (!v) return fallbackName || '(이름 없음)';
    if (typeof v.getName === 'function') {
      return v.getName() || fallbackName || '(이름 없음)';
    }
    return v.name_ || v.name || fallbackName || '(이름 없음)';
  }

  function readVariableValue(v) {
    if (!v) return '';
    return typeof v.getValue === 'function' ? v.getValue() : v.value_;
  }

  function readVariableVisible(v) {
    if (!v) return false;
    if (typeof v.isVisible === 'function') {
      var visible = v.isVisible();
      if (typeof visible === 'boolean') return visible;
    }
    return v.visible_ !== false;
  }

  function readVariableCoordinate(v, getterName, propName) {
    if (!v) return 0;
    if (typeof v[getterName] === 'function') {
      return v[getterName]();
    }
    return v[propName] || 0;
  }

  function writeVariableCoordinate(v, setterName, privatePropName, propName, value) {
    if (!v) return;
    if (typeof v[setterName] === 'function') {
      v[setterName](value);
      return;
    }
    v[privatePropName] = value;
    v[propName] = value;
  }

  function writeVariableVisible(v, visible) {
    if (!v) return;
    if (typeof v.setVisible === 'function') {
      v.setVisible(visible);
    } else {
      v.visible_ = visible;
      v.visible = visible;
    }
  }

  function readSystemVariableVisible(v) {
    var x = Number(readVariableCoordinate(v, 'getX', 'x_'));
    var y = Number(readVariableCoordinate(v, 'getY', 'y_'));
    if (x === SYSTEM_VARIABLE_HIDE_X && y === SYSTEM_VARIABLE_HIDE_Y) {
      return false;
    }
    return readVariableVisible(v);
  }

  function readScopeFlag(v, privatePropName, propName) {
    return !!(v && (v[privatePropName] || v[propName]));
  }

  function readObjectId(v) {
    return v && (v.object_ || v.object || null);
  }

  function getEntryObjectById(objectId) {
    if (Adapter && typeof Adapter.getObjectById === 'function') {
      return Adapter.getObjectById(objectId);
    }
    var entry = safeGetEntry();
    if (!entry || !objectId) return null;

    if (entry.container && typeof entry.container.getObject === 'function') {
      var found = entry.container.getObject(objectId);
      if (found) return found;
    }

    var objects = entry.container && (entry.container.objects_ || entry.container.objects);
    if (Array.isArray(objects)) {
      return objects.find(function (obj) {
        return obj && (obj.id === objectId || obj.id_ === objectId);
      }) || null;
    }

    return null;
  }

  function readEntryObjectName(object, fallbackName) {
    if (Adapter && typeof Adapter.readObjectName === 'function') {
      return Adapter.readObjectName(object, fallbackName);
    }
    if (!object) return fallbackName || '(오브젝트 없음)';
    if (typeof object.getName === 'function') {
      return object.getName() || fallbackName || '(오브젝트 없음)';
    }
    return object.name || object.name_ || object.objectName || fallbackName || '(오브젝트 없음)';
  }

  function getCurrentObjectInfo() {
    if (Adapter && typeof Adapter.getCurrentObject === 'function') {
      var adapterObject = Adapter.getCurrentObject();
      var adapterId = adapterObject && (adapterObject.id || adapterObject.id_);
      if (!adapterId) return null;

      return {
        id: adapterId,
        name: readEntryObjectName(adapterObject, adapterId)
      };
    }

    var entry = safeGetEntry();
    if (!entry) return null;

    var object = entry.playground && entry.playground.object;
    if (!object && entry.container && typeof entry.container.getCurrentObject === 'function') {
      object = entry.container.getCurrentObject();
    }

    var id = object && (object.id || object.id_);
    if (!id) return null;

    return {
      id: id,
      name: readEntryObjectName(object, id)
    };
  }

  function serializeScope(v) {
    var objectId = readObjectId(v);
    var currentObject = getCurrentObjectInfo();
    var object = objectId ? getEntryObjectById(objectId) : null;
    var objectName = objectId ? readEntryObjectName(object, objectId) : '';
    var key = 'normal';

    if (objectId) {
      key = 'local';
    } else if (readScopeFlag(v, 'isCloud_', 'isCloud')) {
      key = 'cloud';
    } else if (readScopeFlag(v, 'isRealTime_', 'isRealTime')) {
      key = 'real_time';
    }

    return {
      key: key,
      label: getScopeLabel(key, objectName),
      isCloud: key === 'cloud',
      isRealTime: key === 'real_time',
      objectId: objectId,
      objectName: objectName,
      currentObjectId: currentObject ? currentObject.id : null,
      currentObjectName: currentObject ? currentObject.name : ''
    };
  }

  function getScopeLabel(key, objectName) {
    if (key === 'cloud') return '공유';
    if (key === 'real_time') return '실시간';
    if (key === 'local') return '지역: ' + (objectName || '(오브젝트 없음)');
    return '일반';
  }

  function serializeVariables(vars) {
    if (!Array.isArray(vars)) return [];
    return vars.reduce(function (result, v) {
      if (isSystemVariable(v)) return result;
      result.push({
        id: v.id_ || v.id || '',
        name: readVariableName(v),
        value: readVariableValue(v),
        type: 'variable',
        visible: readVariableVisible(v),
        object: readObjectId(v),
        scope: serializeScope(v)
      });
      return result;
    }, []);
  }

  function getSystemVariable(kind) {
    var entry = safeGetEntry();
    if (!entry) return null;
    if (kind === 'timer') {
      return entry.engine && entry.engine.projectTimer ? entry.engine.projectTimer : null;
    }
    if (kind === 'answer') {
      return entry.container && entry.container.inputValue ? entry.container.inputValue : null;
    }
    return null;
  }

  function serializeSystemVariable(kind, fallbackName) {
    var variable = getSystemVariable(kind);
    if (!variable) return null;
    return {
      id: kind,
      kind: kind,
      name: readVariableName(variable, fallbackName),
      value: readVariableValue(variable),
      type: kind,
      visible: readSystemVariableVisible(variable),
      x: readVariableCoordinate(variable, 'getX', 'x_'),
      y: readVariableCoordinate(variable, 'getY', 'y_')
    };
  }

  function serializeSystemVariables() {
    return [
      serializeSystemVariable('timer', '초시계'),
      serializeSystemVariable('answer', '대답')
    ].filter(Boolean);
  }

  /**
   * 리스트 배열을 직렬화 가능한 형태로 변환
   */
  function serializeLists(lists) {
    if (!Array.isArray(lists)) return [];
    return lists.map(function (l) {
      var items = [];
      if (Array.isArray(l.array_)) {
        items = l.array_.map(function (item) {
          return typeof item === 'object' && item !== null
            ? (item.data !== undefined ? item.data : JSON.stringify(item))
            : item;
        });
      }
      return {
        id: l.id_ || l.id || '',
        name: l.name_ || l.name || '(이름 없음)',
        items: items,
        type: 'list',
        visible: l.visible_ !== false,
        object: readObjectId(l),
        scope: serializeScope(l)
      };
    });
  }

  /**
   * 장면(Scene) 배열을 직렬화 가능한 형태로 변환
   */
  function serializeScenes() {
    var entry = safeGetEntry();
    if (!entry || !entry.scene) return [];

    var scenes = entry.scene.scenes_ || (typeof entry.scene.getScenes === 'function' ? entry.scene.getScenes() : null);
    if (!Array.isArray(scenes)) return [];

    return scenes.map(function (s) {
      return {
        id: s.id || '',
        name: s.name || '(이름 없음)'
      };
    });
  }

  /**
   * 신호(메시지) 배열을 직렬화 가능한 형태로 변환
   */
  function serializeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(function (m) {
      return {
        id: m.id_ || m.id || '',
        name: m.name_ || m.name || '(이름 없음)'
      };
    });
  }

  /**
   * 현재 전체 스냅샷을 생성
   */
  function buildSnapshot() {
    var container = safeGetContainer();
    if (!container) {
      return { variables: [], lists: [], messages: [], scenes: [], others: [], ready: false };
    }
    return {
      variables: serializeVariables(container.variables_ || []),
      lists: serializeLists(container.lists_ || []),
      messages: serializeMessages(container.messages_ || []),
      scenes: serializeScenes(),
      others: serializeSystemVariables(),
      ready: true
    };
  }

  /* ───────── E.DEBUG 변수 추적 (콘솔 출력) ───────── */

  const DEBUG_VAR_NAME = 'E.DEBUG';
  let prevDebugValue = undefined;   // 이전 값 (undefined = 아직 추적 시작 전)
  let debugVarFound = false;        // 변수 존재 여부

  function trackDebugVariable() {
    var container = safeGetContainer();
    if (!container || !Array.isArray(container.variables_)) return;

    var debugVar = container.variables_.find(function (v) {
      return (v.name_ || v.name) === DEBUG_VAR_NAME;
    });

    if (!debugVar) {
      if (debugVarFound) {
        console.log('%c[E.DEBUG]%c E.DEBUG 변수가 제거되었습니다.',
          'color:#9b59b6;font-weight:bold', 'color:inherit');
        debugVarFound = false;
        prevDebugValue = undefined;
      }
      return;
    }

    var currentValue = typeof debugVar.getValue === 'function'
      ? debugVar.getValue()
      : debugVar.value_;

    if (!debugVarFound) {
      debugVarFound = true;
      prevDebugValue = currentValue;
      console.log(
        '%c[E.DEBUG]%c E.DEBUG 변수를 인식했습니다. 값이 변경될 때마다 이 콘솔에 출력됩니다.\n' +
        '         %c콘솔 필터에 [E.DEBUG]를 입력하면 관련 로그만 확인할 수 있습니다.',
        'color:#9b59b6;font-weight:bold',
        'color:inherit',
        'color:#888'
      );
      return;
    }

    if (String(currentValue) !== String(prevDebugValue)) {
      console.log(
        '%c[E.DEBUG]%c %s',
        'color:#9b59b6;font-weight:bold',
        'color:#e67e22;font-weight:bold',
        String(currentValue)
      );
      prevDebugValue = currentValue;
    }
  }

  /* ───────── 폴링 기반 실시간 동기화 ───────── */

  let prevSnapshotJSON = '';

  function pollAndBroadcast() {
    var snapshot = buildSnapshot();
    var json = JSON.stringify(snapshot);

    // E.DEBUG 변수 추적 (매 폴링마다 실행)
    trackDebugVariable();

    // 변화가 있을 때만 전송 (성능 최적화)
    if (json !== prevSnapshotJSON) {
      prevSnapshotJSON = json;
      post('SNAPSHOT', snapshot);
    }
  }

  function forceResync() {
    prevSnapshotJSON = '';
    pollAndBroadcast();
  }

  let debugHintShown = false;

  function startPolling() {
    if (isPolling) return;
    isPolling = true;
    prevSnapshotJSON = '';
    debugVarFound = false;
    prevDebugValue = undefined;
    debugHintShown = false;
    pollingTimer = setInterval(pollAndBroadcast, POLL_INTERVAL);
    // 즉시 한 번 실행
    pollAndBroadcast();

    // E.DEBUG 안내 메시지 (변수 없을 때 1회 출력)
    setTimeout(function () {
      if (!debugVarFound && !debugHintShown) {
        debugHintShown = true;
        console.log(
          '%c[E.DEBUG]%c E.DEBUG 변수가 없습니다.\n' +
          '         엔트리에서 %cE.DEBUG%c 이름의 변수를 추가하면\n' +
          '         값이 변경될 때마다 이 콘솔에 자동 출력됩니다.',
          'color:#9b59b6;font-weight:bold',
          'color:inherit',
          'color:#e67e22;font-weight:bold',
          'color:inherit'
        );
      }
    }, 1500);
  }

  function stopPolling() {
    isPolling = false;
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  /* ───────── 신호 강제 발생 ───────── */

  function raiseMessage(messageId) {
    var entry = safeGetEntry();
    if (!entry) {
      return { success: false, error: 'Entry를 찾을 수 없습니다.' };
    }

    try {
      // Entry.engine.raiseMessage 사용
      if (entry.engine && typeof entry.engine.raiseMessage === 'function') {
        entry.engine.raiseMessage(messageId);
        return { success: true };
      }

      // 대체 방법: Entry.dispatchEvent 사용
      if (typeof entry.dispatchEvent === 'function') {
        entry.dispatchEvent(messageId);
        return { success: true };
      }

      return { success: false, error: 'raiseMessage API를 찾을 수 없습니다.' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /* ───────── 변수/리스트 값 수정 ───────── */

  function setVariableValue(id, newValue) {
    var container = safeGetContainer();
    if (!container || !Array.isArray(container.variables_)) {
      return { success: false, error: 'Entry.variableContainer를 찾을 수 없습니다.' };
    }

    var target = container.variables_.find(function (v) {
      return (v.id_ || v.id) === id;
    });

    if (!target) {
      return { success: false, error: '해당 ID의 변수를 찾을 수 없습니다: ' + id };
    }

    try {
      // 숫자 변환 시도
      var parsed = Number(newValue);
      var finalValue = isNaN(parsed) ? String(newValue) : parsed;

      if (typeof target.setValue === 'function') {
        target.setValue(finalValue);
      } else {
        target.value_ = finalValue;
      }

      // 화면 갱신 트리거
      if (typeof target.updateView === 'function') {
        target.updateView();
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function normalizeEntryValue(newValue) {
    var parsed = Number(newValue);
    return isNaN(parsed) ? String(newValue) : parsed;
  }

  function refreshVariableView(target) {
    if (target && typeof target.updateView === 'function') {
      target.updateView();
    }
  }

  function setSystemVariableValue(kind, newValue) {
    var target = getSystemVariable(kind);
    var entry = safeGetEntry();
    if (!target) {
      return { success: false, error: '해당 기본 변수를 찾을 수 없습니다: ' + kind };
    }

    try {
      var finalValue = normalizeEntryValue(newValue);

      if (kind === 'timer') {
        finalValue = Number(newValue);
        if (isNaN(finalValue)) {
          return { success: false, error: '초시계 값은 숫자로 입력해야 합니다.' };
        }

        if (entry && entry.engine && typeof entry.engine.updateProjectTimer === 'function') {
          entry.engine.updateProjectTimer(finalValue);
        } else if (typeof target.setValue === 'function') {
          target.setValue(finalValue);
        } else {
          target.value_ = finalValue;
        }
      } else if (kind === 'answer') {
        if (typeof target.setValue === 'function') {
          target.setValue(finalValue);
        } else {
          target.value_ = finalValue;
        }
      } else {
        return { success: false, error: '지원하지 않는 기본 변수입니다: ' + kind };
      }

      refreshVariableView(target);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function setSystemVariableVisible(kind, visible) {
    var target = getSystemVariable(kind);
    if (!target) {
      return { success: false, error: '해당 기본 변수를 찾을 수 없습니다: ' + kind };
    }

    try {
      var shouldShow = !!visible;
      var nextX = shouldShow ? SYSTEM_VARIABLE_SHOW_X : SYSTEM_VARIABLE_HIDE_X;
      var nextY = shouldShow ? SYSTEM_VARIABLE_SHOW_Y : SYSTEM_VARIABLE_HIDE_Y;

      // Entry 기본 변수는 visible 플래그만으로 안정적으로 숨겨지지 않는 경우가 있어
      // 화면 밖 좌표로 이동시키고, 다시 보일 때는 원점으로 돌린다.
      writeVariableVisible(target, true);
      writeVariableCoordinate(target, 'setX', 'x_', 'x', nextX);
      writeVariableCoordinate(target, 'setY', 'y_', 'y', nextY);

      refreshVariableView(target);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function findDebuggableItem(kind, id) {
    var container = safeGetContainer();
    if (!container) return null;

    var arr = kind === 'list' ? container.lists_ : container.variables_;
    if (!Array.isArray(arr)) return null;

    var item = arr.find(function (v) {
      return (v.id_ || v.id) === id;
    });

    return item ? { item: item, arr: arr } : null;
  }

  function normalizeScopeTarget(target) {
    return target === 'cloud' || target === 'real_time' || target === 'local'
      ? target
      : 'normal';
  }

  function resolveLocalObjectId(requestedObjectId) {
    if (requestedObjectId && getEntryObjectById(requestedObjectId)) {
      return requestedObjectId;
    }

    var currentObject = getCurrentObjectInfo();
    if (currentObject && currentObject.id) {
      return currentObject.id;
    }

    return requestedObjectId || null;
  }

  function refreshVariableMenus() {
    var entry = safeGetEntry();
    var container = safeGetContainer();

    if (container && typeof container.updateList === 'function') {
      container.updateList();
    }

    if (entry && entry.playground && entry.playground.blockMenu) {
      try {
        if (typeof entry.playground.blockMenu.deleteRendered === 'function') {
          entry.playground.blockMenu.deleteRendered('variable');
          entry.playground.blockMenu.deleteRendered('list');
        }
      } catch (e) {}
    }

    if (entry && entry.playground && typeof entry.playground.reloadPlayground === 'function') {
      try {
        entry.playground.reloadPlayground();
      } catch (e) {}
    }
  }

  function changeVariableScope(kind, id, target, objectId) {
    var entry = safeGetEntry();
    var container = safeGetContainer();
    if (!entry || !container) {
      return { success: false, error: 'Entry.variableContainer를 찾을 수 없습니다.' };
    }

    kind = kind === 'list' ? 'list' : 'variable';
    target = normalizeScopeTarget(target);

    var found = findDebuggableItem(kind, id);
    if (!found) {
      return { success: false, error: '해당 ID의 ' + (kind === 'list' ? '리스트' : '변수') + '를 찾을 수 없습니다: ' + id };
    }

    var localObjectId = null;
    if (target === 'local') {
      localObjectId = resolveLocalObjectId(objectId);
      if (!localObjectId || !getEntryObjectById(localObjectId)) {
        return { success: false, error: '지역 스코프로 바꿀 현재 오브젝트를 찾을 수 없습니다.' };
      }
    }

    try {
      var item = found.item;
      var arr = found.arr;
      var idx = arr.indexOf(item);
      if (idx < 0) {
        return { success: false, error: '대상 항목의 위치를 찾을 수 없습니다.' };
      }

      var json = typeof item.toJSON === 'function' ? item.toJSON() : {};
      json.id = json.id || item.id_ || item.id;
      json.name = json.name || readVariableName(item);
      json.variableType = json.variableType || getEntryVariableType(item) || kind;
      json.isCloud = target === 'cloud';
      json.isRealTime = target === 'real_time';
      json.object = target === 'local' ? localObjectId : null;

      if (!entry.Variable || typeof entry.Variable.create !== 'function') {
        return { success: false, error: 'Entry.Variable.create API를 찾을 수 없습니다.' };
      }

      var next = entry.Variable.create(json);
      arr.splice(idx, 0, next);

      if (kind === 'list') {
        if (typeof container.createListView === 'function') {
          container.createListView(next);
        }
        if (typeof next.generateView === 'function') {
          next.generateView();
        }
        if (typeof container.removeList === 'function') {
          container.removeList(item);
        } else {
          var oldListIdx = arr.indexOf(item);
          if (oldListIdx >= 0) arr.splice(oldListIdx, 1);
        }
        if (typeof container.updateSelectedVariable === 'function') {
          container.updateSelectedVariable(next, 'list');
        }
      } else {
        if (typeof container.createVariableView === 'function') {
          container.createVariableView(next);
        }
        if (typeof container.removeVariable === 'function') {
          container.removeVariable(item);
        } else {
          var oldVarIdx = arr.indexOf(item);
          if (oldVarIdx >= 0) arr.splice(oldVarIdx, 1);
        }
        if (typeof container.updateSelectedVariable === 'function') {
          container.updateSelectedVariable(next);
        }
        if (typeof next.generateView === 'function') {
          next.generateView();
        }
      }

      refreshVariableMenus();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function setListItem(listId, index, newValue) {
    var container = safeGetContainer();
    if (!container || !Array.isArray(container.lists_)) {
      return { success: false, error: 'Entry.variableContainer를 찾을 수 없습니다.' };
    }

    var target = container.lists_.find(function (l) {
      return (l.id_ || l.id) === listId;
    });

    if (!target) {
      return { success: false, error: '해당 ID의 리스트를 찾을 수 없습니다: ' + listId };
    }

    if (!Array.isArray(target.array_) || index < 0 || index >= target.array_.length) {
      return { success: false, error: '인덱스가 범위를 벗어났습니다: ' + index };
    }

    try {
      var parsed = Number(newValue);
      var finalValue = isNaN(parsed) ? String(newValue) : parsed;

      if (typeof target.array_[index] === 'object' && target.array_[index] !== null) {
        target.array_[index].data = finalValue;
      } else {
        target.array_[index] = { data: finalValue };
      }

      if (typeof target.updateView === 'function') {
        target.updateView();
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function addListItem(listId, value) {
    var container = safeGetContainer();
    if (!container || !Array.isArray(container.lists_)) {
      return { success: false, error: 'Entry.variableContainer를 찾을 수 없습니다.' };
    }

    var target = container.lists_.find(function (l) {
      return (l.id_ || l.id) === listId;
    });

    if (!target) {
      return { success: false, error: '해당 ID의 리스트를 찾을 수 없습니다: ' + listId };
    }

    try {
      var parsed = Number(value);
      var finalValue = isNaN(parsed) ? String(value) : parsed;

      if (!Array.isArray(target.array_)) {
        target.array_ = [];
      }
      target.array_.push({ data: finalValue });

      if (typeof target.updateView === 'function') {
        target.updateView();
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function removeListItem(listId, index) {
    var container = safeGetContainer();
    if (!container || !Array.isArray(container.lists_)) {
      return { success: false, error: 'Entry.variableContainer를 찾을 수 없습니다.' };
    }

    var target = container.lists_.find(function (l) {
      return (l.id_ || l.id) === listId;
    });

    if (!target || !Array.isArray(target.array_)) {
      return { success: false, error: '해당 ID의 리스트를 찾을 수 없습니다: ' + listId };
    }

    if (index < 0 || index >= target.array_.length) {
      return { success: false, error: '인덱스가 범위를 벗어났습니다: ' + index };
    }

    try {
      target.array_.splice(index, 1);

      if (typeof target.updateView === 'function') {
        target.updateView();
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function generateEntryHash(entry) {
    if (entry && typeof entry.generateHash === 'function') {
      return entry.generateHash();
    }
    return Math.random().toString(36).slice(2, 10);
  }

  function mapDynamicParamType(type, typeMap, entry) {
    if (typeof type !== 'string') return type;
    if (type.indexOf('stringParam_') === 0) {
      if (!typeMap[type]) typeMap[type] = 'stringParam_' + generateEntryHash(entry);
      return typeMap[type];
    }
    if (type.indexOf('booleanParam_') === 0) {
      if (!typeMap[type]) typeMap[type] = 'booleanParam_' + generateEntryHash(entry);
      return typeMap[type];
    }
    return type;
  }

  function cloneFunctionLibraryModel(entry, sourceFunc) {
    if (!sourceFunc || !sourceFunc.content) {
      throw new Error('함수 템플릿 데이터가 비어 있습니다.');
    }

    var cloned = deepClone(sourceFunc);
    var originalFuncId = cloned.id || '';
    var nextFuncId = generateEntryHash(entry);
    var localVariableIdMap = {};
    var dynamicTypeMap = {};

    cloned.id = nextFuncId;
    cloned.localVariables = Array.isArray(cloned.localVariables)
      ? cloned.localVariables.map(function (localVariable) {
        var nextLocalVariable = deepClone(localVariable);
        var oldId = nextLocalVariable.id;
        nextLocalVariable.id = nextFuncId + '_' + generateEntryHash(entry);
        if (oldId) {
          localVariableIdMap[oldId] = nextLocalVariable.id;
        }
        return nextLocalVariable;
      })
      : [];

    var content = typeof cloned.content === 'string'
      ? JSON.parse(cloned.content)
      : deepClone(cloned.content);

    function mapString(value) {
      if (localVariableIdMap[value]) return localVariableIdMap[value];
      if (originalFuncId && value === 'func_' + originalFuncId) return 'func_' + nextFuncId;
      return mapDynamicParamType(value, dynamicTypeMap, entry);
    }

    function remapNode(node) {
      if (Array.isArray(node)) {
        node.forEach(function (value, index) {
          if (typeof value === 'string') {
            node[index] = mapString(value);
          } else {
            remapNode(value);
          }
        });
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }

      if (typeof node.id === 'string') {
        node.id = generateEntryHash(entry);
      }
      if (typeof node.type === 'string') {
        if (originalFuncId && node.type === 'func_' + originalFuncId) {
          node.type = 'func_' + nextFuncId;
        } else {
          node.type = mapDynamicParamType(node.type, dynamicTypeMap, entry);
        }
      }

      Object.keys(node).forEach(function (key) {
        if (key === 'id' || key === 'type') return;
        var value = node[key];
        if (typeof value === 'string') {
          node[key] = mapString(value);
        } else {
          remapNode(value);
        }
      });
    }

    remapNode(content);
    cloned.content = JSON.stringify(content);
    return cloned;
  }

  function refreshFunctionLibraryViews(entry, container) {
    if (container && typeof container.updateList === 'function') {
      try {
        container.updateList();
      } catch (e) {}
    }

    if (entry && entry.playground && entry.playground.blockMenu) {
      var blockMenu = entry.playground.blockMenu;
      try {
        if (typeof blockMenu.deleteRendered === 'function') {
          blockMenu.deleteRendered('func');
        }
        if (typeof blockMenu.align === 'function') {
          blockMenu.align();
        }
      } catch (e) {}
    }

    if (entry && entry.Func && typeof entry.Func.updateMenu === 'function') {
      try {
        entry.Func.updateMenu();
      } catch (e) {}
    }
  }

  function addFunctionLibraryTemplate(payload) {
    var entry = safeGetEntry();
    var container = safeGetContainer();

    if (!entry || !container || !entry.Func) {
      return { success: false, error: 'Entry 함수 API를 찾을 수 없습니다.' };
    }
    if (entry.Func.isEdit) {
      return { success: false, error: '함수 편집 중에는 추가할 수 없습니다.' };
    }
    if (entry.engine && typeof entry.engine.isState === 'function' && entry.engine.isState('run')) {
      return { success: false, error: '작품 실행 중에는 추가할 수 없습니다.' };
    }

    try {
      var clonedModel = cloneFunctionLibraryModel(entry, payload && payload.func);
      var func = new entry.Func(clonedModel);

      if (typeof container.changeFunctionName === 'function') {
        container.changeFunctionName(func);
      }
      if (typeof func.generateBlock === 'function') {
        func.generateBlock();
      }
      if (typeof container.saveFunction === 'function') {
        container.saveFunction(func);
      } else {
        container.functions_[func.id] = func;
      }

      refreshFunctionLibraryViews(entry, container);

      return {
        success: true,
        id: func.id,
        name: (payload && payload.templateName) || func.description || '함수',
        description: func.description || ''
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /* ───────── 엔트리 네이티브 토스트 ───────── */

  function showEntryToast(payload) {
    var entry = safeGetEntry();
    var toast = entry && entry.toast;
    if (!toast || !payload) return;
    var type = payload.type;
    if (type !== 'success' && type !== 'warning' && type !== 'alert') {
      type = 'success';
    }
    if (typeof toast[type] !== 'function') return;
    try {
      toast[type](payload.title || '', payload.message || '');
    } catch (e) {}
  }

  /* ───────── 메시지 수신 핸들러 ───────── */

  onMessage(function (msg) {
    var result;

    switch (msg.type) {
      case 'START_POLLING':
        startPolling();
        break;

      case 'STOP_POLLING':
        stopPolling();
        break;

      case 'REQUEST_SNAPSHOT':
        forceResync();
        break;

      case 'SET_VARIABLE':
        result = setVariableValue(msg.payload.id, msg.payload.value);
        post('SET_RESULT', result, msg.requestId);
        // 즉시 스냅샷 갱신
        forceResync();
        break;

      case 'SET_SYSTEM_VARIABLE':
        result = setSystemVariableValue(msg.payload.kind, msg.payload.value);
        post('SET_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'SET_SYSTEM_VISIBLE':
        result = setSystemVariableVisible(msg.payload.kind, msg.payload.visible);
        post('SET_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'CHANGE_VARIABLE_SCOPE':
        result = changeVariableScope(
          msg.payload.kind,
          msg.payload.id,
          msg.payload.scope,
          msg.payload.objectId
        );
        post('SET_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'SET_LIST_ITEM':
        result = setListItem(msg.payload.listId, msg.payload.index, msg.payload.value);
        post('SET_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'ADD_LIST_ITEM':
        result = addListItem(msg.payload.listId, msg.payload.value);
        post('SET_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'REMOVE_LIST_ITEM':
        result = removeListItem(msg.payload.listId, msg.payload.index);
        post('SET_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'CHANGE_SCENE':
        var sceneEntry = safeGetEntry();
        result = { success: false, error: 'Entry.scene을 찾을 수 없습니다.' };
        if (sceneEntry && sceneEntry.scene) {
          try {
            var sceneId = msg.payload.id;
            var allScenes = sceneEntry.scene.scenes_ ||
              (typeof sceneEntry.scene.getScenes === 'function' ? sceneEntry.scene.getScenes() : []);

            // ID로 장면 객체 검색
            var targetScene = null;
            if (Array.isArray(allScenes)) {
              targetScene = allScenes.find(function (s) { return s.id === sceneId; });
            }

            if (!targetScene) {
              result = { success: false, error: '해당 ID의 장면을 찾을 수 없습니다: ' + sceneId };
            } else {
              // 1. 화면(UI)을 선택한 장면으로 전환 (객체를 전달)
              sceneEntry.scene.selectScene(targetScene);

              // 2. 작품이 실행 중일 경우, '장면이 시작되었을 때' 이벤트를 강제 트리거
              //    selectScene 직후 오브젝트 초기화 시간 확보를 위해 setTimeout 사용.
              //    engine.fireEvent('when_scene_start')가 블록 이벤트를 정확히 깨움.
              //    (raiseEvent('scene_start')는 내부 entity.script 접근 문제로 사용 불가)
              if (sceneEntry.engine && sceneEntry.engine.isState('run')) {
                (function (eng, ent) {
                  setTimeout(function () {
                    try {
                      if (typeof eng.fireEvent === 'function') {
                        eng.fireEvent('when_scene_start');
                      } else if (typeof ent.dispatchEvent === 'function') {
                        ent.dispatchEvent('scene_start');
                      }
                    } catch (evt_err) {
                      console.warn('[Entry Debugger] scene_start 이벤트 트리거 실패:', evt_err.message);
                    }
                  }, 150);
                })(sceneEntry.engine, sceneEntry);
              }

              result = { success: true };
            }
          } catch (e) {
            result = { success: false, error: e.message };
            console.error('[Entry Debugger] 장면 전환 오류:', e);
          }
        }
        post('CHANGE_SCENE_RESULT', result, msg.requestId);
        // 장면 전환 후 스냅샷 즉시 갱신
        forceResync();
        break;

      case 'RAISE_MESSAGE':
        result = raiseMessage(msg.payload.id);
        post('RAISE_RESULT', result, msg.requestId);
        break;

      case 'ADD_FUNCTION_LIBRARY_TEMPLATE':
        result = addFunctionLibraryTemplate(msg.payload || {});
        post('ADD_FUNCTION_LIBRARY_TEMPLATE_RESULT', result, msg.requestId);
        forceResync();
        break;

      case 'SHOW_ENTRY_TOAST':
        showEntryToast(msg.payload);
        break;

      case 'PING':
        var entry = safeGetEntry();
        post('PONG', {
          entryReady: !!entry,
          containerReady: !!safeGetContainer()
        });
        break;
    }
  });

  // 주입 완료 신호
  post('INJECT_READY');

})();
