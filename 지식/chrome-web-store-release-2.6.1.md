# Chrome Web Store 2.6.1 제출 점검

확인 날짜: 2026-06-23

대상 브랜치: `refactor/reliability-release-2.6.1`

## 범위

- 설정 정규화 특성 테스트 추가
- page-core 성공 경로 특성 테스트 추가
- `inject.js` 강제 재동기화 로직을 `forceResync()`로 통합
- 확장 버전 `2.6.1`

설정 스키마화, page-world fallback 제거, Promise 로더 전환, 재시도 컨트롤러 통합,
god file 분리는 이번 제출본에 포함하지 않는다.

## 검증 명령

```powershell
npm.cmd run check
npm.cmd run build:dev
node C:\tmp\verify-entry-debugger-toast.js
git diff --check
```

로컬 Entry 전체 smoke는 `127.0.0.1:8080` 작업실 서버와 외부 Entry 자원이 모두
사용 가능한 경우에만 실행한다. 실행하지 못한 검증은 제출 판단에서 별도로 명시한다.

## 제출 ZIP 기준

- ZIP 루트에 `manifest.json`이 있어야 한다.
- `entry-debugger-extension/`의 배포 파일만 포함한다.
- `dist/`, `tools/`, `지식/`, 테스트 fixture를 포함하지 않는다.
- ZIP 내부 파일 목록과 SHA-256을 원본 폴더와 대조한다.

## 최종 결과

### 통과

- `npm.cmd run check`
- `npm.cmd run build:dev`
- `git diff --check`
- 독립 Chromium 회귀 하네스 `C:\tmp\verify-entry-debugger-toast.js`
  - 엔트리 네이티브 성공·경고·오류 토스트
  - 설정 초기화
  - 블록 텍스트 복사
  - 모양 삭제 confirm·이름변경 prompt·업로드 진행 표시
  - 기존 `.ed-toast` 미생성
- production 확장 폴더에 test/spec/fixture/smoke/source map 없음
- manifest 권한은 `storage`만 사용
- production content script는 `https://playentry.org/ws/*`만 대상

### 제한된 검증

`npm.cmd run smoke:local`은 로컬 Entry 서버와 개발용 확장을 정상 기동했지만,
브라우저에서 외부 Entry 자원이 `net::ERR_NETWORK_ACCESS_DENIED`로 차단됐다.
그 결과 Entry의 `.propertyTab`이 생성되지 않아 180초 대기 뒤 종료됐다.
확장 콘솔 오류나 이번 변경의 assertion 실패로 판정하지 않는다.

`npm.cmd run smoke:picture-tools`와 `npm.cmd run smoke:frame-profiler`는 같은 로컬
Entry 작업실 DOM이 준비되지 않은 상태라 별도로 실행하지 않았다. 두 검증의 상태는
실패나 BLOCKED가 아니라 **미실행(NOT RUN)** 이다.

### 제출 파일

- 경로: `Entry-Debugger-2.6.1-chrome-web-store.zip`
- 크기: 137,636 bytes
- SHA-256: `D643F4B73C9C1BB2388FD213B5BCE31234724CB471A336E9C3CA019691ADAA61`
- 원본 파일: 26개
- 압축 해제 파일: 26개
- ZIP 루트 `manifest.json`: 확인
- 원본과 압축 해제본 파일별 SHA-256 차이: 0개

## 잔여 위험

- page-core 로더의 Promise 순차 처리와 `onerror`·실패 후 재시도는 이번 릴리스
  범위가 아니며, 현재 특성 테스트도 성공 경로만 고정한다.
- 실제 `playentry.org/ws`와 외부 자원이 완전히 로드되는 로컬 Entry 전체 smoke는
  현재 네트워크 정책 때문에 수행하지 못했다.
- 제품 기능과 manifest 권한은 2.6.0에서 바꾸지 않았으며, 이번 제품 코드 변경은
  `forceResync()` 추출뿐이다.
