# 엔트리 디버깅 툴 (Entry-Debugger)

엔트리(Entry) 코딩 플랫폼에서 변수와 리스트를 실시간으로 모니터링·수정할 수 있는 크롬 확장프로그램입니다.

- **대상 페이지**: `https://playentry.org/ws/*` (작품 편집기 화면)
- **버전**: 1.0.5

## 설치
- **Chrome Web Store**: https://chromewebstore.google.com/detail/%EC%97%94%ED%8A%B8%EB%A6%AC-%EB%94%94%EB%B2%84%EA%B9%85-%ED%88%B4/meginahneajajhniecgebilpldnabkob
- 또는 개발자 모드로 직접 로드:
  1. Chrome → `chrome://extensions` → **개발자 모드** 활성화
  2. **압축해제된 확장 프로그램 로드** → `entry-debugger-extension/` 선택

## 주요 기능
- 작품 실행 중 변수·리스트 값 실시간 표시
- 값을 직접 수정해 동작 확인
- 엔트리 작품 디버깅·테스트 자동화에 활용

## 구조
- `entry-debugger-extension/manifest.json` — Manifest V3
- `content.js` / `inject.js` — 작품 페이지에 디버거 주입
- `popup.html` / `popup.js` — 확장프로그램 팝업 UI
- `background.js` — 서비스 워커
