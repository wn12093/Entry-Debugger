# 엔트리 디버깅 툴 (Entry-Debugger)

엔트리(Entry) 코딩 플랫폼의 작품 편집기에서 **변수·리스트·신호·장면**을
실시간으로 모니터링하고 직접 제어할 수 있는 크롬 확장프로그램입니다.

- **대상 페이지**: `https://playentry.org/ws/*` (작품 편집기 화면)
- **버전**: 2.2.0

## 설치

- **Chrome Web Store**: [엔트리 디버깅 툴](https://chromewebstore.google.com/detail/%EC%97%94%ED%8A%B8%EB%A6%AC-%EB%94%94%EB%B2%84%EA%B9%85-%ED%88%B4/meginahneajajhniecgebilpldnabkob)
- 또는 개발자 모드로 직접 로드:
  1. Chrome → `chrome://extensions` → **개발자 모드** 활성화
  2. **압축해제된 확장 프로그램 로드** → `entry-debugger-extension/` 선택

## 개발 및 검증

```powershell
npm run check
npm run build:dev
npm run smoke:local
```

- `npm run check`: manifest/README 버전 일치, 확장 리소스 존재 여부, JS 문법을 확인합니다.
- `npm run build:dev`: 로컬 Entry 서버에서도 동작하는 개발용 확장을 `dist/entry-debugger-extension-dev/`에 생성합니다. Chrome match pattern 제약 때문에 개발용 manifest는 `http://127.0.0.1/*`, `http://localhost/*`를 포함하고, 실제 동작 여부는 content script 내부에서 `/ws/*`로 다시 제한합니다.
- `npm run smoke:local`: 로컬 Entry 만들기 화면에서 Chromium 기반 확장 주입과 핵심 UI 동작을 확인합니다. PR 생성 또는 PR 브랜치 업데이트 직전에 실행합니다.
- 실제 Chrome Web Store 제출용 폴더는 계속 `entry-debugger-extension/`입니다.

## 사용 방법

1. 확장 아이콘을 눌러 **디버거 활성화** 토글을 켭니다.
2. 엔트리 작품 편집기 우측 패널에 **[디버깅] 탭**이 추가됩니다.
3. 탭 내부에는 4개 카테고리(**변수 / 리스트 / 신호 / 장면**)가 있습니다.

> 이미 열려 있던 페이지는 새로고침 후에 적용됩니다.

## 주요 기능

### 변수
- 전역·지역 변수의 현재 값을 200ms 주기로 실시간 표시
- **값을 클릭**하면 입력창으로 전환 → 새 값 입력 후 적용
- 작품이 실행 중이어도 즉시 반영

### 리스트
- 리스트 헤더를 클릭해 펼치면 모든 항목을 한눈에 확인
- 각 항목을 클릭해 수정 / 삭제, 하단 입력창으로 새 항목 추가

### 신호
- 등록된 신호 목록 표시
- **"신호 보내기"** 버튼으로 강제 발생 (`entry.engine.raiseMessage` 호출)
- "신호를 받았을 때" 블록을 즉시 트리거

### 장면
- 모든 장면 목록 표시
- **"이동"** 버튼으로 장면 전환 + 실행 중이면 "장면이 시작되었을 때" 이벤트 자동 발화

## v2.2.0 변경사항
- 함수 보관함 실험 기능과 테스트 함수 추가 기능을 추가
- 디버깅 탭 내부 설정 화면을 추가하고 기존 기능 토글을 설정 탭으로 이동
- 엔트리 실행 화면 상단에 부스트모드 토글을 추가하고 Entry 실행 페이지 UI 스타일에 맞춰 조정
- 설정 버튼을 다시 누르면 직전 탭으로 돌아가도록 개선
- 함수 보관함 안내 문구와 설정 버튼 hover 회전 효과를 추가

## v2.1.1 변경사항

- 디버깅 탭 아이콘의 비활성 상태를 Entry 기본 속성 탭과 같은 연한 파란 배경 타일 스타일로 조정
- 초고화질 이미지 저장하기 배율 슬라이더를 Entry 기본 슬라이더 느낌으로 조정
- 속성 검색으로 찾기 하위 선택 UI를 Entry 라디오 버튼 스타일에 맞게 조정

## v2.1.0 변경사항

- 실험실 기능으로 초고화질 블록 이미지 저장 옵션 추가
- 블록 우클릭 이미지 저장과 배경 우클릭 전체 코드 이미지 저장에 200%~2000% 배율 적용
- 1000% 이상일 때 다운로드 지연 안내를 검은색으로 표시
- 속성 검색으로 찾기 기능에 블록꾸러미/속성 탭 하위 적용 설정 추가

## v1.0.6 변경사항

- 변수·리스트 값 표시 방식을 입력창 → 버튼으로 변경 (긴 문자열 렌더링 부담 완화)
- 15자를 넘는 값은 잘려서 표시되며, 마우스를 올리면 전체값이 툴팁으로 보임
- 클릭 시에만 입력창으로 전환되어 편집 가능 (Enter 적용 / Escape 취소)
- 편집 중인 항목은 폴링 갱신에 덮어쓰지 않도록 보호
- 빈 값일 때 클릭 영역이 보이도록 `(빈 값)` placeholder 표시
- 따옴표(`"`)가 포함된 값도 안전하게 처리

## 구조

```
entry-debugger-extension/
├── manifest.json   Manifest V3 설정
├── popup.html      확장 아이콘 팝업 UI
├── popup.js        팝업 토글 / 활성화 상태 관리
├── background.js   서비스 워커 (메시지 라우팅)
├── content.js      컨텐트 스크립트 — 디버거 패널 UI
├── inject.js       Main world 스크립트 — Entry API 직접 제어
└── style.css       디버거 UI 스타일
```

`content.js` ↔ `inject.js` 는 `window.postMessage` (채널 `__ENTRY_DEBUGGER__`)
로 통신하며, 200ms 폴링으로 스냅샷 변경분만 브로드캐스트해 비용을 최소화합니다.
