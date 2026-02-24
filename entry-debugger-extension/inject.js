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
      ready: true
    };
  }

  /* ───────── 폴링 기반 실시간 동기화 ───────── */

  let prevSnapshotJSON = '';

  function pollAndBroadcast() {
    var snapshot = buildSnapshot();
    var json = JSON.stringify(snapshot);

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

  function startPolling() {
    if (isPolling) return;
    isPolling = true;
    prevSnapshotJSON = '';
    pollingTimer = setInterval(pollAndBroadcast, POLL_INTERVAL);
    // 즉시 한 번 실행
    pollAndBroadcast();
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

      case 'RAISE_MESSAGE':
        result = raiseMessage(msg.payload.id);
        window.postMessage({
          channel: CHANNEL,
          type: 'RAISE_RESULT',
          payload: result,
          requestId: msg.requestId
        }, window.location.origin);
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
