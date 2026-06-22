# 부스트/터보 모드 확장 기록

확인 날짜: 2026-06-22

대상 기능: Entry의 숨겨진 실행/렌더링 옵션을 확장 모듈로 분리해 제공한다.

## 1. 부스트 모드

파일: `entry-debugger-extension/boost-mode.js`

핵심 플래그:

```js
Entry.options.useWebGL = '1';
```

확인한 동작:

- 실제 렌더링 파이프라인 전환은 `Entry.init()` 내부의 `GEHelper.INIT(useWebGL)` 시점에만 반영된다.
- 따라서 부스트 적용 토글 변경 후 새로고침이 필요하다.
- `is_boost_mode` 블록은 `!!Entry.options.useWebGL`을 직접 읽으므로 플래그 변경 자체는 즉시 블록 결과에 영향을 줄 수 있다.

구현 방식:

- `boost-mode.js`는 Main World에서 동작한다.
- content script를 `document_start`로 변경하고, 부스트 모듈을 가능한 한 빨리 주입한다.
- `window.Entry` setter를 가로채 Entry 객체가 할당될 때 패치한다.
- Entry 객체가 먼저 생기고 `Entry.init`이 나중에 붙는 경우를 대비해 최대 30초 재시도한다.
- `Entry.init(container, options)` 호출 전에 `options.useWebGL = '1'`을 주입한다.
- 부스트 설정은 `chrome.storage.local`에 저장하고, 페이지 새로고침 전에도 읽을 수 있게 `localStorage` 키 `__ENTRY_DEBUGGER_BOOST_MODE_ENABLED__`에 미러링한다.

설정 탭과 엔진 버튼:

- 디버깅 탭 안의 `설정` 탭에서 `부스트 모드 버튼` 토글은 엔진 화면 상단 부스트 토글을 보여줄지 결정한다.
- 실제 부스트 적용 여부는 엔진 상단의 `#ed-boost-mode-toggle` 버튼이 `boostModeEnabled`로 저장한다.
- 기본값은 버튼 표시 ON, 실제 부스트 OFF다.
- 엔진 버튼은 `.entryCoordinateButtonWorkspace_w` 뒤에 삽입해 화면상 좌표/격자 버튼 왼쪽에 표시한다.
- 버튼 UI는 실행 페이지의 `.entryEngineMinimize` 영역처럼 흰 배경 위 텍스트형 `부스트모드` 라벨과 초록 토글 스위치를 함께 보여준다.
- 작업실 전체화면에서는 엔트리가 같은 엔진 요소를 `.entryPopupWindow` 아래로 이동한다. 이 상태에서 부스트 토글도 절대 위치로 전환해 격자 버튼 왼쪽의 하단 제어줄로 함께 이동한다.
- 버튼을 클릭하면 `boost-mode.js`가 Entry page world에서 `Entry.toast.warning('부스트 모드', '새로고침 해야 반영됩니다.')`를 호출한다.
- 설정 탭에서 버튼 표시를 끄면 보이지 않는 부스트 활성 상태가 남지 않도록 실제 부스트도 OFF로 정규화한다.

## 2. 터보 모드

파일: `entry-debugger-extension/turbo-mode.js`

핵심 플래그:

```js
Entry.isTurbo = true;
```

확인한 동작:

- `Entry.isTurbo`는 코드 실행 루프에서 읽힌다.
- 실행 중 변경해도 다음 tick부터 반영된다.
- FPS 자체를 `Infinity`나 0ms로 만들지 않고, FPS는 60으로 유지한 채 `Entry.isTurbo`만 켜는 것이 안전하다.

구현 방식:

- `turbo-mode.js`는 Main World에서 동작한다.
- `Entry.Engine.prototype.setSpeedMeter`와 `toggleSpeedPanel`을 패치한다.
- `Entry.engine.speeds`에 `Infinity`를 추가해 속도 패널에 `∞` 셀을 만든다.
- `∞` 셀 선택 시 `Entry.FPS`는 60으로 맞추고 `Entry.isTurbo = true`로 설정한다.
- 일반 속도 셀을 선택하면 `Entry.isTurbo = false`로 되돌린다.
- 속도 패널은 열 때마다 새로 만들어지므로, `toggleSpeedPanel` 패치에서 매번 `∞` 셀을 다시 꾸민다.
- 속도 패널에는 `1`, `15`, `30`, `45`, `60`, `∞` 라벨을 표시한다. `∞` 라벨은 일반 속도 라벨과 같은 방식으로 셀 중앙에 정렬한다.
- 터보 기능을 켜거나 `∞` 속도를 선택하면 `.entrySpeedButtonWorkspace` 버튼에 짧은 깜빡임 애니메이션을 적용해 변화가 생겼음을 표시한다.

## 3. 확장 연결

변경 파일:

- `manifest.json`: 버전 `1.1.1`, `run_at: document_start`, web accessible resources에 `boost-mode.js`, `turbo-mode.js` 추가
- `content.js`: 부스트/터보 모듈 주입과 메시지 연결, `실험실` 탭 표시 여부와 터보 모드 활성 조건 제어
- `background.js`: `boostModeControlVisible`, `boostModeEnabled`, `labTabEnabled`, `turboModeEnabled` 설정 저장
- `popup.html`, `popup.js`: 디버깅 탭 표시 토글만 관리
- `content.js`: 설정 탭, 엔진 상단 `#ed-boost-mode-toggle` 삽입, 클릭 시 실제 부스트 설정 저장
- `boost-mode.js`: `Entry.init` 패치, 부스트 설정 미러링, Entry 내장 toast 안내

메시지:

```js
sendToInject('SET_BOOST_MODE_ENABLED', { enabled: true });
sendToInject('SET_TURBO_MODE_ENABLED', { enabled: true });
```

설정 정책:

- `boostModeControlVisible`은 엔진 상단 부스트 버튼 표시 여부다.
- `boostModeEnabled`는 실제 부스트 적용 여부다.
- 실제 부스트는 `enabled && boostModeControlVisible && boostModeEnabled`일 때만 적용한다.
- `실험실 탭`은 기본값 OFF다.
- `디버깅 탭`이 꺼지면 `실험실 탭`도 자동으로 꺼진다.
- `터보 모드` 토글은 디버깅 패널의 `실험실` 탭 안에 둔다.
- `터보 모드`도 기본값 OFF이며, `실험실 탭`이 꺼져 있으면 항상 비활성화한다.
- 전체 켜기/끄기는 실험실 탭 표시까지 제어하지만, 속도 패널의 `∞` 단계는 실험실 안의 `터보 모드` 토글이 켜진 경우에만 추가한다.

## 4. 검증 기록

정적 검사:

```powershell
node --check "Entry Debugger/entry-debugger-extension/boost-mode.js"
node --check "Entry Debugger/entry-debugger-extension/turbo-mode.js"
node --check "Entry Debugger/entry-debugger-extension/content.js"
node --check "Entry Debugger/entry-debugger-extension/popup.js"
node --check "Entry Debugger/entry-debugger-extension/background.js"
```

스모크 테스트:

- 부스트 모드 ON 상태에서 `Entry.init(null, {})` 호출 시 `options.useWebGL === '1'` 확인
- 부스트 모드 OFF 메시지 수신 시 localStorage 값과 강제 `Entry.options.useWebGL` 제거 확인
- 엔진 상단 `#ed-boost-mode-toggle` 클릭 시 `Entry.toast.warning`으로 새로고침 안내가 표시되는지 확인
- 작업실 전체화면 진입 시 부스트 토글이 `.entryPopupWindow` 안의 격자 버튼 왼쪽 하단으로 이동하고, 전체화면 종료 후 원래 작업실 위치로 복귀하는지 확인
- 터보 모드 ON 시 `engine.speeds`에 `Infinity` 추가 확인
- `engine.setSpeedMeter(Infinity)` 호출 시 `Entry.isTurbo === true`, `Entry.FPS === 60` 확인
- 일반 속도 선택 시 `Entry.isTurbo === false` 확인
- 터보 모드 OFF 시 `Infinity` 속도 제거 확인

## 5. 주의점

- 부스트 모드는 새로고침 전에는 렌더링 파이프라인이 바뀌지 않는다.
- 터보 모드는 즉시 적용되지만, 그래픽 병목이 큰 작품에서는 부스트 OFF 상태에서 체감이 제한될 수 있다.
- 두 기능은 서로 독립적이다. 부스트는 렌더링, 터보는 코드 실행 루프를 다룬다.
