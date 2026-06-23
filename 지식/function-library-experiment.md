# 함수 보관함

확인 날짜: 2026-06-23

## 목적

자주 사용하는 Entry 함수를 확장 안에 템플릿으로 등록하고, 사용자가 버튼을 눌러 현재 Entry 작품의 함수 목록에 추가할 수 있게 한다.

## 등록된 함수

### numberToHangul

파일: `C:\Users\young\Downloads\numberToHangul _단일 함수_.ent`

`.ent`의 `temp/project.json`에서 값 반환 함수 `numberToHangul`을 추출했다.

- 입력: 문자열 파라미터 `n`
- 출력: 숫자를 억·만·천·백·십 단위의 한글 읽기 문자열로 변환한 값
- 지역변수: 9개
- 본문 블록: 340개
- 동적 파라미터: 원본 `stringParam_n`을 추가할 때 새 타입으로 재생성

## UI

실험실 탭에 `함수 보관함` 토글을 추가한다.

- `functionLibraryEnabled: false`가 기본값
- `실험실 탭`이 꺼지면 `functionLibraryEnabled`도 `false`로 정규화
- 토글이 켜지면 실험실 탭 옆에 `함수 보관함` 탭 표시
- 함수 보관함 탭에는 등록된 템플릿 카드와 `추가` 버튼 표시
- 함수 보관함 탭 상단에는 실험실 안내와 같은 스타일로 `앞으로 다양한 함수가 추가될 예정이에요. 추가를 원하는 함수가 있다면 알려주세요. ease 함수 등...` 안내 표시

## 구현 파일

| 파일 | 역할 |
|---|---|
| `entry-debugger-extension/function-library-templates.js` | 내장 함수 템플릿 목록 |
| `entry-debugger-extension/content.js` | 실험실 토글, 함수 보관함 탭, 추가 버튼 UI |
| `entry-debugger-extension/inject.js` | Entry Main World에서 함수 템플릿을 현재 작품에 등록 |
| `entry-debugger-extension/settings.js` | `functionLibraryEnabled` 기본값과 정규화 |
| `tools/check-function-library.js` | 가짜 Entry API에서 실제 함수 복제·등록·ID 재생성 검증 |
| `tools/smoke-local-extension.js` | Chromium에서 카드 표시와 현재 작품 함수 추가 검증 |

## 템플릿 추가 문서

앞으로 새 함수를 계속 추가할 때는 `function-library-template-authoring.md`의 절차를 따른다. 새 템플릿만 추가하는 경우에는 보통 `function-library-templates.js`에 템플릿 객체를 추가하고, 필요 시 템플릿 목록과 smoke 검증 대상을 갱신하면 된다.

## 메시지 흐름

content script에서 Main World 주입 스크립트로 전달한다.

```js
sendToInject('ADD_FUNCTION_LIBRARY_TEMPLATE', {
  templateId: template.id,
  templateName: template.name,
  func: template.function
});
```

주입 스크립트는 처리 후 결과를 돌려준다.

```js
post('ADD_FUNCTION_LIBRARY_TEMPLATE_RESULT', {
  success: true,
  id: '새 함수 ID',
  name: template.name
});
```

## ID 재생성 규칙

템플릿을 그대로 추가하면 기존 작품의 함수, 블록, 지역변수, 동적 파라미터 타입과 충돌할 수 있다. 따라서 추가 직전에 다음 값을 새로 만든다.

- 함수 ID
- 모든 블록 ID
- `stringParam_*`, `booleanParam_*` 타입
- 지역변수 ID
- 함수 내부에서 참조하는 지역변수 ID

같은 원본 동적 파라미터 타입은 같은 새 타입으로 매핑한다. 예를 들어 함수 정의부의 `stringParam_ogzm`과 본문에서 문자열 인자를 읽는 `stringParam_ogzm`은 하나의 새 `stringParam_*`으로 같이 바뀐다.

`params` 배열에 직접 들어 있는 지역변수 ID도 문자열 요소를 순회하며 재매핑해야 한다.
객체 속성만 처리하면 `set_func_variable`, `get_func_variable`이 원본 지역변수 ID를
계속 참조해 추가된 함수가 정상 동작하지 않는다.

## 제한

- `Entry.Func.isEdit`가 참이면 추가하지 않는다.
- 작품이 실행 중이면 `Entry.Code.load()`가 안전하게 동작하지 않을 수 있으므로 추가하지 않는다.
- 현재 MVP는 내장 템플릿만 지원한다. 사용자 정의 템플릿 업로드는 별도 기능으로 분리한다.

## 검증

- `npm run check`
- `npm run build:dev`
- PR 생성 또는 PR 브랜치 업데이트 직전 `npm run smoke:local`

현재 `smoke:local`은 함수 보관함을 켠 상태로 로컬 Entry 만들기 화면을 열고
`numberToHangul` 카드의 `추가` 버튼을 누른다. 추가된 함수의 타입, 함수 이름,
블록 ID, 지역변수 ID, `stringParam_*` 타입이 원본과 충돌하지 않게 재생성됐는지
확인한다.
