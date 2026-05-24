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
  let pollingTimer = null;
  let isPolling = false;

  /* ───────── 유틸리티 ───────── */

  function safeGetEntry() {
    try {
      return window.Entry || null;
    } catch {
      return null;
    }
  }

  function safeGetContainer() {
    const entry = safeGetEntry();
    return entry && entry.variableContainer ? entry.variableContainer : null;
  }

  /**
   * 변수 배열을 직렬화 가능한 형태로 변환
   */
  function serializeVariables(vars) {
    if (!Array.isArray(vars)) return [];
    return vars.map(function (v) {
      return {
        id: v.id_ || v.id || '',
        name: v.name_ || v.name || '(이름 없음)',
        value: typeof v.getValue === 'function' ? v.getValue() : v.value_,
        type: 'variable',
        visible: v.visible_ !== false,
        object: v.object_ || null
      };
    });
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
        object: l.object_ || null
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
      return { variables: [], lists: [], messages: [], ready: false };
    }
    return {
      variables: serializeVariables(container.variables_ || []),
      lists: serializeLists(container.lists_ || []),
      messages: serializeMessages(container.messages_ || []),
      scenes: serializeScenes(),
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
      window.postMessage({
        channel: CHANNEL,
        type: 'SNAPSHOT',
        payload: snapshot
      }, window.location.origin);
    }
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

  /**
   * 내장 생성기에서 만든 오브젝트 모델을 현재 Entry 편집기에 직접 추가합니다.
   * .eo 다운로드와 별개로, 파일은 data URL을 사용해 현재 세션에서 바로 보이게 합니다.
   */
  function addGeneratedObject(payload) {
    var entry = safeGetEntry();
    if (!entry || !entry.container) {
      return { success: false, error: 'Entry.container를 찾을 수 없습니다.' };
    }
    if (!payload || !payload.object) {
      return { success: false, error: '추가할 오브젝트 데이터가 없습니다.' };
    }

    try {
      var objectModel = payload.object;
      if (entry.scene && entry.scene.selectedScene) {
        objectModel.scene = entry.scene.selectedScene.id;
      }
      if (!objectModel.scene && entry.scene && typeof entry.scene.getScenes === 'function') {
        var scenes = entry.scene.getScenes();
        if (scenes && scenes[0]) objectModel.scene = scenes[0].id;
      }
      if (!objectModel.scene && entry.scene && entry.scene.scenes_ && entry.scene.scenes_[0]) {
        objectModel.scene = entry.scene.scenes_[0].id;
      }

      if (!objectModel.scene) {
        return { success: false, error: '추가할 장면을 찾을 수 없습니다.' };
      }

      if (typeof entry.container.addObject === 'function') {
        entry.container.addObject(objectModel, 0);
      } else if (typeof entry.container.addObjectFunc === 'function') {
        entry.container.addObjectFunc(objectModel, 0);
      } else {
        return { success: false, error: '오브젝트 추가 API를 찾을 수 없습니다.' };
      }

      if (entry.toast && typeof entry.toast.alert === 'function') {
        entry.toast.alert('Entry Debugger', '오브젝트를 추가했습니다.');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  }

  /* ───────── 메시지 수신 핸들러 ───────── */

  window.addEventListener('message', function (event) {
    // origin 검증
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    var msg = event.data;
    var result;

    switch (msg.type) {
      case 'START_POLLING':
        startPolling();
        break;

      case 'STOP_POLLING':
        stopPolling();
        break;

      case 'REQUEST_SNAPSHOT':
        prevSnapshotJSON = ''; // 강제 재전송
        pollAndBroadcast();
        break;

      case 'SET_VARIABLE':
        result = setVariableValue(msg.payload.id, msg.payload.value);
        window.postMessage({
          channel: CHANNEL,
          type: 'SET_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        // 즉시 스냅샷 갱신
        prevSnapshotJSON = '';
        pollAndBroadcast();
        break;

      case 'SET_LIST_ITEM':
        result = setListItem(msg.payload.listId, msg.payload.index, msg.payload.value);
        window.postMessage({
          channel: CHANNEL,
          type: 'SET_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        prevSnapshotJSON = '';
        pollAndBroadcast();
        break;

      case 'ADD_LIST_ITEM':
        result = addListItem(msg.payload.listId, msg.payload.value);
        window.postMessage({
          channel: CHANNEL,
          type: 'SET_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        prevSnapshotJSON = '';
        pollAndBroadcast();
        break;

      case 'REMOVE_LIST_ITEM':
        result = removeListItem(msg.payload.listId, msg.payload.index);
        window.postMessage({
          channel: CHANNEL,
          type: 'SET_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        prevSnapshotJSON = '';
        pollAndBroadcast();
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
        window.postMessage({
          channel: CHANNEL,
          type: 'CHANGE_SCENE_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        // 장면 전환 후 스냅샷 즉시 갱신
        prevSnapshotJSON = '';
        pollAndBroadcast();
        break;

      case 'RAISE_MESSAGE':
        result = raiseMessage(msg.payload.id);
        window.postMessage({
          channel: CHANNEL,
          type: 'RAISE_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        break;

      case 'ADD_GENERATED_OBJECT':
        result = addGeneratedObject(msg.payload);
        window.postMessage({
          channel: CHANNEL,
          type: 'ADD_GENERATED_OBJECT_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
        prevSnapshotJSON = '';
        pollAndBroadcast();
        break;

      case 'PING':
        var entry = safeGetEntry();
        window.postMessage({
          channel: CHANNEL,
          type: 'PONG',
          payload: {
            entryReady: !!entry,
            containerReady: !!safeGetContainer()
          }
        }, window.location.origin);
        break;
    }
  });

  // 주입 완료 신호
  window.postMessage({
    channel: CHANNEL,
    type: 'INJECT_READY'
  }, window.location.origin);

})();
