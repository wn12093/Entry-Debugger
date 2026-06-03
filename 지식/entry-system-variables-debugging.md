# Entry 기본 변수 디버깅 확장 기록

확인 날짜: 2026-05-23

대상 기능: 디버깅 탭의 `실험실` 탭에서 Entry 기본 변수인 `초시계`, `대답`을 조회/수정/표시 전환한다.

## Entry 런타임 위치

`초시계`와 `대답`은 일반 변수처럼 `Entry.Variable` 인스턴스로 동작하지만, 런타임 접근 경로가 따로 있다.

| 항목 | 런타임 경로 | 변수 타입 |
|---|---|---|
| 초시계 | `Entry.engine.projectTimer` | `timer` |
| 대답 | `Entry.container.inputValue` | `answer` |

두 항목은 `getValue()`, `setValue()`, `isVisible()`, `setVisible()`, `updateView()` 같은 표준 변수 메서드를 쓸 수 있다. 단, 초시계 값은 실행 중 다음 tick에서 엔진에 의해 다시 갱신될 수 있으므로 확장에서는 `Entry.engine.updateProjectTimer(n)`를 우선 사용한다.

## 값과 표시 조작

초시계 값 변경:

```js
Entry.engine.updateProjectTimer(10);
Entry.engine.projectTimer.updateView();
```

초시계 표시 전환:

```js
Entry.engine.projectTimer.setVisible(true);
Entry.engine.projectTimer.setX(0);   // 보이기
Entry.engine.projectTimer.setY(0);
Entry.engine.projectTimer.updateView();

Entry.engine.projectTimer.setX(500); // 숨기기
Entry.engine.projectTimer.setY(0);
Entry.engine.projectTimer.updateView();
```

대답 값 변경:

```js
Entry.container.inputValue.setValue('hello');
Entry.container.inputValue.updateView();
```

대답 표시 전환:

```js
Entry.container.inputValue.setVisible(true);
Entry.container.inputValue.setX(0);   // 보이기
Entry.container.inputValue.setY(0);
Entry.container.inputValue.updateView();

Entry.container.inputValue.setX(500); // 숨기기
Entry.container.inputValue.setY(0);
Entry.container.inputValue.updateView();
```

## 확장 구현 방식

파일: `entry-debugger-extension/inject.js`

- 일반 변수 직렬화에서 `type`, `variableType`, `variableType_` 값이 `timer` 또는 `answer`인 항목은 제외한다.
- 새 스냅샷 필드 `others`를 추가한다.
- `others`에는 `timer`, `answer` 두 항목을 `{ id, kind, name, value, visible, x, y }` 형태로 담는다.
- 값 변경 메시지는 `SET_SYSTEM_VARIABLE`을 사용한다.
- 표시 전환 메시지는 `SET_SYSTEM_VISIBLE`을 사용한다.
- `SET_SYSTEM_VISIBLE`은 Entry의 표시 플래그를 끄지 않고 항상 `true`로 둔 뒤 좌표를 이동한다. `보이기`는 `(0, 0)`, `숨기기`는 `(500, 0)`이다.

파일: `entry-debugger-extension/content.js`

- 디버깅 패널 탭에 `실험실`을 추가했다.
- `실험실` 탭은 기본값 OFF이며, 디버깅 탭 내부 설정의 `실험실 탭` 토글을 켜야 표시된다.
- `디버깅 탭` 토글을 끄면 `실험실 탭` 토글도 자동으로 꺼진다.
- `실험실` 탭은 기존 변수 카드 UI를 재사용해 값 조회/편집 흐름을 맞췄다.
- 각 카드에 `표시 중`/`숨김` 배지와 `숨기기`/`보이기` 버튼을 추가했다. `(500, 0)` 좌표는 확장 UI에서 `숨김`으로 표시한다.
- 검색어는 이름과 현재 값에 적용된다.

## 주의점

- 블록만으로는 초시계/대답 값을 직접 쓰거나 위치를 바꿀 수 없다.
- 위치 변경 UI는 이번 범위에 넣지 않았다. 단, 기본 변수 표시 전환은 숨김/보임 API 대신 `setX()`, `setY()`, `updateView()` 기반 좌표 이동으로 처리한다.
- 초시계 값은 숫자만 허용한다. 문자열 입력은 디버깅 패널에서 오류로 처리한다.
