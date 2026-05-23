# 변수/리스트 스코프 타입 변경 확장 기록

확인 날짜: 2026-05-23

대상 기능: 디버깅 탭의 `변수`, `리스트` 탭에서 각 항목의 스코프를 `일반`, `공유`, `실시간`, `지역: 오브젝트명`으로 표시하고 변경한다.

분석 대상:

- `entryjs-develop/src/class/variable/variable.js`
- `entryjs-develop/src/class/variable/listVariable.js`
- `entryjs-develop/src/class/variable_container.js`
- `entry-debugger-extension/inject.js`
- `entry-debugger-extension/content.js`
- `entry-debugger-extension/style.css`

## 1. 데이터 모델

Entry 변수/리스트의 스코프는 `isCloud`, `isRealTime`, `object` 세 필드 조합으로 결정된다.

| UI 라벨 | 내부 키 | `isCloud` | `isRealTime` | `object` |
|---|---|---|---|---|
| 일반 | `normal` | `false` | `false` | `null` |
| 공유 | `cloud` | `true` | `false` | `null` |
| 실시간 | `real_time` | `false` | `true` | `null` |
| 지역: 오브젝트명 | `local` | `false` | `false` | 오브젝트 id |

불변식:

- `isCloud`와 `isRealTime`은 동시에 `true`가 되면 안 된다.
- `object`가 있으면 `isCloud`, `isRealTime`은 모두 `false`여야 한다.
- 공유, 실시간, 지역 중 최대 1개만 활성화한다.
- `variableType`은 스코프와 별개이므로 변경하지 않는다.

직교 관계:

- `variableType`은 `variable`, `list`, `slide`, `timer`, `answer` 같은 자료 종류를 나타낸다.
- 스코프 전환은 `variableType`을 바꾸면 안 된다.
- 이름으로 스코프를 추론하지 않는다.

## 2. Entry 원본에서 확인한 사실

`variable.js` 생성자는 `object`, `isCloud`, `isRealTime`을 독립 필드로 읽는다.

```js
this.object_ = variable.object || null;
this.isCloud_ = variable.isCloud || false;
this.isRealTime_ = variable.isRealTime || false;
```

`Variable.toJSON()`은 세 필드를 그대로 저장한다.

```js
json.isCloud = this.isCloud_;
json.isRealTime = this.isRealTime_;
json.object = this.object_;
```

`listVariable.js`의 `toJSON()`은 `super.toJSON()` 결과에 리스트 크기와 배열을 추가한다. 따라서 리스트도 같은 스코프 필드 조합을 사용하고, `array`는 `toJSON()`으로 자동 보존된다.

## 3. 기존 Entry 기능의 한계

Entry 본체의 `variableAddSetCloud`, `variableAddSetScope` 명령은 변수/리스트 추가 패널의 입력 상태를 바꾸는 용도다. 이미 만들어진 변수/리스트의 스코프를 바꾸는 공식 API는 확인되지 않았다.

이미 생성된 항목을 안전하게 바꾸려면 `variable_container.js`의 `setVariableSlidable()` 패턴처럼 기존 모델을 `toJSON()`으로 복사하고, 필요한 필드만 바꾼 새 인스턴스를 같은 id로 만들어 교체하는 방식이 가장 가깝다.

## 4. 확장 구현

파일: `entry-debugger-extension/inject.js`

- `serializeScope()`를 추가해 변수/리스트 스냅샷에 `scope` 객체를 포함한다.
- `scope`에는 `key`, `label`, `objectId`, `objectName`, `currentObjectId`, `currentObjectName`을 담는다.
- 지역 변수/리스트의 오브젝트 이름은 `Entry.container.getObject(objectId)`로 찾고, 없으면 id를 fallback으로 표시한다.
- 새 메시지 `CHANGE_VARIABLE_SCOPE`를 추가했다.
- 스코프 변경은 `toJSON()`으로 기존 모델을 보존한 뒤 `isCloud/isRealTime/object` 세 필드만 갱신하고 `Entry.Variable.create(json)`으로 같은 id의 새 인스턴스를 만든다.
- 변수는 `variables_`, 리스트는 `lists_`의 원래 위치에 새 인스턴스를 끼워 넣은 뒤 기존 인스턴스를 `removeVariable()` 또는 `removeList()`로 제거한다.
- 변경 후 `updateList()`, `blockMenu.deleteRendered()`, `reloadPlayground()`를 호출해 속성 패널과 블록 메뉴를 갱신한다.

파일: `entry-debugger-extension/content.js`

- 기존 `모든 오브젝트`/`지역` 배지를 `select.ed-scope-select`로 교체했다.
- 변수 카드와 리스트 헤더 모두 같은 스코프 선택 UI를 사용한다.
- `지역`으로 변경할 때는 현재 선택된 오브젝트 id(`Entry.playground.object.id`)를 메시지에 실어 보낸다.
- 리스트 헤더 안의 select 클릭은 펼침/접힘 토글로 전파되지 않게 막았다.

파일: `entry-debugger-extension/style.css`

- `.ed-scope-select`를 추가해 기존 배지 위치에 드롭다운을 배치했다.
- 타입별 색상은 `normal`, `cloud`, `real_time`, `local` 클래스로 분리했다.

## 5. 메시지 형식

```js
sendToInject('CHANGE_VARIABLE_SCOPE', {
  kind: 'variable',        // 또는 'list'
  id: '<variable-or-list-id>',
  scope: 'normal',         // 'normal' | 'cloud' | 'real_time' | 'local'
  objectId: '<object-id>'  // scope === 'local' 일 때 사용
});
```

## 6. 변경 알고리즘

```js
const json = item.toJSON();

json.isCloud = target === 'cloud';
json.isRealTime = target === 'real_time';
json.object = target === 'local' ? objectId : null;

const next = Entry.Variable.create(json);
arr.splice(index, 0, next);

if (kind === 'list') {
  Entry.variableContainer.createListView(next);
  next.generateView();
  Entry.variableContainer.removeList(item);
  Entry.variableContainer.updateSelectedVariable(next, 'list');
} else {
  Entry.variableContainer.createVariableView(next);
  Entry.variableContainer.removeVariable(item);
  Entry.variableContainer.updateSelectedVariable(next);
  next.generateView();
}
```

핵심:

- `json.id`를 그대로 유지한다.
- `json.variableType`을 그대로 유지한다.
- `isCloud`, `isRealTime`, `object` 세 필드를 항상 동시에 덮어쓴다.

## 7. 주의점

- 지역으로 바꿀 현재 오브젝트를 찾을 수 없으면 변경하지 않고 오류를 표시한다.
- 공유/실시간/지역 중 하나만 활성화되도록 세 필드를 매번 모두 덮어쓴다.
- id를 보존하므로 기존 블록의 변수/리스트 참조는 유지된다.
- 실시간 변수/리스트는 Entry 내부 동기화 타이밍에 따라 전환 직후 값이 stale일 수 있다.
- 클라우드 서버 동기화는 별도 영역이다. 확장 변경은 편집기 로컬 모델을 우선 갱신한다.
- Undo/Redo 통합은 아직 구현하지 않았다. 필요하면 Entry command 패턴으로 별도 명령을 추가해야 한다.

## 8. 검증 기록

정적 검사:

```powershell
node --check "Entry Debugger/entry-debugger-extension/inject.js"
node --check "Entry Debugger/entry-debugger-extension/content.js"
```

스모크 테스트:

- 가짜 Entry 모델에서 변수 `normal -> cloud` 전환 확인
- 가짜 Entry 모델에서 리스트 `normal -> local` 전환 확인
- 전환 후 id 보존 확인
- 스냅샷의 `scope.key`, `scope.objectName` 갱신 확인
