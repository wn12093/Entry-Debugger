# 프레임 프로파일러

확인일: 2026-06-22
대상 파일: `frame-profiler.js`, `content.js`, `settings.js`, `tools/smoke-frame-profiler.js`
도입: PR #6 (실험실 기능, 기본 꺼짐)

작품 실행 중 매 프레임마다 어느 오브젝트의 어느 스크립트가 프레임 시간을 잡아먹는지
실시간 오버레이로 보여주는 실험실 기능입니다.

## 동작 원리

두 지점을 후킹해 실행 시간을 측정합니다.

- `Entry.Code.prototype.tick` → 오브젝트별 프레임 시간 (`code.object`)
- `Entry.Executor.prototype.execute` → 스크립트(스레드)별 시간. 스레드는 `executor.code.object`와
  햇 블록으로 구분

표시는 EMA로 평활하고 DOM 갱신은 약 120ms 주기로 throttle합니다. 측정 오버헤드를 줄이려고
`enabled && 실행 중`일 때만 측정합니다. 오버레이의 스크립트 항목을 클릭하면 해당 오브젝트를
선택하고 그 코드로 스크롤·하이라이트합니다(편집창의 실제 블록을 그대로 보여줌).

상태는 셋으로 나뉩니다.

- `running` — 실행 또는 일시정지. 오버레이 표시를 유지
- `paused` — 일시정지. 마지막 측정값을 고정(측정/감쇠 멈춤)
- `active` — `enabled && 실행 중`. 후킹 래퍼가 읽어 실제 측정 여부를 결정

## 실험실 분류와 게이팅

프레임 프로파일러는 아직 완성되지 않은 기능이라 설정 탭이 아니라 **실험실(lab)** 영역에 둡니다.
활성 조건은 다음과 같습니다.

```
extensionSettings.enabled && debuggerTabEnabled && labTabEnabled && frameProfilerEnabled
```

`labTabEnabled`가 꺼지면 `frameProfilerEnabled`는 `resetLabFeatureSettings()`에서 기본값으로
정규화됩니다(터보 모드 등 다른 실험실 기능과 동일). 또한 `frameProfilerEnabled`는 메인 기능
카운트(`MAIN_FEATURE_KEYS`)에서 제외합니다.

## 구현 시 주의 (Entry 내부 동작)

다시 만질 때 깨지기 쉬운 지점입니다.

1. **동기 스크립트 측정** — `시작하기 클릭 → 이동`처럼 한 프레임에 끝나는 스크립트는
   `execute()`가 끝나면 `scope.block`이 이미 `null`이라 햇 블록을 못 찾습니다. 그래서
   `execute()` **전에** `deriveHat()`로 햇 정보를 확보해 두고, `finally`에서 그 정보로 시간을
   기록합니다(예외가 나도 기록). 끝난 뒤 햇 블록을 찾으면 동기 스크립트가 목록에서 누락됩니다.
2. **hatCache 정리** — `hatCache`(executor.id → 햇 정보)는 끝난 executor의 항목을 `execute()`
   직후 `isEnd()`로 확인해 즉시 제거합니다. 오래 실행하는 작품에서 캐시가 무한히 커지는 것을
   막습니다.
3. **오버레이 드래그 리스너** — `makeDraggable()`은 `document`에 `mousemove`/`mouseup`을
   겁니다. 정리 함수를 반환하게 만들고 `removeOverlay()`에서 호출해야 프로파일러를 껐다 켤 때
   리스너가 누적되지 않습니다.

## 검증

- `npm run smoke:frame-profiler` — 동기 스크립트가 햇 블록 라벨로 표시되는지, 코드 이동·일시정지·
  정지를 확인합니다(Playwright + 로컬 Entry 8080 필요).
- `npm run smoke:local` 회귀에서 기본 비활성 상태를 함께 확인합니다.
