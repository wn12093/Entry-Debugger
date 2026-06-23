---
상태: 1단계반영
범위: 프로젝트:Entry Debugger
갱신: 2026-06-23
승계: 실제 리팩토링을 시작하면 채택된 구조를 entry-debugger-refactor-architecture.md에
  반영하고, 완료된 기획은 _archive/기획/로 이관
---

# Entry Debugger 리팩토링 검토

확장 전체의 리팩토링 필요 지점을 조사하고 독립 검토 결과를 반영했다. 최초 문서는
`B2 settings 스키마화 → B1 부트스트랩 fallback 제거`를 저위험 첫 작업으로 제안했지만,
검토 결과 **동작을 고정하는 특성 테스트가 먼저**라는 결론으로 우선순위를 뒤집었다.
아래에는 수정된 메트릭, 항목별 판정, 실행 순서와 재검토 프롬프트를 기록한다.

> **기준 소스(2026-06-23)** — 아래 메트릭·줄번호는 다음 변경이 모두 반영된
> `main` 소스 기준이다: `a23e572` 알림 엔트리 네이티브 토스트 통일,
> `379d68e` **EO(.eo) 생성기/중복 이미지 업로더 제거**, `86e5bde` 함수 보관함
> `numberToHangul` 추가, `7d86a1a` **버전 2.6.0**. EO 제거는 기능 하나를 삭제할 때
> settings.js·manifest·content.js·style.css 등 여러 등록처를 함께 수정해야 한다는
> **A1의 사례**다. 구조적 문제의 단독 증명으로 취급하지는 않는다.

## 메트릭 스냅샷

| 파일 | 줄 수 | 성격 |
| --- | --- | --- |
| `content.js` | 2,779 | god file(10 섹션) — §5 패널 UI ~830줄, §6 스냅샷 렌더 ~820줄 |
| `style.css` | 1,662 | 단일 CSS |
| `picture-tools.js` | 1,804 | 최대 page 모듈 |
| `inject.js` | 1,206 | 단일 `onMessage` god switch |
| js 21개 + css | ≈13,449 | EO 제거로 23→21개 모듈 |

핵심 수치:

- `post`/`onMessage`/`safeGetEntry`가 **12개 page 모듈에 중복**
- content.js가 사용하는 메시지 프로토콜 어휘 약 **51개**
- 강제 재동기화 경로 **10회**(완전히 같은 2줄 9회 + 주석 포함 요청 경로 1회)
- 설정 키 **19개**, `enabled &&` 게이트 반환 **15개**
- 기능 하나가 설정·UI·주입·적용 등 여러 평행 등록처에 분산

## 핵심 진단 (영향도순)

1. 설정 정규화·스크립트 로딩 계약을 고정하는 특성 테스트가 부족하다.
2. 기능 정의가 여러 평행 등록처에 분산돼 있다(A1).
3. `content.js`·`inject.js`가 너무 많은 책임을 가진다(A2·A3).
4. page-world 부트스트랩 fallback과 재시도 코드가 반복되지만, 제거 전 로딩 성공 보장이 필요하다(B1·E3).
5. `settings.js normalizeSettings`는 반복이 많지만 필드 간 불변조건이 얽혀 있다(B2).
6. 메시지 프로토콜이 문자열로 분산돼 있다(C1).

## 권장 실행 순서 (가성비·위험 기준)

| 순서 | 작업 | 판정 | 위험 | 선행 조건·범위 |
| --- | --- | --- | --- | --- |
| 1 | 설정 정규화 특성 테스트 | 완료 | 낮음 | `tools/check-settings.js` |
| 2 | page-core 로딩 특성 테스트 | 부분 완료 | 낮음 | 순서·중복 방지·성공 후 정리 고정, 실패 복구는 후속 |
| 3 | B4 `forceResync()` 추출 | 완료 | 낮음 | 변경 후 재동기화 경로 10곳 치환 |
| 4 | E3 재시도 컨트롤러 시범 통합 | 채택 | 낮음~중간 | 단순 모듈 1개부터 적용, boost-mode는 후순위 |
| 5 | B5 Entry raw 접근의 Adapter 이전 | 채택 | 낮음~중간 | 리더 단위로 점진 적용 |
| 6 | A1 content.js 내부 기능 레지스트리 | 부분 채택 | 중간 | 동질적인 page-world 기능만 대상 |
| 7 | B2 settings 스키마화 | 보류 | 중간 | 설정 특성 테스트 통과 뒤 진행 |
| 8 | B1 fallback 제거 | 보류 | 중간 | Promise 순차 로더·`onerror`·로드 실패 검증 선행 |
| 9 | C1 메시지 상수/라우터 정리 | 부분 채택 | 중간 | 제한적 기능 레지스트리와 함께 점진 적용 |
| 10 | A2·A3 god file 분리 | 보류 | 중간~높음 | 앞 단계 후 마지막에 책임 단위 분리 |
| - | E4 `*ScriptInjected` 제거 | 기각 | - | DOM ID 가드와 역할이 다름 |

### 판정 보충

- **B1**: fallback은 죽은 코드가 아니다. 코어 스크립트 로딩 실패 시
  `post`/`onMessage`/`safeGetEntry` 일부를 복구할 수 있다. 다만 page-bridge와 함께
  patch-registry가 실패하면 후킹까지 복구하지 못하므로 완전한 안전망도 아니다.
  Promise 기반 순차 로더와 `onerror`를 먼저 도입한 뒤 제거 여부를 다시 판단한다.
- **A1**: 하나의 거대 SSOT로 통합하지 않는다. 우선 content.js 안에서 주입 ID, 파일명,
  설정 키, 활성 판정, 적용 메시지가 동질적인 기능만 런타임 레지스트리로 묶는다.
  manifest WAR와 settings 스키마의 빌드타임 생성은 효과가 입증될 때만 별도로 검토한다.
- **B2**: `labTabEnabled`가 꺼질 때 실험 기능을 초기화하고,
  `boostModeControlVisible`이 꺼질 때 boost를 끄며, 전체 `enabled`를 다시 계산하는
  필드 간 불변조건이 있다. 단순 루프 치환은 이 동작을 깨뜨릴 수 있다.
- **E4**: `injectPageScript()`는 로드 뒤 `<script>`를 제거한다. DOM ID 가드는 로딩 중
  중복만 막고, `*ScriptInjected`는 아직 로드되지 않은 기능에 OFF 메시지를 보내지 않게
  한다. 둘은 대체 관계가 아니다.

## 검증 안전망

현재 자동 검증은 존재하고 Windows에서도 동작한다. 2.6.1에서는 다음 두 검사가
`npm run check`에 추가됐다.

- `tools/check-settings.js`: 설정 정규화 불변조건
- `tools/check-page-core-loader.js`: 현행 코어 주입 순서·중복 방지·성공 후 정리
- `npm run check`: 위 검사와 정적 검사, 함수 템플릿 실제 복제·ID 재매핑 검사
- `npm run build:dev`: Windows CRLF 정규화 수정 반영, 현재 통과
- `npm run smoke:local`: 로컬 Entry 작업실 핵심 회귀
- `npm run smoke:picture-tools`: 모양 도구 전용 회귀
- `npm run smoke:frame-profiler`: 프레임 프로파일러 회귀

단, `smoke:local` 계열은 로컬 Entry 서버 `127.0.0.1:8080`과 외부 Entry 자원 접근이
필요할 수 있다. 설정의 핵심 불변조건과 page-core 성공 경로는 고정됐지만,
Promise 순차 로딩과 page-core 로딩 실패·재시도는 아직 검증하지 않는다. 각 리팩터 PR은 `npm run check`,
`npm run build:dev`, 관련 Chromium smoke를 통과하고 PR 직전 가능하면
`playentry.org/ws` 실사이트에서 확인한다.

## 2.6.1 반영 범위

웹스토어 제출 전 안정성 작업으로 다음만 한 브랜치에 반영했다.

1. `settings.js` 핵심 불변조건 특성 테스트
2. 현행 page-core 성공 경로 특성 테스트
3. B4 `forceResync()` 추출
4. 버전·README·리팩토링 구조 문서 갱신

E3 재시도 컨트롤러, B5 Adapter 이전, A1 기능 레지스트리, B2 설정 스키마화,
B1 fallback 제거는 이번 웹스토어 릴리스에서 제외했다. 제품 동작과 로딩 방식을
한 릴리스에서 함께 크게 바꾸지 않기 위한 범위 제한이다.

## 검토 프롬프트

새 세션(콜드)에서 제안을 독립 검증하고 go/no-go 결정 메모를 내도록 설계했다.

```text
엔트리 디버거 크롬 확장의 "리팩토링 제안"을 검토하고, 각 항목을 실제로 진행할지
go/no-go로 판단하는 결정 메모를 작성해줘. 코드는 수정하지 마(읽기 전용 검토).

[대상]
- 경로: C:\Users\young\prg\ENTRY\extensions\Entry Debugger\entry-debugger-extension\
- 공개 레포 205sla/Entry-Debugger, Chrome Web Store 배포 중(MV3, 작업 버전 v2.6.1).
- 구조: isolated world content.js ↔ page-world WAR 모듈들이 window.postMessage
  채널 '__ENTRY_DEBUGGER__'로 통신. 공유 인프라 4종을 기능 주입 앞에 먼저 주입함
  (page-bridge.js=post/onMessage, entry-adapter.js=Entry 접근, patch-registry.js=후킹,
  hangul-search.js). 설정 SSOT는 settings.js.
- 줄번호는 2026-06-23 working tree(EO 생성기 제거·토스트 통일·v2.6.1 반영) 기준이며,
  드리프트할 수 있으니 반드시 심볼명으로 재확인할 것.

[검토 방식]
- 아래 각 "주장"을 곧이곧대로 믿지 말고, 인용한 file:line을 직접 열어 사실인지 확인할 것.
- 항목마다: (1) 주장 사실 여부 (2) 영향(대략 LOC·유지보수성) (3) 위험(동작 변화 가능성)
  (4) 검증 가능성 → 결론을 채택 / 보류 / 기각 중 하나로.
- 순수 리팩터(동작 불변)가 원칙. 동작이 바뀌면 그 항목은 리팩터가 아니라 별도 변경으로 분류.

[검토할 제안 항목]
A0. 설정 정규화와 page-core 스크립트 로딩 계약을 특성 테스트로 먼저 고정.
    설정 테스트 대상: 기본값, 전체 enabled OFF, debugger OFF→lab OFF, lab OFF 시
    turbo/functionLibrary/frameProfiler 초기화, boost 버튼 숨김→boost OFF,
    dropdown 하위 토글 보존, 이미지 배율 200~2000 clamp.
    로더 테스트 대상: core 4종 순서, 로드 성공 후 기능 스크립트 평가, 로드 실패 처리.
A1. 기능 정의가 평행 등록처에 분산 → content.js 내부의 동질적인 page-world 기능만
    제한적 "기능 디스크립터 테이블"로 통합.
    근거: settings.js(DEFAULT_SETTINGS L9 / normalize L57 / return L167),
    manifest.json WAR(L27), content.js(inject* L81~, is*Enabled L976~, apply* L2068,
    bindSettingsToggle 정의 L819+호출 ~12회, *ScriptInjected L65).
    EO 생성기 제거(커밋 379d68e)는 여러 등록처를 함께 수정한 사례일 뿐 단독 증명은 아님.
    manifest WAR는 정적 선언이므로 런타임 레지스트리 범위에서 제외. 빌드타임 생성은 후속 선택지.
A2. content.js(2,779줄) god file → panel-ui / snapshot-render / feature-registry /
    message-router 분리.
A3. inject.js(1,211줄) 단일 onMessage 스위치(L1056~) → serializers / mutators / router 분리.
B1. post/onMessage/safeGetEntry가 12개 page 모듈에 중복 정의(모듈당 ~35줄, 총 ~400줄).
    이미 Bridge/Adapter에 위임하고 로컬 정의는 fallback일 뿐(boost-mode.js:36).
    현재 injectPageCoreScripts()는 로드 완료를 await하지 않고 pageCoreScriptsInjected=true를
    먼저 설정하며 injectPageScript()에 onerror가 없다. async=false는 실행 순서를 돕지만
    로드 성공을 보장하지 않는다. Promise 순차 로더+onerror를 먼저 도입한 뒤 fallback 제거 재검토.
B2. settings.js normalizeSettings의 불린 정규화 반복과 반환 조립을 스키마화.
    전체 설정 키는 19개, 반환에서 `enabled &&` 게이트는 15개다. lab 리셋, boost 종속,
    전체 enabled 재계산 등 필드 간 불변조건을 특성 테스트로 고정한 뒤에만 진행.
B4. inject.js의 강제 재동기화 경로 10회 → forceResync() 추출.
B5. `v.id_||v.id`, `v.name_||v.name`, `array_` 등 raw 접근 분산 → entry-adapter 리더로 통합.
C1. content.js 기준 메시지 프로토콜 어휘 약 51개가 중앙 레지스트리 없이 분산.
E3. patch-registry.createRetryController가 있는데 boost-mode.js는 자체 retryTimer/retryUntil로
    재구현(boost-mode.js:24). 단순한 모듈 1개에서 공유 컨트롤러를 먼저 시범 적용한 뒤
    document_start 특수성이 있는 boost-mode로 확장.
E4. *ScriptInjected 불린 6개(content.js:65~70)는 유지한다.
    injectPageScript가 onload에서 script를 제거하므로 DOM ID 가드와 역할이 다르고,
    apply*Feature의 OFF 메시지 게이팅에 실제 사용된다.

[특히 반드시 따져볼 리스크 — 여기서 리팩터가 깨질 수 있음]
- B2 함정: settings.js return에서 dropdownSearchBlockMenuEnabled / dropdownSearchPropertyPanelEnabled
  (L177-178)는 다른 키와 달리 `enabled &&`로 게이팅되지 않는다. highQualityBlockImageScale은
  불린이 아니라 별도 normalize(L46 부근). 즉 "모든 키에 enabled && x" 식의 단순 스키마는 버그.
  → 스키마에 게이팅 여부/커스텀 정규화 필드가 필요한지 확인.
- B1 함정: 모든 page 모듈이 정말 injectPageCoreScripts() 경유로만 주입되는지(우회 주입 경로 없는지),
  function-usage-inspector.js처럼 post 정의 위치가 다른 모듈(L472)도 동일하게 위임하는지,
  Adapter.getEntry()와 로컬 `window.Entry` fallback의 동작 차이가 없는지 확인. document_start
  타이밍에 page-bridge가 먼저 평가되는지, 로드 실패 시 어떤 fallback만 살아남는지도 확인.
- A1 함정: 일반화에 저항하는 특수 기능이 있다 — boost-mode는 기능 OFF여도 document_start에
  무조건 주입(content.js:168)되고 localStorage 미러를 씀, hangul-search는 content+WAR 이중 월드,
  dropdown-search는 하위 토글 3개. 첫 레지스트리 범위에서 예외 기능을 제외할지 판단.
- E4 결론: script 태그가 onload에 제거되므로 getElementById 가드만으로 과거 로드 여부를
  알 수 없다. 현재 불린 플래그는 OFF 메시지 전송 여부를 결정하므로 제거하지 않는다.

[제약(검증 게이트)]
- 자동 검증은 `npm run check`, `build:dev`, `smoke:local`, `smoke:picture-tools`,
  `smoke:frame-profiler`가 있다. Windows CRLF 문제는 build-dev-extension.js에서 수정됐다.
- smoke:local 계열은 로컬 Entry 127.0.0.1:8080이 필요하다. 핵심 설정 조합과 core
  성공 경로는 2.6.1에서 고정했고, 로드 실패·재시도 특성 테스트는 후속으로 보강한다.
- 각 PR은 정적 검사·개발 빌드·관련 Chromium smoke를 통과하고, PR 직전 가능하면
  playentry.org/ws 실사이트에서 확인한다.
- 공개·배포 중 → 큰 일괄 변경 금지, 동작 불변 소규모 PR 단위 권장.
- 지식/문서 규약은 ENTRY/CLAUDE.md 및 extensions/Entry Debugger/지식/ 따름.

[산출물 = 결정 메모(마크다운)]
1. 항목별 표: 주장 사실여부 | 영향 | 위험등급(저/중/고) | 결론(채택/보류/기각) | 근거 한 줄.
2. 권장 실행 순서(가성비·위험 기준)와 PR 분할 제안.
3. 완료된 2.6.1 안전망과 아직 보류된 로더 실패 복구를 구분해 다음 PR 범위를 제안.
4. 기각/보류한 항목은 그 이유(예: 동작 변화 위험, 검증 불가, 효용 낮음).
```

## 관련 지식

- [entry-debugger-refactor-architecture.md](./entry-debugger-refactor-architecture.md) — 현행 리팩토링 구조(채택 결론의 졸업처)
- [entry-debugger-notification-popups.md](./entry-debugger-notification-popups.md) — 직전 일관성 작업(토스트 통일, 커밋 a23e572)
- [build-dev-extension-windows-crlf.md](./build-dev-extension-windows-crlf.md) — build:dev 검증 제약
