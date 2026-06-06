# 함수 보관함 템플릿 추가 절차

확인 날짜: 2026-06-06
범위: Entry Debugger 전용

이 문서는 함수 보관함에 새 Entry 함수를 계속 추가할 때 따라야 할 절차를 기록한다. 함수 보관함 기능 자체의 구조는 `function-library-experiment.md`를 함께 참고한다.

## 핵심 요약

- 새 함수 추가의 기본 작업은 `entry-debugger-extension/function-library-templates.js`에 템플릿 객체를 추가하는 것이다.
- `content.js`는 `EntryDebuggerFunctionLibraryTemplates` 배열을 읽어 함수 보관함 카드와 `추가` 버튼을 자동으로 렌더링한다.
- `inject.js`는 사용자가 `추가`를 누른 순간 함수 ID, 블록 ID, 지역변수 ID, 동적 파라미터 타입을 새로 만들어 현재 작품에 등록한다.
- 함수 보관함 토글, 탭 UI, 메시지 흐름, 실험실 off 정규화는 이미 구현되어 있으므로 새 템플릿만 추가할 때는 보통 수정하지 않는다.
- 함수 템플릿은 Entry Debugger에 종속된 구현 지식이므로 이 폴더에 기록하고, 공용 `_docs`에는 올리지 않는다.

## 1. 원본 함수 준비

1. Entry 작품에서 보관함에 넣을 함수를 만든다.
2. 가능하면 대상 함수만 깔끔하게 포함된 작은 샘플 작품으로 만든다.
3. 작품을 `.ent` 파일로 저장한다.
4. `.ent` 파일은 tar 압축이므로 압축을 풀어 `temp/project.json`을 연다.
5. `project.functions` 배열에서 대상 함수 객체를 찾는다.
6. 함수 이름, 지역변수, 문자열/참거짓/숫자 파라미터, 본문 블록이 의도대로 들어 있는지 확인한다.

이번 최초 샘플은 `C:\Users\young\Downloads\260603_205님 작품 (1).ent`의 `temp/project.json`에서 `project.functions[0]`을 추출했다.

## 2. 템플릿 객체 형식

`entry-debugger-extension/function-library-templates.js`의 `EntryDebuggerFunctionLibraryTemplates` 배열에 아래 형식으로 추가한다.

```js
{
  id: 'template-slug',
  name: '함수 이름',
  description: '함수 보관함 카드에 표시할 짧은 설명',
  source: '원본 .ent 또는 샘플 이름',
  function: {
    id: '원본 함수 ID',
    type: 'normal',
    localVariables: [],
    useLocalVariables: false,
    content: 'Entry 함수 블록 JSON 문자열'
  }
}
```

필드 기준:

- `id`: 확장 안에서 템플릿을 찾는 안정적인 식별자다. 영어 kebab-case를 권장한다.
- `name`: 사용자가 보는 함수 이름이다.
- `description`: 카드 설명이다. 한 줄에 가까운 짧은 문장이 좋다.
- `source`: 나중에 원본을 다시 확인할 수 있도록 `.ent` 파일명이나 샘플 이름을 남긴다.
- `function`: `project.functions[n]`에서 추출한 Entry 함수 모델이다.

## 3. 함수 모델 보존 규칙

추출한 함수 모델 안의 참조 관계는 그대로 맞아 있어야 한다.

- `function.id`는 원본 값을 넣어도 된다. 추가 시점에 새 ID로 바뀐다.
- `function.content`는 Entry가 저장한 JSON 문자열이다. 객체가 아니라 문자열이어야 한다.
- `function_create` 안의 `function_field_label`에 들어 있는 함수 이름은 `name`과 맞춰 둔다.
- `localVariables[].id`와 `set_func_variable`, `get_func_variable` 블록의 지역변수 ID 참조가 서로 같아야 한다.
- `stringParam_*`, `booleanParam_*` 같은 동적 파라미터 타입은 정의부와 사용부가 같은 원본 타입을 공유해야 한다.
- 같은 문자열 파라미터를 여러 곳에서 쓰면 모든 사용부가 같은 `stringParam_*` 원본 타입을 참조해야 한다.
- 같은 참/거짓 파라미터를 여러 곳에서 쓰면 모든 사용부가 같은 `booleanParam_*` 원본 타입을 참조해야 한다.

ID를 미리 사람이 직접 새로 만들 필요는 없다. 중요한 것은 원본 함수 내부의 참조가 깨지지 않은 상태로 템플릿에 들어가는 것이다.

## 4. 추가 시 자동 처리되는 값

사용자가 `추가` 버튼을 누르면 `inject.js`의 함수 등록 흐름이 다음 값을 새로 만든다.

- 함수 ID
- 모든 블록 ID
- 지역변수 ID
- 지역변수 참조 문자열
- `stringParam_*` 동적 파라미터 타입
- `booleanParam_*` 동적 파라미터 타입
- 자기 함수 호출처럼 `func_원본함수ID` 형태로 남아 있는 함수 타입

같은 원본 동적 파라미터 타입은 같은 새 타입으로 매핑된다. 예를 들어 함수 정의부와 본문이 둘 다 `stringParam_ogzm`을 참조하면 추가 후에도 둘 다 같은 새 `stringParam_*` 타입을 참조한다.

## 5. 새 함수 추가 체크리스트

1. `.ent`를 풀고 `temp/project.json`에서 대상 `project.functions[n]`을 찾는다.
2. `function-library-templates.js`에 새 템플릿 객체를 추가한다.
3. `id`, `name`, `description`, `source`를 사람이 알아보기 쉽게 채운다.
4. `function.content`가 문자열인지 확인한다.
5. 함수 이름, 지역변수 ID, 동적 파라미터 타입 참조가 내부적으로 일관적인지 확인한다.
6. `지식/function-library-experiment.md` 또는 이 문서의 템플릿 목록에 새 함수 출처와 특징을 기록한다.
7. 정적 검증을 실행한다.
8. PR 생성 또는 main 반영 직전에는 `npm run smoke:local`로 실제 Entry 만들기 화면에서 추가 동작을 확인한다.

## 6. 검증 기준

기능 개발 중 기본 검증:

```powershell
npm run check
npm run build:dev
```

PR 생성, PR 업데이트, main 반영 직전 검증:

```powershell
npm run smoke:local
```

`smoke:local`은 로컬 Entry 만들기 서버가 필요한 Chromium 검증이다. 함수 보관함에서는 실험실과 함수 보관함을 켠 뒤 템플릿 탭이 보이는지, `추가` 버튼을 눌렀을 때 `Entry.variableContainer.functions_`에 함수가 추가되는지 확인한다.

새 템플릿을 여러 개 추가했는데 UI 렌더링만 바뀐 경우에는 목록 표시까지 확인한다. 함수 JSON 구조가 새롭거나 위험한 블록 조합을 포함하면 smoke에서 해당 템플릿의 추가 결과까지 확인하도록 테스트를 확장한다.

## 7. 자주 나는 문제

템플릿이 목록에 보이지 않을 때:

- `function-library-templates.js`의 배열 문법 오류를 확인한다.
- `manifest.json`에서 `function-library-templates.js`가 `content.js`보다 먼저 로드되는지 확인한다.
- 실험실 탭과 함수 보관함 토글이 모두 켜져 있는지 확인한다.

추가 버튼을 눌러도 추가되지 않을 때:

- 함수 편집 중이면 추가가 막힌다.
- 작품 실행 중이면 추가가 막힌다.
- Entry 함수 API나 변수 컨테이너를 찾지 못하면 추가가 막힌다.
- `function.content`가 올바른 JSON 문자열이 아니면 추가가 실패한다.

추가된 함수의 파라미터가 깨질 때:

- 정의부와 사용부의 `stringParam_*`, `booleanParam_*` 원본 타입이 서로 다르게 들어갔는지 확인한다.
- `function_field_string`, `function_field_boolean` 안의 타입과 본문에서 읽는 타입이 같은지 확인한다.

추가된 함수의 지역변수가 깨질 때:

- `localVariables[].id`와 `set_func_variable`, `get_func_variable`의 첫 번째 파라미터가 같은 원본 ID를 참조하는지 확인한다.

## 8. 현재 등록된 템플릿

현재 Chrome Web Store `2.4.0` 제출본에 등록된 템플릿은 없다.

초기 개발용 `test-function`은 함수 추가 구조와 ID 재생성을 검증하는 데 사용했지만 사용자용 이름과 내용이 아니므로 배포 패키지에서 제거했다. 이후 실제 템플릿을 추가할 때 이 절의 목록과 Chromium smoke 대상을 함께 갱신한다.

