# 함수 내부 사용 위치 확장 설계

확인 날짜: 2026-05-23  
대상 확장: `entry-debugger-extension`

## 목표

Entry 기본 속성 패널은 변수, 리스트, 신호, 함수가 함수 내부에서 사용된 경우 `함수에 조립되어 있어요.`라고만 표시한다. Entry Debugger는 이 기본 UI와 별도로 다음 정보를 보여준다.

- 어떤 변수/리스트/신호/함수가 함수 안에서 사용됐는지
- 어떤 함수 안의 어떤 블록에서 사용됐는지
- 해당 함수 편집 화면으로 이동해 대상 블록을 선택/강조할 수 있는지

## 구현 원칙

- Entry 원본 UI와 `Entry.variableContainer` 동작을 변경하지 않는다.
- 기존 `inject.js`의 변수/리스트/신호 값 수정 기능과 분리한다.
- 함수 내부 참조 분석은 별도 Main World 스크립트인 `function-usage-inspector.js`가 담당한다.
- content script는 UI 표시와 메시지 전달만 담당한다.

## 추가된 파일과 연결

| 파일 | 역할 |
| --- | --- |
| `entry-debugger-extension/function-usage-inspector.js` | 함수 내부 블록을 순회해 사용 위치 인덱스 생성 |
| `entry-debugger-extension/content.js` | `함수 내부` 서브탭, 결과 렌더링, 보기 버튼 메시지 전송 |
| `entry-debugger-extension/style.css` | 함수 내부 사용 위치 카드 UI 스타일 |
| `entry-debugger-extension/manifest.json` | 새 Main World 스크립트를 `web_accessible_resources`에 등록 |

## 메시지 프로토콜

기존 채널 `__ENTRY_DEBUGGER__`를 재사용하되, 메시지 타입은 별도로 분리했다.

| 방향 | 타입 | 의미 |
| --- | --- | --- |
| content -> inspector | `START_FUNCTION_USAGE_POLLING` | 함수 내부 사용 위치 폴링 시작 |
| content -> inspector | `STOP_FUNCTION_USAGE_POLLING` | 폴링 중지 |
| content -> inspector | `REQUEST_FUNCTION_USAGE` | 즉시 스냅샷 요청 |
| inspector -> content | `FUNCTION_USAGE_SNAPSHOT` | 함수 내부 사용 위치 목록 전달 |
| content -> inspector | `OPEN_FUNCTION_USAGE` | 함수 편집 화면에서 특정 블록 보기 |
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
5. 결과는 대상 요소별로 묶어서 content script에 전달한다.

## 이동 방식

`보기` 버튼을 누르면 `OPEN_FUNCTION_USAGE` 메시지를 보낸다. inspector는 다음 순서로 이동한다.

1. `Entry.do('funcEditStart', ownerFunctionId)` 또는 `Entry.Func.edit(ownerFunctionId)`로 함수 편집 화면을 연다.
2. `func.content.findById(blockId)`로 대상 블록을 찾는다.
3. 블록 view와 board가 준비될 때까지 짧게 재시도한다.
4. `board.activateBlock(block)`와 `board.setSelectedBlock(block.view)`를 호출해 스크롤, 강조, 선택 표시를 적용한다.

## 남은 확인 포인트

- 함수 편집 중 저장되지 않은 변경이 있을 때 다른 함수로 이동하는 UX 확인
- 중첩 함수 호출을 따라 호출자 오브젝트까지 역추적할지 여부
- 블록 번호가 Entry 사용자가 보는 시각적 순서와 충분히 일치하는지 확인
