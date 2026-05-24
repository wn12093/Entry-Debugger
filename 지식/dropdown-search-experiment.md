# 속성 검색으로 찾기

확인 날짜: 2026-05-24

대상 기능: 변수, 신호, 리스트 관련 블록의 동적 드롭다운을 열었을 때 키보드로 이름을 검색해서 선택하는 실험실 옵션.

## 배경

Entry의 변수/신호/리스트 선택 UI는 `Entry.FieldDropdownDynamic`이 만들며, 실제 옵션 목록은 `Entry.container.getDropdownList()`가 제공한다.

주요 메뉴 이름:

| 대상 | 메뉴 이름 |
|---|---|
| 변수 | `variables` |
| 리스트 | `lists` |
| 신호 | `messages` |

원본 드롭다운은 항목이 많을 때 스크롤만 제공하므로, 이름 일부를 입력해서 좁히는 기능이 없다.

## 구현

파일: `entry-debugger-extension/dropdown-search.js`

- Main World에 주입되는 별도 실험실 모듈이다.
- Entry 프로젝트 JSON은 수정하지 않는다.
- `Entry.FieldDropdownDynamic.prototype.renderOptions()`를 한 번만 래핑한다.
- 토글이 켜져 있고 `_menuName`이 `variables`, `lists`, `messages` 중 하나일 때만 동작한다.
- 대상 메뉴에서는 원본 Dropdown 위젯을 숨겨 재사용하지 않고, 같은 `.entry-widget-dropdown` 계열 컨테이너를 직접 만든다.
- 검색 입력 + 필터링된 버튼 목록을 직접 렌더링하고, 위치 계산과 바깥 클릭 닫기는 모듈에서 처리한다.
- 선택 시 기존 로직과 동일하게 `field.applyValue(value)` 후 블록을 다시 그린다.
- 기능이 꺼져 있으면 스크립트를 주입하지 않아 원본 드롭다운 동작을 건드리지 않는다.

## 설정

파일: `entry-debugger-extension/settings.js`

설정 키:

```js
dropdownSearchEnabled: false
```

기본값은 꺼짐이다. `debuggerTabEnabled` 또는 `labTabEnabled`가 꺼지면 false로 정규화한다.

## UI

파일: `entry-debugger-extension/content.js`

실험실 탭에 `속성 검색으로 찾기` 토글을 추가했다.

설명:

```text
변수/신호/리스트 드롭다운에 검색 추가
```

## 메시지

```js
sendToInject('SET_DROPDOWN_SEARCH_ENABLED', {
  enabled: true
});
```

주입 스크립트 준비 이벤트:

```js
DROPDOWN_SEARCH_READY
```

## 조작

- 드롭다운을 열면 검색 입력에 자동 포커스된다.
- 이름 일부를 입력하면 목록이 즉시 필터링된다.
- `ArrowUp` / `ArrowDown`으로 후보 이동
- `Enter`로 선택
- `Escape`로 닫기

## 검증 포인트

- 기본값은 꺼짐이다.
- 실험실 탭이 꺼져 있으면 기능도 꺼진다.
- 변수 드롭다운에서 검색 입력이 표시된다.
- 리스트 드롭다운에서 검색 입력이 표시된다.
- 신호 드롭다운에서 검색 입력이 표시된다.
- 변수/리스트/신호 외의 동적 드롭다운에는 검색 입력이 붙지 않는다.
- 선택된 값은 기존 Entry 방식과 같은 id/value로 저장된다.
