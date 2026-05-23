# Entry Debugger 지식 베이스

Entry Debugger 개발 중 확인한 Entry 내부 동작, 확장 프로그램 설계 판단, 로컬 테스트 절차를 누적 관리하는 폴더입니다.

## 문서 목록

- [Entry 속성 사용 위치 추적 분석](./entry-attribute-usage-reference.md)
- [함수 내부 사용 위치 확장 설계](./function-internal-usage-extension.md)
- [Entry Debugger UI 통합 기록](./entry-debugger-ui-integration.md)
- [Entry 기본 변수 디버깅 확장 기록](./entry-system-variables-debugging.md)
- [변수/리스트 스코프 타입 변경 확장 기록](./entry-variable-list-scope-type-extension.md)
- [콘솔 디버깅: 말하기 블록 외치기 모드 확장 기록](./entry-dialog-yell-console-debugging.md)

## 관리 규칙

- 한 문서는 한 주제만 다룹니다.
- 분석 문서에는 확인 날짜, 분석 대상 파일, 핵심 흐름, 확장 개발에 쓸 수 있는 포인트를 함께 남깁니다.
- Entry 원본 코드의 위치는 `entryjs-develop` 기준 상대 경로로 적습니다.
- 구현 중 새로 발견한 사실은 기존 문서에 "추가 확인" 섹션을 덧붙여 갱신합니다.
