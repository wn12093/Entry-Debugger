# Entry 속성 사용 위치 추적 분석

확인 날짜: 2026-05-23  
분석 대상: `C:\Users\young\prg\html\엔트리확프\entryjs-develop`

## 요약

Entry의 속성 패널에서 변수, 리스트, 신호, 함수가 어디에서 사용되는지 보여주는 기능은 `Entry.variableContainer`가 중심입니다. 별도 검색 인덱스를 매번 새로 만드는 방식이 아니라, 참조 가능한 블록이 생성될 때 `_variableRefs`, `_messageRefs`, `_functionRefs` 배열에 블록 참조를 등록하고, 속성 항목을 펼칠 때 현재 블록 `params` 또는 블록 `type`을 기준으로 필터링합니다.

속성 항목을 펼치면 "사용된 오브젝트 (블록 n개)" 목록이 생기고, 각 항목은 오브젝트 썸네일, 오브젝트 이름, 사용 블록 이름을 표시합니다. 목록 항목을 클릭하면 해당 오브젝트로 전환하고 해당 블록을 선택 상태로 만듭니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `src/class/variable_container.js` | 속성 패널 UI, 참조 배열, 사용 위치 렌더링, 클릭 이동 처리 |
| `src/playground/blocks/block_variable.js` | 변수와 리스트 관련 블록이 `_variableRefs`에 등록되도록 이벤트 정의 |
| `src/playground/blocks/block_start.js` | 신호 관련 블록이 `_messageRefs`에 등록되도록 이벤트 정의 |
| `src/playground/blocks/block_func.js` | 함수 호출 블록이 `_functionRefs`에 등록되도록 이벤트 정의 |
| `src/playground/block.js` | 블록 생성/삭제 시 `dataAdd`, `dataDestroy`, `viewDestroy` 이벤트 실행 |
| `src/playground/code.js` | 함수 내부 검색에 쓰이는 `findById`, `findByType`, `findByParamId` 제공 |
| `src/class/function.js` | 함수 정의의 별도 `Entry.Code`와 함수 내부 블록 검색 래퍼 제공 |
| `extern/util/static.js` | 변수/리스트/신호 사용 블록 타입 목록 정의 |
| `extern/lang/ko.js` | "사용된 오브젝트", "함수에 조립되어 있어요" 같은 표시 문구 |

## 데이터 구조

`Entry.VariableContainer` 생성자에서 속성 데이터와 참조 배열이 초기화됩니다.

```js
this.variables_ = [];
this.messages_ = [];
this.lists_ = [];
this.functions_ = {};
this._variableRefs = [];
this._messageRefs = [];
this._functionRefs = [];
```

참조 배열의 원소는 `addRef(type, blockData)`에서 만들어지며 형태는 다음과 같습니다.

```js
{
  object: blockData.getCode().object,
  block: blockData
}
```

즉 "어떤 오브젝트의 어떤 블록인가"는 `block.getCode().object`와 `block` 자체에서 바로 얻습니다. 변수 ID나 신호 ID를 별도 필드로 저장하지 않고, 렌더링 시점에 `block.params`를 다시 봅니다.

## 참조 등록 흐름

1. `Entry.Block`가 만들어지면 `code.registerBlock(this)` 후 `code.object`가 있는 경우 블록 스키마의 `events.dataAdd`가 실행됩니다.
2. 변수/리스트/신호/함수 호출 블록 스키마는 `dataAdd`에서 `Entry.variableContainer.addRef(...)`를 호출합니다.
3. 블록이 삭제되거나 뷰가 파괴될 때 `dataDestroy` 또는 `viewDestroy`에서 `removeRef(...)`를 호출합니다.
4. `addRef`와 `removeRef`는 메인 워크스페이스가 보드 모드(`Entry.Workspace.MODE_BOARD`)일 때만 동작합니다.

대표 예시는 `get_variable` 블록입니다.

```js
events: {
  dataAdd: [
    function(block) {
      Entry.variableContainer.addRef('_variableRefs', block);
    },
  ],
  dataDestroy: [
    function(block) {
      Entry.variableContainer.removeRef('_variableRefs', block);
    },
  ],
}
```

### 등록 대상 블록

`extern/util/static.js` 기준 변수/리스트 계열은 다음 타입이 사용 블록으로 간주됩니다.

```js
[
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
]
```

신호 계열은 `when_message_cast`, `message_cast`, `message_cast_wait`입니다.

함수 호출은 함수마다 `func_${functionId}` 타입의 동적 블록 스키마가 만들어지고, 이 블록들이 `_functionRefs`에 들어갑니다.

## 속성 패널 렌더링 흐름

속성 목록에서 항목을 선택하면 `VariableContainer.select(object)`가 대상 타입에 따라 다음 렌더링 함수를 호출합니다.

- 변수와 리스트: `renderVariableReference(variable)`
- 신호: `renderMessageReference(message)`
- 함수: `renderFunctionReference(func)`

변수/리스트와 신호는 참조 배열을 `params`로 필터링합니다.

```js
const callers = this._variableRefs.filter(({ block: { params } }) =>
  _includes(params, variableId)
);
```

신호도 같은 방식으로 `_messageRefs`에서 `messageId`가 들어있는 블록을 찾습니다.

함수는 호출 블록의 타입을 기준으로 필터링합니다.

```js
const callers = [...this._functionRefs].filter(
  (item) => item.block.data.type === `func_${funcId}`
);
```

목록 문구는 `extern/lang/ko.js`의 다음 키를 사용합니다.

- `use_block_objects1`: `사용된 오브젝트 (블록 {0}개)`
- `use_block_objects2`: `사용된 오브젝트`
- `no_use`: `아직 오브젝트에 조립되지 않았어요.`
- `use_block_function`: `함수에 조립되어 있어요.`

## 사용 위치 클릭 동작

사용 목록 항목을 클릭하면 다음 순서로 이동합니다.

1. 현재 오브젝트와 사용 블록의 오브젝트가 다르면 `Entry.container.selectObject(caller.object.id, true)`로 오브젝트를 바꿉니다.
2. `caller.block.view.getBoard()`로 보드를 얻습니다.
3. `board.setSelectedBlock(block.view)`로 해당 블록을 선택 표시합니다.
4. `Entry.playground.toggleOnVariableView()`와 `Entry.playground.changeViewMode('variable')`로 속성 패널 상태를 유지합니다.

주의할 점은 기본 구현이 `board.activateBlock(block)`을 쓰지 않는다는 것입니다. `setSelectedBlock`은 선택 표시를 붙이지만 블록을 화면 중앙으로 스크롤하는 동작은 하지 않습니다. 런타임 오류 이동 기능에서는 `board.activateBlock(block)`을 써서 스크롤과 강조를 함께 처리합니다.

## 함수 내부 사용 처리

함수 정의는 일반 오브젝트 코드와 별도인 `Entry.Func.content`의 `Entry.Code`에 들어갑니다. 이 코드는 `code.object`가 없으므로 블록 생성 시 `_variableRefs`나 `_messageRefs`에 등록되지 않습니다.

대신 속성 패널은 함수 내부 사용 여부만 별도로 검사합니다.

```js
hasParamBlockInFunction = _memoize((paramId) =>
  _some(this.functions_, (func) => Boolean(func.getBlockByParamId(paramId)))
);

hasFuncBlockInFunction = _memoize((funcId) =>
  _some(this.functions_, (func) => Boolean(func.getFuncBlockByFuncId(`func_${funcId}`)))
);
```

이 값이 참이면 목록 아래에 `함수에 조립되어 있어요.` 문구가 추가됩니다. 즉 기본 기능은 함수 내부에서 변수/리스트/신호를 썼다는 사실은 보여주지만, "어떤 함수의 몇 번째 블록인지"나 "그 함수를 호출하는 오브젝트까지 역추적한 사용 위치"는 바로 보여주지 않습니다.

함수 저장 시 `saveFunction(func)`에서 메모이즈 캐시를 비웁니다.

```js
this.hasBlockInFunction.cache.clear();
this.hasParamBlockInFunction.cache.clear();
this.hasFuncBlockInFunction.cache.clear();
```

## Entry Debugger에서 활용할 포인트

확장 프로그램에서 사용 위치를 만들 때 선택지는 두 가지입니다.

1. Entry 기본 참조 배열 재사용

   `Entry.variableContainer._variableRefs`, `_messageRefs`, `_functionRefs`를 읽으면 기본 UI와 같은 기준의 사용 블록을 얻을 수 있습니다. 단, content script의 isolated world에서는 페이지의 `Entry` 객체에 직접 접근이 안 될 수 있으므로 페이지 컨텍스트에 주입한 스크립트나 브리지 이벤트가 필요합니다.

2. 프로젝트 코드 직접 순회

   더 정확한 디버거 기능에는 직접 순회가 더 안정적입니다. 각 오브젝트의 `object.script.getBlockList()` 또는 코드의 thread/block 순회를 통해 `block.params`와 `block.type`을 검사하면 변수 패널 초기화 여부나 보드 모드에 덜 의존합니다. 함수 내부는 `Entry.variableContainer.functions_[id].content.getBlockList()`를 재귀적으로 순회해야 합니다.

디버거가 기본 기능보다 더 잘할 수 있는 부분은 다음입니다.

- 사용 블록의 `block.id`, `block.type`, `block.pointer()`를 함께 저장하기
- `block.view.getAbsoluteCoordinate()` 또는 보드 좌표를 저장해 클릭 시 `board.activateBlock(block)`로 스크롤과 강조를 같이 하기
- 함수 내부 사용을 함수명, 함수 블록 ID, 호출 오브젝트까지 재귀적으로 펼치기
- 변수/리스트/신호/함수별 사용 그래프를 하나의 공통 모델로 정규화하기

## 참고한 코드 위치

- `src/class/variable_container.js:54` - `_variableRefs`, `_messageRefs`, `_functionRefs` 초기화
- `src/class/variable_container.js:283` - 신호 사용 위치 렌더링
- `src/class/variable_container.js:359` - 변수/리스트 사용 위치 렌더링
- `src/class/variable_container.js:733` - 함수 사용 위치 렌더링
- `src/class/variable_container.js:3250` - `addRef`
- `src/class/variable_container.js:3266` - `removeRef`
- `src/class/variable_container.js:3604` - 함수 내부 블록 검색 유틸
- `src/class/function.js:196` - 함수 코드의 `getBlockById`, `getFuncBlockByFuncId`, `getBlockByParamId`
- `src/playground/block.js:51` - 블록 생성 시 `dataAdd` 실행
- `src/playground/block.js:460` - 블록 삭제 시 `dataDestroy` 실행
- `src/playground/block_view.js:945` - 뷰 파괴 시 `viewDestroy` 실행
- `src/playground/code.js:371` - `findById`, `findByType`, `findByParamId`
- `src/playground/board.js:358` - `setSelectedBlock`
- `src/playground/board.js:1050` - `activateBlock`
- `extern/util/static.js:11` - 변수/리스트 사용 블록 타입 목록
- `extern/util/static.js:28` - 신호 사용 블록 타입 목록
