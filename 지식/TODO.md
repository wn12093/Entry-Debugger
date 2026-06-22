---
상태: 설계
범위: 프로젝트:Entry Debugger
갱신: 2026-06-22
---

# Entry Debugger 할 일

## 블록 텍스트 복사 조건문 오류 수정

- [ ] `블록 텍스트 복사`에서 `만약 ~라면 ~아니면` 블록이 정상적인 코드 텍스트로
  복사되지 않는 문제를 재현하고 수정한다.

확인할 내용:

- `만약` 조건, 참 분기, `아니면` 분기가 모두 빠짐없이 복사되는지
- 각 분기의 블록 순서와 줄바꿈이 유지되는지
- 조건문 안에 조건문이 중첩된 경우에도 구조가 구분되는지
- 일반 `만약 ~라면` 블록과 기존 블록 텍스트 복사 동작에 회귀가 없는지

관련 구현:

- `entry-debugger-extension/block-text-copy.js`
- `entry-debugger-extension/content.js`

## 함수 보관함 예제 추가

- [ ] 함수 보관함에 `숫자 한글로` 함수 예제를 하나 추가한다.

구현 전에 정할 내용:

- 숫자를 한글 읽기 형태로 바꾸는 입력·출력 규칙
- 0, 음수, 큰 수, 소수 처리 범위
- 함수 카드 이름과 설명
- 현재 작품에 추가한 뒤 실제 호출 가능한지 검증하는 시나리오

관련 문서와 구현:

- `function-library-template-authoring.md`
- `function-library-experiment.md`
- `entry-debugger-extension/function-library-templates.js`
