# Entry Debugger 지식 관리 원칙

확인 날짜: 2026-06-02

이 문서는 Entry Debugger에만 종속되는 기능 지식을 체계적으로 관리하기 위한 기준이다. `C:\Users\young\prg\ENTRY\_docs` 공용 문서에는 여러 엔트리 프로젝트에 반복 적용되는 작업 규칙만 두고, Entry Debugger의 selector, 설정 키, 주입 스크립트, UI 동작은 이 폴더에서 관리한다.

## 범위

이 폴더에 기록할 내용:

- Entry Debugger 전용 기능 구현
- Entry Debugger 설정 키와 기본값
- Entry Debugger content script, injected script, popup, background 간 메시지 흐름
- Entry Debugger UI selector와 DOM 패치 기준
- Entry Debugger 전용 검증 포인트

공용 `_docs`로 보내야 하는 내용:

- 여러 엔트리 프로젝트에서 반복 사용하는 로컬 서버 실행 방법
- Chromium 테스트 수행 시점 같은 전역 검증 정책
- 프로젝트별 지식 위치를 찾는 방법
- 특정 구현에 종속되지 않는 문서화 절차

## 문서 계층

1. `README.md`
   - 지식 문서 인덱스
   - 새 기능 문서를 만들면 반드시 링크를 추가한다.

2. `entry-debugger-supported-features.md`
   - 사용자에게 보이는 기능 목록과 기본값 요약
   - 실험실 기능 추가/삭제/기본값 변경 시 갱신한다.

3. 기능별 문서
   - 구현 배경, 관련 파일, 설정 키, 메시지 payload, 검증 포인트를 기록한다.
   - 예: `dropdown-search-experiment.md`, `high-quality-block-image-experiment.md`

4. 설계/아키텍처 문서
   - 여러 기능에 걸친 구조 변화, 리팩터링 기준, UI 통합 기준을 기록한다.
   - 예: `entry-debugger-refactor-architecture.md`, `entry-debugger-ui-integration.md`

## 기능별 문서 템플릿

기능별 문서는 가능하면 아래 순서를 따른다.

```md
# 기능 이름

확인 날짜: YYYY-MM-DD
범위: Entry Debugger 전용

## 목적

## 관련 파일

## 설정 키와 기본값

## 활성/비활성 조건

## 메시지 흐름

## UI/DOM 기준

## 프로젝트 데이터 영향

## 검증 포인트

## 주의사항
```

## 실험실 기능 관리 규칙

- 실험실 기능은 기본적으로 꺼져 있어야 한다.
- `실험실 탭`이 꺼지면 실험실 안의 모든 기능은 즉시 비활성화되고 기본값으로 정규화되어야 한다.
- 다시 실험실을 켜면 각 실험 기능은 기본 꺼짐 상태에서 시작해야 한다.
- 실험실 하위 옵션도 실험실이 꺼질 때 기본값으로 돌아가야 한다.
- 실험실 메인 토글이 켜진 상태에서 개별 실험 기능만 껐다 켜는 경우에는 해당 기능의 하위 옵션을 유지할 수 있다.

Entry Debugger 기준 실험실 기본값:

```js
eoUploaderEnabled: false,
turboModeEnabled: false,
dropdownSearchEnabled: false,
dropdownSearchBlockMenuEnabled: true,
dropdownSearchPropertyPanelEnabled: true,
blockTextCopyEnabled: false,
highQualityBlockImageEnabled: false,
highQualityBlockImageScale: 1000,
functionLibraryEnabled: false
```

Entry Debugger 기준 주요 비실험 기능 기본값:

```js
enabled: true,
debuggerTabEnabled: true,
functionUsageEnabled: true,
consoleDebuggingEnabled: true,
functionPrivateVariablesEnabled: true,
boostModeControlVisible: false,
boostModeEnabled: false
```

## 현재 핵심 기능 문서

- 속성 검색으로 찾기: `dropdown-search-experiment.md`
- 초고화질 이미지 저장하기: `high-quality-block-image-experiment.md`
- 함수 보관함: `function-library-experiment.md`
- 함수 보관함 템플릿 추가 절차: `function-library-template-authoring.md`
- 전체 지원 기능 요약: `entry-debugger-supported-features.md`
- 부스트/터보 모드: `entry-boost-turbo-mode-extension.md`
- 다량 이미지 업로더: `entry-eo-generator-extension.md`, `entry-eo-built-in-generator.md`

## 갱신 체크리스트

- 새 기능을 추가했는가? `README.md`에 문서 링크를 추가한다.
- 사용자에게 보이는 기능인가? `entry-debugger-supported-features.md`를 갱신한다.
- 실험실 기능인가? 실험실 off 기본값 복귀 정책을 확인한다.
- Main World 주입 스크립트가 있는가? 메시지 payload와 ready/result 이벤트를 문서에 남긴다.
- DOM selector를 사용했는가? selector와 변경 시 위험을 기능 문서에 남긴다.
- 프로젝트 JSON을 건드리지 않는 UI-only 기능인가? 데이터 무변경 원칙을 명시한다.
