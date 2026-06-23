# Chrome Web Store 2.4.0 제출 점검

확인 날짜: 2026-06-06

## 배포 범위

- 제출 ZIP에는 `entry-debugger-extension/` 폴더의 내용만 포함한다.
- `manifest.json`은 ZIP 루트에 위치해야 한다.
- `tools/`, `dist/`, `지식/`, 캡처 파일은 제출 ZIP에 포함하지 않는다.

## 제출 전 정리

- 개발 검증용 `테스트 함수` 템플릿 제거
- production `content.js`에서 localhost 분기 제거
- 로컬 Entry 지원은 `npm run build:dev`가 만든 `dist/entry-debugger-extension-dev/`에만 추가
- 시작 시 출력하던 `준비 완료` 콘솔 로그 제거
- 기존 2.3.0 ZIP은 최신 파일이 누락된 오래된 제출물이므로 재생성

## 자동 검사

`npm run check`는 다음을 확인한다.

- manifest와 README 버전 일치
- manifest가 참조하는 확장 리소스 존재
- production `content.js`에 localhost 호스트 없음
- production 함수 템플릿에 개발용 테스트 함수 없음
- popup에 원격 스크립트 태그 없음
- 배포 JavaScript에 `eval()` 또는 `new Function()` 없음
- 전체 JavaScript 문법 검사

## 제출 검증

```powershell
npm run check
npm run build:dev
npm run smoke:local
```

Chromium smoke 완료 후 로컬 Entry 서버가 8080 포트에 남아 있지 않은지 확인한다.

검증 결과:

- `npm run check`: 통과
- `npm run build:dev`: 통과
- `npm run smoke:local`: 통과
- 팝업 표시 버전: `v2.4.0`
- Alt 단일 블록 드래그 기본값: 꺼짐
- 함수 보관함: 빈 상태 표시, 테스트 추가 버튼 없음
- 로컬 Entry 서버 종료: `NO_LISTENER_8080`

## 제출 파일

- 경로: `entry-debugger-extension.zip`
- 크기: `109542` bytes
- SHA-256: `9E08DE5652311F1BCBC70B601111B08BEF2EBA6B8D562B76E036BC7CF8897F78`
- ZIP 루트의 `manifest.json`: 확인
- ZIP 파일 수: 25
- 소스와 ZIP 내용 차이: 0
- 테스트/로컬/도구/지식 파일 혼입: 0

## 제출 상태

- 버전: `2.4.0`
- Chrome Web Store 업로드: 대기
