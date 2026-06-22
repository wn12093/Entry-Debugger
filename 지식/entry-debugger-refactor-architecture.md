# Entry Debugger 리팩토링 구조

확인 날짜: 2026-05-24

대상 버전: `2.0.0`

## 목적

Entry 업데이트로 내부 API나 DOM 구조가 바뀌어도 고장 지점을 빠르게 찾을 수 있도록 공통 코어를 추가했다.

기존에는 각 page-world 모듈이 `window.Entry`, `window.postMessage`, prototype patch를 직접 처리했다. 이제 다음 세 모듈을 먼저 주입하고 기능 모듈이 이를 사용한다.

## 공통 코어

파일: `entry-debugger-extension/page-bridge.js`

- `__ENTRY_DEBUGGER__` 채널 상수 관리
- `window.postMessage` 송신 공통화
- origin/channel 검증 공통화
- page-world 모듈의 `READY`/`RESULT` 메시지 형식 통일

파일: `entry-debugger-extension/entry-adapter.js`

- `Entry` / `Entry.variableContainer` / `Entry.container` 접근 공통화
- 현재 오브젝트, 오브젝트 이름, 변수/리스트 id/name 읽기 공통화
- 블록 메뉴 리로드 `refreshBlockMenu(category)` 제공
- Entry 내부 구조가 바뀌면 우선 이 파일을 확인한다.

파일: `entry-debugger-extension/patch-registry.js`

- `patchMethod(owner, methodName, patchId, createWrapper)` 제공
- 같은 메서드가 SPA 재진입이나 설정 변경으로 중복 래핑되는 것을 방지
- 원본 메서드 참조를 registry에 저장

## 이관된 기능

다음 모듈은 공통 코어를 사용하도록 정리했다.

- `boost-mode.js`: `Entry.init` 래핑을 PatchRegistry 경유로 처리
- `turbo-mode.js`: `Entry.Engine.prototype.setSpeedMeter`, `toggleSpeedPanel` 래핑을 PatchRegistry 경유로 처리
- `console-debugging.js`: `dialog` / `dialog_time` 블록 `func` 래핑을 PatchRegistry 경유로 처리
- `function-private-variables.js`: `Entry.container.getDropdownList`, `FieldDropdownDynamic.getTextByValue` 래핑을 PatchRegistry 경유로 처리
- `dropdown-search.js`: `FieldDropdownDynamic.renderOptions` 래핑을 PatchRegistry 경유로 처리
- `function-usage-inspector.js`: Entry 접근과 메시지 송신을 Adapter/Bridge 경유로 처리
- `inject.js`: Entry 접근, 스냅샷 송신, 명령 결과 송신의 1차 경로를 Adapter/Bridge 경유로 처리

## manifest 보안 범위

Chrome Web Store 제출 대비로 content script는 다음 범위로 제한했다.

```json
"matches": ["https://playentry.org/ws/*"]
```

`web_accessible_resources.matches`는 Chrome MV3에서 path가 있는 패턴을 거부할 수 있으므로 다음 origin 범위를 사용한다.

```json
"matches": ["https://playentry.org/*"]
```

실제 page-world 주입은 `/ws/*`에서만 실행되는 content script가 수행하므로, 확장 기능은 Entry 작업실 URL에서만 동작한다.

## 남은 리팩토링 후보

- `content.js`는 여전히 UI 렌더링, 설정 lifecycle, 기능 lifecycle을 함께 가진다. 다음 단계에서는 `debugger-panel`, `feature-lifecycle`, `settings-client`로 나누는 것이 좋다.
- `inject.js`는 명령 handler가 아직 한 파일에 있다. 다음 단계에서는 `runtime-variables`, `runtime-lists`, `runtime-scenes`, `runtime-generator`로 분리하는 것이 좋다.
- 내장 `.eo` 다량 이미지 업로더는 모양 탭 편의 기능과 역할이 겹쳐 2026-06-23 제거했다.

## 검증 포인트

- page-world 코어 3개가 기능 모듈보다 먼저 주입된다.
- PatchRegistry가 같은 메서드를 두 번 감싸지 않는다.
- Bridge가 origin/channel이 맞는 메시지만 처리한다.
- manifest의 content script가 `https://playentry.org/ws/*`로 제한된다.
- `web_accessible_resources`는 Chrome이 허용하는 `https://playentry.org/*` 패턴을 사용한다.
