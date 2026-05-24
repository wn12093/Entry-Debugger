# 함수 안에서 개인변수 보기

확인 날짜: 2026-05-24

대상 기능: 함수 편집 화면의 블록 꾸러미에서 현재 오브젝트의 개인 변수/리스트를 보이게 하는 실험실 옵션.

## 배경

Entry 원본은 변수/리스트 드롭다운을 만들 때 `Entry.container.getDropdownList('variables' | 'lists', object)`를 사용한다.

원본 필터는 개인 변수/리스트(`object_`가 있는 항목)를 함수 편집 중에는 항상 제외한다.

```js
if (
  variable.object_ &&
  object &&
  (variable.object_ != object.id || Entry.Func.isEdit)
) {
  return;
}
```

이 때문에 함수 안에서는 현재 오브젝트의 개인 변수를 블록 꾸러미에서 바로 선택할 수 없다. 외부에서 블록을 복사해 넣으면 값은 동작할 수 있지만, 함수 편집 보드의 동적 드롭다운 표시 로직 때문에 이름 대신 id가 보일 수 있다.

## 구현

파일: `entry-debugger-extension/function-private-variables.js`

- Main World에 주입되는 별도 실험실 모듈이다.
- Entry JSON은 수정하지 않는다.
- `Entry.container.getDropdownList()`를 래핑한다.
- 토글이 켜져 있고 `Entry.Func.isEdit === true`일 때만 `variables`/`lists` 메뉴를 직접 생성한다.
- 이때 전역 항목과 현재 오브젝트(`Entry.playground.object`)의 개인 항목만 포함한다.
- 다른 오브젝트의 개인 항목은 계속 제외한다.
- `Entry.FieldDropdownDynamic.prototype.getTextByValue()`도 래핑해 함수 편집 보드 안에서 개인 변수/리스트 id가 이름으로 표시되도록 한다.

## 설정

파일: `entry-debugger-extension/settings.js`

설정 키:

```js
functionPrivateVariablesEnabled: true
```

기본값은 켜짐이다. 확장 전체가 꺼지면 false로 정규화한다. 실험실 탭과 디버깅 탭의 표시 여부와는 독립적으로 동작한다.

## UI

파일: `entry-debugger-extension/popup.html`, `entry-debugger-extension/popup.js`

확장 프로그램 팝업에 `함수 안에서 개인변수 보기` 토글을 추가했다.

설명:

```text
함수 편집 중 개인 변수/리스트 표시
```

## 메시지

```js
sendToInject('SET_FUNCTION_PRIVATE_VARIABLES_ENABLED', {
  enabled: true
});
```

주입 스크립트 준비 이벤트:

```js
FUNCTION_PRIVATE_VARIABLES_READY
```

## 검증 포인트

- 토글 기본값은 켜짐이다.
- 실험실 탭이 꺼져 있어도 기능은 유지된다.
- 함수 편집 화면의 자료 카테고리 블록 꾸러미에서 현재 오브젝트 개인 변수/리스트가 보인다.
- 다른 오브젝트의 개인 변수/리스트는 보이지 않는다.
- 함수 안에 복사해 넣은 개인 변수 블록이 id 대신 이름으로 표시된다.
- 저장되는 Entry 프로젝트 JSON은 변경하지 않는다.

스모크 테스트:

- mock `Entry.container.getDropdownList('variables')`에서 전역 변수와 현재 오브젝트 개인 변수만 반환 확인
- 다른 오브젝트 개인 변수 제외 확인
- `FieldDropdownDynamic.getTextByValue('localVar')`가 id 대신 `개인변수` 이름을 반환하는 것 확인
- 토글을 끄면 원본 `getDropdownList()` 결과로 돌아가는 것 확인
