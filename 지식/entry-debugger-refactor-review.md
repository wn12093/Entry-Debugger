---
상태: 검토대기
범위: 프로젝트:Entry Debugger
갱신: 2026-06-23
승계: 검토 후 채택 결론은 entry-debugger-refactor-architecture.md(레퍼런스)로 졸업,
  본 문서는 _archive/기획/로 이관
---

# Entry Debugger 리팩토링 검토

2026-06-23 토스트 엔트리 네이티브 통일 직후, 확장 전체의 리팩토링 필요 지점을 전수
조사했다. **실제로 진행할지를 독립적으로 판단**하기 위한 분석 메트릭 + 우선순위 +
검토 프롬프트를 모았다. 항목 근거(file:line)와 함정은 아래 프롬프트 본문에 있다.

## 메트릭 스냅샷

| 파일 | 줄 수 | 성격 |
| --- | --- | --- |
| `content.js` | 2,872 | god file(10 섹션) — §5 패널 UI ~900줄, §6 스냅샷 렌더 ~820줄 |
| `style.css` | 1,811 | 단일 CSS(15 섹션) |
| `picture-tools.js` | 1,804 | 최대 page 모듈 |
| `inject.js` | 1,205 | 단일 `onMessage` god switch |
| 전체 23개 파일 | 14,366 | — |

핵심 수치: `post`/`onMessage`/`safeGetEntry` 정의가 **12개 모듈 중복**, 메시지 문자열
상수 **45개**(content.js), 기능 하나가 평행 등록처 **~10곳**.

## 핵심 진단 (영향도순)

1. 기능 정의가 ~10개 평행 리스트에 분산 — 단일 SSOT 부재(A1, 최우선).
2. `content.js`·`inject.js` 거대 단일 파일(A2·A3).
3. page-world 부트스트랩 보일러플레이트 ~400줄 중복(B1, 가성비 최고).
4. `settings.js normalizeSettings` 스키마화 가능 ~130→~30줄(B2).
5. stringly-typed 메시지 프로토콜 중앙화 부재(C1).

## 권장 실행 순서 (가성비·위험 기준)

| 순서 | 작업 | 위험 | 효과 |
| --- | --- | --- | --- |
| 1 | B2 settings 스키마화 | 낮음 | -100줄 |
| 2 | B1 부트스트랩 중복 제거 | 낮음(순서 보장 입증) | -400줄 |
| 3 | B4·E3 forceResync/retry 통합 | 낮음 | 소규모 |
| 4 | A1 기능 디스크립터 레지스트리 | 중간 | 구조 핵심(B3·C1 흡수) |
| 5 | A2·A3 god file 분리 | 중간~높음 | 장기 유지보수 |

> 회귀 안전망 약함: smoke는 로컬 Entry 8080 필요, `build:dev`는 Windows CRLF 버그
> ([build-dev-extension-windows-crlf.md](./build-dev-extension-windows-crlf.md)). 모든 단계
> `npm run check` 통과 + playentry.org/ws 실사이트 검증 필수, 동작 불변 소규모 PR 권장.

## 검토 프롬프트

새 세션(콜드)에서 제안을 독립 검증하고 go/no-go 결정 메모를 내도록 설계했다.

```text
엔트리 디버거 크롬 확장의 "리팩토링 제안"을 검토하고, 각 항목을 실제로 진행할지
go/no-go로 판단하는 결정 메모를 작성해줘. 코드는 수정하지 마(읽기 전용 검토).

[대상]
- 경로: C:\Users\young\prg\ENTRY\extensions\Entry Debugger\entry-debugger-extension\
- 공개 레포 205sla/Entry-Debugger, Chrome Web Store 배포 중(MV3).
- 구조: isolated world content.js ↔ page-world WAR 모듈들이 window.postMessage
  채널 '__ENTRY_DEBUGGER__'로 통신. 공유 인프라 4종을 기능 주입 앞에 먼저 주입함
  (page-bridge.js=post/onMessage, entry-adapter.js=Entry 접근, patch-registry.js=후킹,
  hangul-search.js). 설정 SSOT는 settings.js.

[검토 방식]
- 아래 각 "주장"을 곧이곧대로 믿지 말고, 인용한 file:line을 직접 열어 사실인지 확인할 것.
- 항목마다: (1) 주장 사실 여부 (2) 영향(대략 LOC·유지보수성) (3) 위험(동작 변화 가능성)
  (4) 검증 가능성 → 결론을 채택 / 보류 / 기각 중 하나로.
- 순수 리팩터(동작 불변)가 원칙. 동작이 바뀌면 그 항목은 리팩터가 아니라 별도 변경으로 분류.

[검토할 제안 항목]
A1. 기능 정의가 평행 등록처 ~10곳에 분산 → 단일 "기능 디스크립터 테이블"로 통합.
    근거: settings.js(DEFAULT_SETTINGS L23 / normalize L98 / return L186),
    manifest.json WAR(L42), content.js(inject* L136, is*Enabled L1069, apply* L2350,
    bindSettingsToggle L807, *ScriptInjected L65).
A2. content.js(2,872줄) god file → panel-ui / snapshot-render / feature-registry /
    message-router 분리.
A3. inject.js(1,205줄) 단일 onMessage 스위치(L1048~) → serializers / mutators / router 분리.
B1. post/onMessage/safeGetEntry가 12개 page 모듈에 중복 정의(모듈당 ~35줄, 총 ~400줄).
    이미 Bridge/Adapter에 위임하고 로컬 정의는 fallback일 뿐(boost-mode.js:36).
    주장: injectPageCoreScripts()가 모든 기능 주입 앞(content.js:148)에서 돌고
    script.async=false(content.js:161)로 순서 보장 → fallback은 도달 불가능한 죽은 코드.
    제안: 보장된 로드 순서를 신뢰해 fallback 제거.
B2. settings.js normalizeSettings의 `typeof data.x==='boolean'?...:default` 블록 19회 +
    return의 `enabled && x` 19키 → 스키마 배열+루프로 ~130줄→~30줄.
B4. inject.js의 `prevSnapshotJSON=''; pollAndBroadcast();` 변이마다 반복(~8회) → forceResync() 추출.
B5. `v.id_||v.id`, `v.name_||v.name`, `array_` 등 raw 접근 분산 → entry-adapter 리더로 통합.
C1. 메시지 문자열 상수 45개(SET_*_ENABLED/*_READY/*_RESULT)가 중앙 레지스트리 없이 분산.
E3. patch-registry.createRetryController가 있는데 boost-mode.js는 자체 retryTimer/retryUntil로
    재구현(boost-mode.js:24) → 공유 컨트롤러로 통일.
E4. *ScriptInjected 불린 7개(content.js:65)가 injectPageScript의 getElementById 가드와
    중복인지 검증.

[특히 반드시 따져볼 리스크 — 여기서 리팩터가 깨질 수 있음]
- B2 함정: settings.js return에서 dropdownSearchBlockMenuEnabled / dropdownSearchPropertyPanelEnabled
  (L183-184)는 다른 키와 달리 `enabled &&`로 게이팅되지 않는다. highQualityBlockImageScale은
  불린이 아니라 별도 normalize(L47). 즉 "모든 키에 enabled && x" 식의 단순 스키마는 버그.
  → 스키마에 게이팅 여부/커스텀 정규화 필드가 필요한지 확인.
- B1 함정: 모든 page 모듈이 정말 injectPageCoreScripts() 경유로만 주입되는지(우회 주입 경로 없는지),
  function-usage-inspector.js처럼 post 정의 위치가 다른 모듈(L472)도 동일하게 위임하는지,
  Adapter.getEntry()와 로컬 `window.Entry` fallback의 동작 차이가 없는지 확인. document_start
  타이밍에 page-bridge가 먼저 평가되는지도.
- A1 함정: 일반화에 저항하는 특수 기능이 있다 — boost-mode는 기능 OFF여도 document_start에
  무조건 주입(content.js:169)되고 localStorage 미러를 씀, hangul-search는 content+WAR 이중 월드,
  dropdown-search는 하위 토글 3개. 디스크립터가 이 예외를 표현할 수 있는지.

[제약(검증 게이트)]
- 자동 런타임 테스트 없음: smoke는 로컬 Entry 127.0.0.1:8080 필요, npm run build:dev는
  Windows CRLF 버그로 깨짐. 따라서 회귀 안전망이 약함 → 정적 검증 npm run check 통과는 필수,
  실동작은 playentry.org/ws 실사이트 확인 필요.
- 공개·배포 중 → 큰 일괄 변경 금지, 동작 불변 소규모 PR 단위 권장.
- 지식/문서 규약은 ENTRY/CLAUDE.md 및 extensions/Entry Debugger/지식/ 따름.

[산출물 = 결정 메모(마크다운)]
1. 항목별 표: 주장 사실여부 | 영향 | 위험등급(저/중/고) | 결론(채택/보류/기각) | 근거 한 줄.
2. 권장 실행 순서(가성비·위험 기준)와 PR 분할 제안.
3. "채택" 항목 중 첫 PR로 삼을 1건의 구체 범위와, 그 PR을 어떻게 검증할지(정적+실사이트).
4. 기각/보류한 항목은 그 이유(예: 동작 변화 위험, 검증 불가, 효용 낮음).
```

## 관련 지식

- [entry-debugger-refactor-architecture.md](./entry-debugger-refactor-architecture.md) — 현행 리팩토링 구조(채택 결론의 졸업처)
- [entry-debugger-notification-popups.md](./entry-debugger-notification-popups.md) — 직전 일관성 작업(토스트 통일)
- [build-dev-extension-windows-crlf.md](./build-dev-extension-windows-crlf.md) — build:dev 검증 제약
