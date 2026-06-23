# 개발용 빌드 Windows CRLF 정규화 기록 (해결됨)

확인 날짜: 2026-06-15 · 상태: ✅ **해결됨** — `tools/build-dev-extension.js`가 본문을 LF로 정규화(`.replace(/\r\n/g, '\n')`)하여 Windows에서도 `npm run build:dev`가 통과한다. 아래는 증상·원인·수정 기록.

대상: [`tools/build-dev-extension.js`](../tools/build-dev-extension.js)의 `enableLocalWorkspaceInContentScript()` — Windows에서 `npm run build:dev`가 실패하던 플랫폼 전용 버그와 그 수정.

## 1. 증상

- Windows에서 `npm run build:dev` 실행 시 `Error: Local workspace content-script patch target was not found.`로 중단.
- `npm run smoke:local`은 dev 빌드 산출물(`dist/entry-debugger-extension-dev/`)에 의존하므로 연쇄로 막힘.
- Linux/Mac에서는 통과 — **Windows 전용 실패**.

## 2. 원인

`enableLocalWorkspaceInContentScript()`는 [`content.js`](../entry-debugger-extension/content.js)의 production 워크스페이스 체크 블록(`isEntryWorkspacePage()` 내부)을 **LF(`\n`)로 join한 문자열** `productionCheck`로 만들어 `contentScript.includes(productionCheck)`로 찾는다. 매칭되면 `isLocalWorkspace` 분기를 끼운 `localDevCheck`로 교체한다.

문제는 줄바꿈 문자다.

- repo [`.gitattributes`](../.gitattributes)가 `* text=auto` → Windows 체크아웃 시 `content.js`가 **CRLF**로 떨어진다.
- git blob 자체는 LF다. `git ls-files --eol entry-debugger-extension/content.js` → `i/lf  w/crlf  attr/text=auto` (index=LF, 워킹트리=CRLF). 실측상 워킹트리는 CRLF 2806줄 / 단독 LF 0줄.
- 따라서 **CRLF 본문 vs LF 패턴**이라 `includes()`가 `false` → `throw`.

저장소 blob이 LF라 Linux/Mac 체크아웃은 LF 그대로 통과한다. Windows에서만 깨지는 이유가 여기 있다.

## 3. 수정

읽은 내용을 매칭 전에 LF로 정규화한다(원인 지점 한 줄).

```js
const contentScript = fs.readFileSync(contentScriptPath, 'utf8').replace(/\r\n/g, '\n');
```

대안이던 "`\r?\n` 허용 정규식으로 매칭하고 원본 EOL 보존"은 채택하지 않았다. 교체 문자열 `localDevCheck`도 LF로 join되므로, CRLF 본문에 그대로 끼우면 **삽입된 줄만 LF, 주변은 CRLF인 파일 내부 혼합 EOL**이 생긴다. LF 정규화 방식은 산출물 `content.js`를 LF로 통일해, 이미 LF로 출력되는 `manifest.json`과 EOL 정책이 일치한다.

## 4. 산출물 EOL 정책 점검

수정과 함께 빌드 체인 전체에서 EOL 민감 지점을 확인했다.

| 도구 | EOL 민감 매칭 | 상태 |
| --- | --- | --- |
| `build-dev-extension.js` | `includes(productionCheck)` (LF join) | 원인 지점 — 위에서 수정 |
| `writeDevManifest()` | 없음 | `JSON.stringify(manifest, null, 2) + '\n'`로 이미 LF 출력 |
| `check-extension.js` | 정규식 + `node --check`만 사용 | EOL 무관 |
| `smoke-local-extension.js` | 없음 | build:dev 성공에만 의존 |

결론: EOL에 깨지는 곳은 `build-dev-extension.js` 하나뿐이었고, 수정 후 dev 산출물(`content.js`+`manifest.json`)은 LF로 일관된다.

## 5. 검증 (Windows)

- `npm run build:dev` 성공 → `dist/entry-debugger-extension-dev/` 생성.
- dev `manifest.json`에 로컬 매치 추가 확인: `content_scripts`·`web_accessible_resources` 양쪽에 `http://127.0.0.1/*`·`http://localhost/*`.
- dev `content.js`에 `isLocalWorkspace` 분기 실제 삽입 + `return isPlayEntryWorkspace || isLocalWorkspace;`로 교체 확인.
- 산출물 EOL 통일 확인: dev `content.js` → CRLF 0줄 / LF 2811줄 (혼합 없음).
- `npm run check` → `[check-extension] OK`.
- `npm run smoke:local`은 Playwright + 실제 로컬 Entry 작업실 서버(`http://127.0.0.1:8080/ws/...`)에서 통과했다.

## 6. 재발 방지 / 일반화

- **정확 문자열 매칭의 취약성**: `productionCheck`는 `content.js`의 `isEntryWorkspacePage()` 블록과 들여쓰기·문구가 한 글자라도 어긋나면 다시 깨진다. 그 함수의 production 분기를 손대면 `build-dev-extension.js`의 `productionCheck`/`localDevCheck`도 같은 작업에서 갱신할 것.
- **일반화 가능한 교훈**: `* text=auto` 환경에서 Node 빌드 스크립트가 소스를 **LF로 join한 문자열**로 매칭하면 Windows 체크아웃(CRLF)에서 깨진다. 소스를 읽는 즉시 LF로 정규화하는 게 가장 단순·견고하다. 다른 확장의 빌드 도구에서 같은 패턴이 재발하면 이 지식을 `extensions/지식/`(유형 공통)으로 승격할 것.

## 관련 지식

- 로컬 Entry 작업실 서버 시작/정지·확장 로드: [`_docs/local-entry-testing/`](../../../_docs/local-entry-testing/LOCAL_ENTRY_TESTING.md)
- 확장 로컬 검증·MV3 함정(유형 공통): [`extensions/지식/`](../../지식/README.md)
