# 함수 보관함

확인 날짜: 2026-06-06

## 목적

자주 사용하는 Entry 함수를 확장 안에 템플릿으로 등록하고, 사용자가 버튼을 눌러 현재 Entry 작품의 함수 목록에 추가할 수 있게 한다.

## 샘플 원본

파일: `C:\Users\young\Downloads\260603_205님 작품 (1).ent`

`.ent`는 tar 파일이며 `temp/project.json`을 포함한다. `project.functions[0]`에서 다음 함수 템플릿을 추출했다.

- 이름: `테스트 함수`
- 타입: `normal`
- 지역변수: `지역변수`
- 함수 인자: 문자열 파라미터 1개, 참/거짓 파라미터 1개
- 본문: 지역변수에 문자열 인자를 저장하고, 참/거짓 인자에 따라 `말하기` 또는 `생각하기` 블록 실행

이 샘플은 함수 등록 구조를 검증하는 개발용 자료다. Chrome Web Store `2.4.0` 제출본에서는 사용자용 함수로 보기 어려운 `테스트 함수` 템플릿과 원본 파일명 정보를 `function-library-templates.js`에서 제거했다. 현재 배포본의 내장 템플릿 목록은 비어 있다.

## UI

실험실 탭에 `함수 보관함` 토글을 추가한다.

- `functionLibraryEnabled: false`가 기본값
- `실험실 탭`이 꺼지면 `functionLibraryEnabled`도 `false`로 정규화
- 토글이 켜지면 업로더 탭 옆에 `함수 보관함` 탭 표시
- 함수 보관함 탭에는 등록된 템플릿 카드와 `추가` 버튼 표시
- 함수 보관함 탭 상단에는 실험실 안내와 같은 스타일로 `앞으로 다양한 함수가 추가될 예정이에요. 추가를 원하는 함수가 있다면 알려주세요. ease 함수 등...` 안내 표시

## 구현 파일

| 파일 | 역할 |
|---|---|
| `entry-debugger-extension/function-library-templates.js` | 내장 함수 템플릿 목록 |
| `entry-debugger-extension/content.js` | 실험실 토글, 함수 보관함 탭, 추가 버튼 UI |
| `entry-debugger-extension/inject.js` | Entry Main World에서 함수 템플릿을 현재 작품에 등록 |
| `entry-debugger-extension/settings.js` | `functionLibraryEnabled` 기본값과 정규화 |
| `tools/smoke-local-extension.js` | Chromium smoke에서 함수 보관함 빈 상태 검증 |

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

## 제한

- `Entry.Func.isEdit`가 참이면 추가하지 않는다.
- 작품이 실행 중이면 `Entry.Code.load()`가 안전하게 동작하지 않을 수 있으므로 추가하지 않는다.
- 현재 MVP는 내장 템플릿만 지원한다. 사용자 정의 템플릿 업로드는 별도 기능으로 분리한다.

## 검증

- `npm run check`
- `npm run build:dev`
- PR 생성 또는 PR 브랜치 업데이트 직전 `npm run smoke:local`

현재 `smoke:local`은 함수 보관함을 켠 상태로 로컬 Entry 만들기 화면을 열고, 빈 상태 안내가 표시되며 테스트용 추가 버튼이 존재하지 않는지 확인한다. 실제 사용자용 템플릿을 추가할 때 해당 함수 등록 검증을 다시 확장한다.
