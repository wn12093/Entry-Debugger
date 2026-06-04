# Entry Debugger 지식 베이스

Entry Debugger 개발 중 확인한 Entry 내부 동작, 확장 프로그램 설계 판단, 로컬 테스트 절차를 누적 관리하는 폴더입니다.

## 문서 목록

- [Entry Debugger 지식 관리 원칙](./entry-debugger-knowledge-management.md)
- [Entry 속성 사용 위치 추적 분석](./entry-attribute-usage-reference.md)
- [함수 내부 사용 위치 확장 설계](./function-internal-usage-extension.md)
- [Entry Debugger UI 통합 기록](./entry-debugger-ui-integration.md)
- [Entry 기본 변수 디버깅 확장 기록](./entry-system-variables-debugging.md)
- [변수/리스트 스코프 타입 변경 확장 기록](./entry-variable-list-scope-type-extension.md)
- [콘솔 디버깅 말하기 블록 옵션 확장 기록](./entry-dialog-yell-console-debugging.md)
- [함수 안에서 개인변수 보기](./function-private-variables-in-function-edit.md)
- [속성 검색으로 찾기](./dropdown-search-experiment.md)
- [Alt 단일 블록 드래그](./single-block-drag.md)
- [초고화질 이미지 저장하기](./high-quality-block-image-experiment.md)
- [함수 보관함](./function-library-experiment.md)
- [함수 보관함 템플릿 추가 절차](./function-library-template-authoring.md)
- [Entry Debugger 리팩토링 구조](./entry-debugger-refactor-architecture.md)
- [Entry Debugger 지원 기능 정리](./entry-debugger-supported-features.md)
- [Entry Debugger 소개 페이지 디자이너 프롬프트](./entry-debugger-designer-prompt.md)
- [Entry Debugger 아이콘 생성 프롬프트](./entry-debugger-icon-generation-prompt.md)
- [부스트/터보 모드 확장 기록](./entry-boost-turbo-mode-extension.md)
- [엔트리 .eo 저장 모양 생성기 기록](./entry-eo-generator-extension.md)
- [Entry .eo 내장 생성기 확정 사항](./entry-eo-built-in-generator.md)

## 관리 규칙

- Entry Debugger에만 종속되는 구현 지식은 이 폴더에서 관리합니다.
- 여러 엔트리 프로젝트에 공통으로 적용되는 작업 규칙만 `C:\Users\young\prg\ENTRY\_docs`에 기록합니다.
- 각 문서는 하나의 주제만 다룹니다.
- 분석 문서에는 확인 날짜, 분석 대상 파일, 핵심 흐름, 확장 개발에 필요한 포인트를 함께 남깁니다.
- Entry 원본 코드의 위치는 `entryjs-develop` 기준 상대 경로로 적습니다.
- 구현 중 새로 발견한 사실은 기존 문서에 `추가 확인` 성격으로 갱신합니다.
- 새 기능 문서를 추가하면 이 README의 문서 목록에 링크를 추가합니다.
