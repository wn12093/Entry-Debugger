# 속성 검색으로 찾기

확인 날짜: 2026-05-24

대상 기능: 블록꾸러미의 변수/신호/리스트 동적 드롭다운과 속성 탭 목록에서 키보드로 이름을 검색해서 선택하는 실험실 옵션.

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

관련 파일:

- `entry-debugger-extension/hangul-search.js`
- `entry-debugger-extension/content.js`

- Main World에 주입되는 별도 실험실 모듈이다.
- Entry 프로젝트 JSON은 수정하지 않는다.
- `Entry.FieldDropdownDynamic.prototype.renderOptions()`를 한 번만 래핑한다.
- 토글이 켜져 있고 `_menuName`이 `variables`, `lists`, `messages` 중 하나일 때만 동작한다.
- 대상 메뉴에서는 원본 Dropdown 위젯을 숨겨 재사용하지 않고, 같은 `.entry-widget-dropdown` 계열 컨테이너를 직접 만든다.
- 검색 입력 + 필터링된 버튼 목록을 직접 렌더링하고, 위치 계산과 바깥 클릭 닫기는 모듈에서 처리한다.
- 선택 시 기존 로직과 동일하게 `field.applyValue(value)` 후 블록을 다시 그린다.
- 기능이 꺼져 있으면 스크립트를 주입하지 않아 원본 드롭다운 동작을 건드리지 않는다.
- 검색 매칭은 `hangul-search.js`의 `EntryDebuggerHangulSearch.matches()`를 우선 사용한다.
- `hangul-search.js`는 `toss/es-hangul`에서 확인한 검색 프리미티브 방향을 확장 구조에 맞게 벤더링한 전역 유틸이다. 번들러 없는 확장 구조를 유지하기 위해 런타임 `import` 대신 content script와 page world에 모두 주입한다.

## 한글 검색 매칭

검색 대상 텍스트와 검색어를 여러 형태로 비교한다.

- 일반 부분 문자열 검색: `리스트`로 `리스트1` 검색
- 초성 검색: `ㄹㅅㅌ`로 `리스트` 검색
- 자모 분해 검색: `ㄹㅣㅅ`로 `리스트` 검색
- QWERTY 오입력 검색: `fltmxm`으로 `리스트`, `qustn`으로 `변수` 검색

완성형 한글 검색어는 초성만으로 과도하게 넓어지지 않도록 검색어의 초성 토큰을 자동 추가하지 않는다. 초성 검색은 사용자가 `ㄱ-ㅎ` 범위의 초성 문자를 직접 입력했을 때 적용한다.

QWERTY 오입력 매칭은 영문 2자 이상일 때만 적용한다. 한 글자 영문 검색이 한글 자모 하나로 변환되어 너무 많은 항목을 매칭하는 것을 막기 위한 제한이다.

## 설정

파일: `entry-debugger-extension/settings.js`

설정 키:

```js
dropdownSearchEnabled: false,
dropdownSearchBlockMenuEnabled: true,
dropdownSearchPropertyPanelEnabled: true
```

기본값은 꺼짐이다. `debuggerTabEnabled` 또는 `labTabEnabled`가 꺼지면 false로 정규화한다.

하위 설정은 메인 토글과 별개로 저장한다. 따라서 실험실 탭이 켜진 상태에서 `속성 검색으로 찾기`만 껐다 켜면 블록꾸러미와 속성 탭 적용 여부는 사용자가 마지막으로 선택한 값을 유지한다.

단, `실험실 탭` 자체가 꺼지면 모든 실험실 기능 설정은 기본값으로 돌아간다. 이 기능은 `dropdownSearchEnabled: false`, `dropdownSearchBlockMenuEnabled: true`, `dropdownSearchPropertyPanelEnabled: true` 상태가 된다.

## UI

파일: `entry-debugger-extension/content.js`

실험실 탭에 `속성 검색으로 찾기` 토글을 추가했다. 메인 토글이 켜져 있을 때 하위 체크박스로 적용 위치를 나눠 설정한다.

설명:

```text
블록꾸러미와 속성 탭에서 검색 기능 사용
```

하위 체크박스:

- 블록꾸러미: 변수/신호/리스트 드롭다운 검색 UI를 사용한다.
- 속성 탭: `#entryCode > div.entryVariablePanelWorkspace` 안의 `.entryVariableListWorkspace` 첫 부분에 검색 입력을 추가하고, 실제 `.list` 항목을 필터링한다.

## 메시지

```js
sendToInject('SET_DROPDOWN_SEARCH_ENABLED', {
  enabled: true,
  blockMenuEnabled: true,
  propertyPanelEnabled: true
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
- 드롭다운 검색에서 초성, 자모 분해, QWERTY 오입력 검색이 동작한다.
- 속성 탭 체크박스가 켜져 있으면 속성 탭 상단에 `속성 검색` 입력이 표시된다.
- 속성 탭 검색어와 일치하지 않는 변수/신호/리스트/함수 항목은 숨겨지고, 검색어를 지우면 원래 표시 상태로 돌아온다.
- 속성 탭 검색에서도 초성, 자모 분해, QWERTY 오입력 검색이 동작한다.
- 속성 탭 체크박스를 끄면 삽입한 검색 입력과 숨김 상태가 모두 제거된다.
- 검색 입력은 속성 탭 루트가 아니라 `.entryVariableListWorkspace`에 삽입해야 한다. 루트에 삽입하면 Entry 기본 필터 표와 고정된 목록 영역 위치가 어긋나 UI가 깨질 수 있다.
- 변수/리스트/신호 외의 동적 드롭다운에는 검색 입력이 붙지 않는다.
- 선택된 값은 기존 Entry 방식과 같은 id/value로 저장된다.
