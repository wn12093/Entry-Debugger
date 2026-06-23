# Entry Debugger 알림·팝업 시스템과 디자인 규약

확인 날짜: 2026-06-23

디버거가 **엔트리 페이지 안에** 띄우는 알림·팝업·메뉴의 종류와, 어떤 경우에 무엇을
쓰는지에 대한 규약이다. (브라우저 액션 팝업 `popup.html`이 아니라 작업실 화면 위에
뜨는 UI를 다룬다. 브라우저 액션 팝업 토글은
[entry-debugger-ui-integration.md](./entry-debugger-ui-integration.md) 참고.)

## 대상 파일

| 파일 | 역할 |
| --- | --- |
| `entry-debugger-extension/content.js` | `showToast(type, title, message)` → `SHOW_ENTRY_TOAST` 브리지 |
| `entry-debugger-extension/inject.js` | `showEntryToast()` → `Entry.toast[type](title, message)` 호출(page world) |
| `entry-debugger-extension/picture-tools.js` | `nativeToast`/`nativeConfirm`/`prog`/`styledPrompt`/컨텍스트 메뉴 |
| `entry-debugger-extension/boost-mode.js` | `showEntryToast` → `Entry.toast.warning`(page world) |
| `entry-debugger-extension/block-text-copy.js` | `BLOCK_TEXT_COPY_TOAST`로 content에 토스트 위임 |
| `entryjs-develop/src/class/toast.js` | 엔트리 토스트 원본(`success`/`warning`/`alert`) |
| `entryjs-develop/src/css/components/toast.less` | 엔트리 토스트 팔레트 SSOT |

## 인벤토리 (현행)

| 종류 | 출처 | 위치·모양 | 쓰임 |
| --- | --- | --- | --- |
| `Entry.toast`(success/warning/alert) | 엔트리 네이티브 | 화면 우하단, 자동소멸 | **모든 단발성 알림** |
| `Entry.modal.confirm` | 엔트리 네이티브 | 화면 중앙 차단 | 모양 일괄 삭제 확인 |
| `Entry.ContextMenu.show`(후킹) | 엔트리 네이티브 | 우클릭 | 모양 행 우클릭 |
| `styledPrompt` | 자체 DOM(엔트리 모달 룩 모방) | 화면 중앙 | 모양 일괄 이름변경 입력 |
| `#ed-picture-tools-prog` | 자체 DOM(엔트리 토스트 룩) | 화면 상단 중앙 알약 | 모양 진행 표시 |
| 자체 DOM 메뉴 | 자체 DOM | 우클릭 | 빈 목록 영역 붙여넣기 |

> 인라인 상태줄(`.ed-generator-status`, `.ed-function-library` 상태)과 상주 오버레이
> (`#ed-frame-profiler`)는 단발성 알림이 아니라 패널/다이얼로그 내부 상태 표시라 이 규약 밖.

## 핵심 규약

### 1. 단발성 알림은 엔트리 네이티브 토스트로 통일
성공/경고/오류 같은 비차단 알림은 **반드시 `Entry.toast`**(화면 우하단)를 쓴다.
자체 DOM 토스트를 새로 만들지 않는다.

- isolated world(content.js)에서는 `Entry.toast`를 직접 못 부르므로 브리지 경유:
  `showToast(type, title, message)` → `sendToInject('SHOW_ENTRY_TOAST', {type,title,message})`
  → inject.js `showEntryToast()` → `Entry.toast[type](title, message)`.
- page world 모듈(picture-tools, boost-mode)은 `safeGetEntry().toast`를 직접 호출한다.
- `type`은 `success` | `warning` | `alert` 셋만. inject.js에서 그 외 값은 `success`로 보정.
- 엔트리 토스트는 `(title, message)` 2줄 렌더이므로 **짧은 제목 + 본문** 형태로 넘긴다.
  예: `showToast('success', '장면 전환', '완료되었습니다.')`.
- 자동소멸: success/warning 약 1초, alert 약 5초(엔트리 기본). 폴백 없음 — `Entry.toast`
  부재 시 알림은 무동작(디버거 패널은 Entry 로드 후 주입되므로 실질적으로 항상 존재).

### 2. 사용자 결정이 필요한 차단 확인은 `Entry.modal.confirm`
삭제·덮어쓰기 등은 `Entry.modal.confirm(message, title)`(Promise<boolean>). 구버전 대비
`window.confirm` 폴백만 둔다.

### 3. 텍스트 입력은 `styledPrompt` (엔트리에 네이티브 prompt가 없음)
`Entry.modal`은 `alert`/`confirm`만 제공한다. 단일 행 텍스트 입력이 필요한 경우
(모양 일괄 이름변경) 엔트리 confirm 모달 룩을 모방한 `styledPrompt`를 쓴다. 새 입력
UI가 필요하면 이 함수를 재사용한다.

### 4. 컨텍스트 메뉴는 가능하면 엔트리 네이티브
모양 행 우클릭은 `Entry.ContextMenu.show`를 후킹해 항목만 교체한다. 단, **빈 목록 영역**
우클릭은 엔트리 자체 핸들러가 직후 메뉴를 가려버려 네이티브를 못 쓴다 → 그 경우만
자체 DOM 메뉴를 띄운다.

### 5. 진행 표시 알약은 예외적 위치, 스타일만 엔트리
GIF 분해·대량 업로드·ZIP 내보내기 진행은 "모양 추가하기" 다이얼로그가 네이티브
우하단 토스트를 가리기 때문에 상단 중앙 알약(`#ed-picture-tools-prog`)으로 띄운다.
**위치만 예외**이고 시각 토큰은 엔트리 토스트에 맞춘다(아래).

## 엔트리 토스트 팔레트 (SSOT: `entryjs-develop/src/css/components/toast.less`)

| type | 배경 | 테두리 | 글자 |
| --- | --- | --- | --- |
| success | `#e5f3df` | `#d6e9c6` | `#468847` |
| warning | `#fff9ab` | `#7e7190` | `#e07000` |
| alert | `#f2dede` | `#eed3d7` | `#b94a48` |
| 중립(base) | `#eee` | — | 진회색 |

공통: `border:2px solid`, `border-radius:4px`, `box-shadow:#999 0 0 8px`,
`text-shadow:0 1px 0 rgba(255,255,255,.5)`, 제목 12pt bold / 본문 9pt.

### 진행 알약(`prog`) 스타일
- 일반: 배경 `#eef2f7` / 테두리 `#d4dbe6` / 글자 `#3a3f4b` (엔트리 중립 토스트 차용)
- 오류: alert 팔레트(`#f2dede` / `#eed3d7` / `#b94a48`)
- `border-radius:4px` + `2px` 테두리 + `box-shadow:#999 0 0 8px` — 엔트리 토스트와 동일
  토큰. 상단 중앙 고정만 유지.

## 이력

- **2026-06-23**: 디버거 패널 자체 토스트(`.ed-toast`, 패널 안 하단 중앙, 파랑/빨강
  2색)를 **전면 제거**하고 엔트리 네이티브 토스트로 통일. content.js `showToast`
  호출부 13곳을 `(type, title, message)`로 명시, `BLOCK_TEXT_COPY_TOAST` 릴레이는
  `error→alert / 그 외→success` 매핑. 진행 알약을 솔리드 파랑/빨강(`border-radius:999px`,
  흰 글자)에서 엔트리 토스트 룩으로 재스타일.

## 관련 공통 지식

- [`_docs/entry-notification-api.md`](../../../_docs/entry-notification-api.md) —
  `Entry.toast`·`modal`·`popupHelper` API SSOT(타입별 용도·사용 기준)
- [entry-debugger-ui-integration.md](./entry-debugger-ui-integration.md) — 패널/탭 통합, 브라우저 액션 팝업 토글
- [entry-boost-turbo-mode-extension.md](./entry-boost-turbo-mode-extension.md) — 부스트 토글 토스트, 전체화면 위치
