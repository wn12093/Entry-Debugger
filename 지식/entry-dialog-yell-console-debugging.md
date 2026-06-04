# 콘솔 디버깅: 말하기 블록 외치기 모드 확장 기록

확인 날짜: 2026-05-24

대상 기능: Entry 말하기 계열 블록의 숨겨진 `yell` 모드와 콘솔 로그 스타일 5종을 `콘솔 디버깅` 기능으로 노출하고, 디버깅 탭 내부 설정에서 별도 토글로 켜고 끈다.

## 1. Entry 원본에서 확인한 사실

`Entry.Dialog`는 `speak`, `think`, `ask`, `yell` 모드를 처리할 수 있다. `yell`은 지그재그/별 모양 말풍선 렌더링 분기가 살아 있지만, 블록 드롭다운에서는 주석 처리되어 노출되지 않는다.

또한 `dialog` 블록의 `OPTION` 값은 콘솔 출력 라인의 CSS 클래스로도 부착된다. 따라서 임의 문자열을 옵션 값으로 넣으면 콘솔 탭에서 색상/강조 스타일을 재사용할 수 있다.

영향받는 블록:

| 블록 | 드롭다운 위치 | 값 |
|---|---|---|
| `dialog` | `Entry.block.dialog.params[1].options` | 아래 6개 옵션 |
| `dialog_time` | `Entry.block.dialog_time.params[2].options` | 아래 6개 옵션 |

텍스트 코딩 모드는 가능한 경우 `syntax.py[*].textParams[2].options`에도 같은 옵션을 추가한다.

추가 옵션:

| 라벨 | OPTION 값 | 효과 |
|---|---|---|
| 외치기 | `yell` | 캔버스 별 모양 말풍선 |
| `[LOG]` | `entryDebuggerLog` | 콘솔 기본 스타일 |
| `[INFO]` | `ask ` | 콘솔 파란색 계열 |
| `[WARN]` | `speak ` | 콘솔 노란색 계열 |
| `[ERROR]` | `targetChecker fail simplebar-mask` | 콘솔 빨간 강조 |
| `[DEBUG]` | `entryDimmed` | 콘솔 흐림 |

## 2. 확장 구현

파일: `entry-debugger-extension/console-debugging.js`

- Main World에 주입되는 별도 스크립트로 분리했다.
- `SET_CONSOLE_DEBUGGING_ENABLED` 메시지를 받아 기능을 켜고 끈다.
- 켜기: `외치기`, `[LOG]`, `[INFO]`, `[WARN]`, `[ERROR]`, `[DEBUG]` 옵션을 `dialog`, `dialog_time` 드롭다운에 추가한다.
- 끄기: 확장이 추가한 6개 옵션만 제거한다.
- `dialog`, `dialog_time` 실행 함수를 한 번만 래핑한다. 콘솔 로그용 OPTION 값은 `Entry.Dialog`로 보내지 않고 `Entry.console.print()`로만 출력한다.
- 이 래핑은 Entry 프로젝트 JSON을 수정하지 않는다. 저장된 블록 파라미터는 그대로 두고 실행 시점에만 처리한다.
- 옵션 배열에 같은 OPTION 값이 이미 있으면 중복 추가하지 않는다.
- 옵션에 내부 마커를 붙여, 향후 Entry 본체가 같은 OPTION 값을 네이티브로 제공할 경우 그 옵션은 제거하지 않는다.
- Entry 블록 정의가 늦게 준비되는 경우를 대비해 최대 30초 동안 재시도한다.
- 변경 후 `Entry.playground.blockMenu.deleteRendered('looks')`와 `reloadPlayground()`로 블록 메뉴를 갱신한다.

콘솔 로그용 OPTION 값 처리:

| 저장된 OPTION 값 | 콘솔 클래스 | 비고 |
|---|---|---|
| `entryDebuggerLog` | 빈 문자열 | 현재 `[LOG]` 옵션 |
| 빈 문자열 | 빈 문자열 | 예전 `[LOG]` 작품 호환 |
| `ask ` | `ask ` | `[INFO]` |
| `speak ` | `speak ` | `[WARN]` |
| `targetChecker fail simplebar-mask` | 동일 | `[ERROR]` |
| `entryDimmed` | 동일 | `[DEBUG]` |

중요한 이유:

- `Entry.Dialog`는 실제 캔버스 말풍선 모드로 `speak`, `think`, `ask`, `yell`만 처리한다.
- `ask `, `speak `처럼 공백이 붙은 값이나 `entryDimmed` 같은 콘솔 클래스 값을 그대로 `Entry.Dialog`에 넘기면 말풍선 객체가 생성되지 않은 상태로 `Entry.stage.loadDialog()`가 호출될 수 있다.
- 따라서 콘솔 로그용 값은 실행 래퍼에서 콘솔 출력만 하고 `script.callReturn()`으로 흐름을 끝내야 한다.
- `dialog_time`의 콘솔 로그용 값은 말풍선 없이 콘솔에 한 번 출력하되, 원래 블록처럼 지정 시간 동안 대기한 뒤 다음 블록으로 넘어간다.

파일: `entry-debugger-extension/content.js`

- `console-debugging.js`를 주입하는 `injectConsoleDebuggingScript()`를 추가했다.
- 설정 필드 `consoleDebuggingEnabled`를 추가했다.
- 확장이 활성화된 Entry 작업실에서는 콘솔 디버깅 토글이 꺼져 있어도 `console-debugging.js`를 주입한다. 이는 기존 작품에 저장된 콘솔용 OPTION 값이 `Entry.Dialog`로 직접 흘러가 실행을 깨뜨리는 일을 막기 위한 런타임 보호 장치다.
- `CONSOLE_DEBUGGING_READY` 수신 시 현재 설정에 따라 `SET_CONSOLE_DEBUGGING_ENABLED`를 보낸다. 꺼짐 상태에서는 옵션을 숨기고 콘솔 출력도 하지 않지만, 콘솔용 OPTION 값은 안전하게 no-op 처리된다.

파일: `entry-debugger-extension/popup.html`, `popup.js`, `background.js`

- 팝업에 `콘솔 디버깅` 토글을 추가했다.
- 전체 토글은 `디버깅 탭`, `함수 사용 바로가기`, `콘솔 디버깅` 세 기능을 함께 제어한다.
- 현재 확장 버전은 `2.3.0`이다.

## 3. 메시지 형식

```js
sendToInject('SET_CONSOLE_DEBUGGING_ENABLED', {
  enabled: true
});
```

## 4. 검증 기록

정적 검사:

```powershell
node --check "Entry Debugger/entry-debugger-extension/console-debugging.js"
node --check "Entry Debugger/entry-debugger-extension/content.js"
node --check "Entry Debugger/entry-debugger-extension/popup.js"
node --check "Entry Debugger/entry-debugger-extension/background.js"
```

스모크 테스트:

- 가짜 `Entry.block.dialog`에 6개 옵션 추가 확인
- 가짜 `Entry.block.dialog_time`에 6개 옵션 추가 확인
- 텍스트 코딩 `syntax.py[*].textParams[2].options`에 6개 옵션 추가 확인
- 기능을 두 번 켜도 중복 옵션이 생기지 않음 확인
- 기능을 끄면 확장이 추가한 6개 옵션 제거 확인
- `정상 작동.ent`와 `작동안함.ent`의 `temp/project.json` 비교 결과, 실제 차이는 시작 블록 좌표 `x/y`뿐이었다. 말하기 블록의 OPTION 값은 동일했으므로 문제 원인은 저장 JSON이 아니라 확장 실행 시점의 콘솔용 OPTION 처리였다.
- 런타임 래퍼 스모크 테스트: `ask ` 콘솔 모드는 네이티브 `Entry.Dialog`로 넘어가지 않고 `Entry.console.print(message, 'ask ')`만 호출된다. `speak` 같은 네이티브 모드는 기존 함수로 그대로 전달된다.

## 5. 주의점

- 기존 작품에는 영향이 없다. 옵션 추가 방식이므로 `speak`, `think`는 그대로 동작한다.
- 추가 OPTION 값이 저장된 작품을 확장 없이 열면 Entry 본체 UI에서 옵션 표시가 폴백될 수 있다.
- `Entry.Dialog`와 콘솔 렌더 코드는 수정하지 않는다. 단, 콘솔용 OPTION 값은 `Entry.Dialog`가 아닌 확장 래퍼에서 처리해야 한다.
- `[LOG]`는 원래 빈 문자열을 쓰면 콘솔 기본 스타일이 되지만, Entry 드롭다운 UI에서 빈 값이 `대상 없음`으로 표시된다. 따라서 확장에서는 스타일 규칙이 없는 `entryDebuggerLog` 클래스를 사용해 기본 흰색 콘솔 출력과 같은 효과를 낸다.
