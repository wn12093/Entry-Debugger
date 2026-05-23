# 함수 내부 사용 위치 확장 설계

확인 날짜: 2026-05-23  
대상 확장: `entry-debugger-extension`

## 목표

Entry 기본 속성 패널은 변수, 리스트, 신호, 함수가 함수 내부에서 사용된 경우 `함수에 조립되어 있어요.`라고만 표시한다. Entry Debugger는 이 기본 UI와 별도로 다음 정보를 보여준다.

- 어떤 변수/리스트/신호/함수가 함수 안에서 사용됐는지
- 어떤 함수 안의 어떤 블록에서 사용됐는지
- Entry 기본 속성 패널의 `사용된 오브젝트` 영역 아래에서 바로 확인할 수 있는지
- 표시된 위치를 클릭하면 해당 함수 편집 화면으로 이동해 대상 블록을 선택/강조할 수 있는지

## 구현 원칙

- Entry 원본 UI와 `Entry.variableContainer` 동작을 변경하지 않는다.
- 기존 `inject.js`의 변수/리스트/신호 값 수정 기능과 분리한다.
- 함수 내부 참조 분석은 별도 Main World 스크립트인 `function-usage-inspector.js`가 담당한다.
- content script는 Main World 스크립트 주입과 확장 활성/비활성 메시지만 담당한다.
- 상세 UI는 별도 패널이나 탭을 만들지 않고, `function-usage-inspector.js`가 Entry 속성 DOM 아래에 직접 삽입한다.

## 추가된 파일과 연결

| 파일 | 역할 |
| --- | --- |
| `entry-debugger-extension/function-usage-inspector.js` | 함수 내부 블록을 순회해 사용 위치 인덱스 생성, Entry 네이티브 속성 패널에 `함수에서 사용` 섹션 삽입 |
| `entry-debugger-extension/content.js` | `function-usage-inspector.js` 주입 및 폴링 시작/중지 메시지 전송 |
| `entry-debugger-extension/style.css` | 네이티브 속성 패널에 삽입되는 함수 내부 사용 위치 UI 스타일 |
| `entry-debugger-extension/manifest.json` | 새 Main World 스크립트를 `web_accessible_resources`에 등록 |

## 메시지 프로토콜

기존 채널 `__ENTRY_DEBUGGER__`를 재사용하되, 메시지 타입은 별도로 분리했다.

| 방향 | 타입 | 의미 |
| --- | --- | --- |
| content -> inspector | `START_FUNCTION_USAGE_POLLING` | 함수 내부 사용 위치 폴링 시작 |
| content -> inspector | `STOP_FUNCTION_USAGE_POLLING` | 폴링 중지 |
| content -> inspector | `REQUEST_FUNCTION_USAGE` | 즉시 스냅샷 요청 |
| inspector -> content | `FUNCTION_USAGE_SNAPSHOT` | 함수 내부 사용 위치 목록 전달 |
| inspector internal | `OPEN_FUNCTION_USAGE` 상당 동작 | 삽입된 `함수에서 사용` 항목 클릭 시 함수 편집 화면에서 특정 블록 보기 |
| inspector -> content | `FUNCTION_USAGE_OPEN_RESULT` | 이동 결과 |

## 스냅샷 형태

```js
{
  ready: true,
  items: [
    {
      targetType: 'variable' | 'list' | 'message' | 'function',
      targetId: '...',
      targetName: '...',
      refs: [
        {
          ownerFunctionId: '...',
          ownerFunctionName: '...',
          ownerFunctionType: 'normal' | 'value',
          blockId: '...',
          blockType: 'get_variable',
          blockLabel: '변수',
          blockIndex: 3,
          paramIndexes: [0]
        }
      ]
    }
  ],
  totals: {
    targets: 1,
    refs: 1,
    functions: 2
  }
}
```

## 분석 방식

1. `Entry.variableContainer`에서 변수, 리스트, 신호, 함수 목록을 읽어 ID 맵을 만든다.
2. `container.functions_`의 각 함수에 대해 `func.content.getBlockList(false)`를 호출한다.
3. 각 블록의 `params`에 변수/리스트/신호 ID가 들어 있는지 확인한다.
4. 각 블록의 `type`이 `func_${functionId}` 형태이면 함수 호출로 기록한다.
5. 결과는 대상 요소별로 묶고, 현재 선택된 속성 항목에 해당하는 결과를 네이티브 속성 패널에 렌더링한다.

## 표시 방식

`function-usage-inspector.js`는 `Entry.variableContainer.selected`로 현재 펼쳐진 속성 항목을 확인한다. 선택된 항목이 변수, 리스트, 신호, 함수 중 하나이고 함수 내부 사용 내역이 있으면 다음 위치에 섹션을 추가한다.

- 기준 DOM: 선택된 항목의 `listElement`
- 보조 기준 DOM: 현재 `.entryVariableListWorkspace` 안에서 실제로 펼쳐진 `unfold` 또는 `selected` 항목
- 삽입 위치: `.attr_inner_box` 안의 `.use_obj` 또는 `.use_block`
- 섹션 클래스: `.ed-native-function-usage`
- 제목: `함수에서 사용`

Entry 기본 문구인 `함수에 조립되어 있어요.`는 제거하지 않는다. 그 아래에 상세 항목을 덧붙여 기본 기능과 확장 기능을 분리한다. `전체` 탭뿐 아니라 `변수`, `신호`, `리스트`, `함수` 탭에서 같은 항목을 펼쳐도 동일하게 표시한다.

## 이동 방식

`함수에서 사용` 항목을 누르면 inspector가 다음 순서로 이동한다.

1. `Entry.do('funcEditStart', ownerFunctionId)` 또는 `Entry.Func.edit(ownerFunctionId)`로 함수 편집 화면을 연다.
2. `func.content.findById(blockId)`로 대상 블록을 찾는다.
3. 블록 view와 board가 준비될 때까지 짧게 재시도한다.
4. `board.activateBlock(block)`와 `board.setSelectedBlock(block.view)`를 호출해 스크롤, 강조, 선택 표시를 적용한다.

## 남은 확인 포인트

- 함수 편집 중 저장되지 않은 변경이 있을 때 다른 함수로 이동하는 UX 확인
- 중첩 함수 호출을 따라 호출자 오브젝트까지 역추적할지 여부
- 블록 번호가 Entry 사용자가 보는 시각적 순서와 충분히 일치하는지 확인
