---
상태: 검토대기
범위: 프로젝트:Entry Debugger
갱신: 2026-06-23
승계: 검토 통과 후 PR 병합되면 본 문서는 _archive/기획/로 이관
---

# 블록 편집 버그 수정 2건 검토 프롬프트

`fix/block-text-copy-if-else` 브랜치의 버그 수정 2건(if_else 텍스트 복사, Alt 단일
블록 드래그)을 PR 병합 전 독립 검토하기 위한 콜드 프롬프트. 두 수정 모두 EntryJS
내부 동작에서 근본 원인을 유도했고, 핵심 동작은 자동 테스트로 검증되지 않아 실사이트
확인이 필요하다.

```text
엔트리 디버거 확장의 블록 편집 버그 수정 2건을 머지 가능 여부 관점에서 비판적으로
검토해줘. 코드는 수정하지 말고, 실제 파일·diff·EntryJS 내부 동작을 직접 읽어 판단해.
커밋 메시지나 주석의 결론을 사실로 가정하지 말 것.

[저장소]
- 경로: C:\Users\young\prg\ENTRY\extensions\Entry Debugger
- 브랜치: fix/block-text-copy-if-else
- 기준: refactor/reliability-release-2.6.1 (이 위에 2건이 얹혀 있음)
- 변경: git diff refactor/reliability-release-2.6.1...HEAD
- 커밋: 523bf43(if-else 복사), e9ac217(Alt 단일 드래그)
- EntryJS 원본(런타임 구조 확인용): upstream/entryjs-develop/src

[수정 1 — 블록 텍스트 복사: 만약~라면~아니면]
파일: entry-debugger-extension/block-text-copy.js
증상: if_else를 텍스트로 복사하면 "아니면"이 조건 머리줄에 붙음
  (만일 (10=10) (이)라면 아니면 / 두 분기가 그 아래 함께 나열).
원함: "아니면"이 두 분기 사이에 오기.
구현 주장:
- renderBlock이 분기 블록의 줄 텍스트를 statement 줄바꿈(FieldLineBreak) 기준으로
  나눠(renderBlockLineSegments) segment[i]를 분기 i 앞에 배치.
- 분기 2개 이상 + 실제 구분 텍스트가 있을 때만 적용, 아니면 기존 동작 폴백.
- contentToText 헬퍼로 기존 renderBlockLineFromContents 로직을 공유.
검증 포인트:
- block_view.js alignContent(약 L299-304): FieldLineBreak마다 _statements[i]를
  배치 → 줄바꿈 i 앞 텍스트가 분기 i 머리글이라는 전제가 실제로 맞는지.
- 리팩터 후 renderBlockLineFromContents 동작 동일성(정적 텍스트 빈 문자열 push,
  비정적 빈 텍스트 skip).
- 회귀: if_else가 아닌 블록(반복/단일 statement/일반)·중첩 if_else·빈 분기·inline
  값 블록 출력이 그대로인지.
- "아니면"이 _contents가 아니라 visual/template에서 오는 경우 가드가 폴백해 회귀가
  없는지(분기>1 && 구분 텍스트 존재 조건).

[수정 2 — Alt 단일 블록 드래그]
파일: entry-debugger-extension/single-block-drag.js
증상: Alt+드래그해도 단일 분리가 안 되고 전체 스택이 함께 이동.
근본 원인 주장:
- Entry가 BlockView 생성자에서 onMouseMove를 인스턴스에 바인딩
  (block_view.js L127: this.onMouseMove = this.onMouseMove.bind(this)).
- 따라서 prototype.onMouseMove 패치는 이미 생성된 블록에 닿지 않음. 기능이 기본
  OFF라 세션 중간에 켜면 기존 블록이 원본 onMouseMove를 유지 → prepare 미발동.
수정 주장:
- prototype.onMouseMove 패치 제거. onMouseDown 패치(프로토타입, block_view.js L98
  that.onMouseDown 경유로 유효)에서 installInstanceMoveHook으로 인스턴스의
  onMouseMove를 감쌈. Entry가 onMouseDown 안에서 this.onMouseMove를 mousemove에
  바인딩(block_view.js L547)하기 전에 교체되므로 현재 드래그부터 적용.
검증 포인트:
- block_view.js: onMouseMove/onMouseUp만 인스턴스 바인딩(L127-128), onMouseDown은
  that.onMouseDown(L98)로, terminateDrag는 this.terminateDrag(L708)로 prototype인지.
- onMouseDown 안 $doc.bind('mousemove.block', this.onMouseMove)(L547)가 hook 교체
  "뒤"에 실행되는지(패치가 original 호출 전에 hook 설치).
- 멱등성(__entryDebuggerMoveHookInstalled), 기능 OFF 시 wrapper가 no-op인지
  (shouldPrepareOnMove가 enabled·요청 플래그 확인).
- separate→insert 재연결(prepareSingleBlockDrag)·undo 묶음(isPass)·첫 블록(prevBlock
  없음)·중간 블록 경로가 여전히 올바른지.
- separateBlock(block, dragMode, y)·insertBlock(block, targetBlock, count) 시그니처
  (command/commands/block.js)와 호출이 맞는지.

[검증 게이트]
- 자동: npm run check, npm run build:dev (Windows는 npm.cmd). 둘 다 통과해야 함.
- 하네스(있으면): node C:\tmp\verify-entry-debugger-toast.js — 일반 블록 복사 회귀
  (C-block-text-copy)만 커버하고 if-else·단일드래그는 커버 안 함.
- ⚠️ 두 수정 모두 핵심 동작이 자동 테스트로 검증되지 않음. 실사이트 playentry.org/ws
  에서 (a) if_else 텍스트 복사 결과, (b) 기능 ON 후 기존 블록 Alt+드래그 단일 분리를
  확인. smoke:local 계열은 외부 자원 차단 시 타임아웃되므로 코드 실패와 환경 실패를 구분.

[산출물]
1. 수정별 findings를 심각도순으로, 파일·줄번호와 함께.
2. 블로커/비블로커 구분. 회귀 위험과 실사이트 미검증 공백 명시.
3. 테스트 결과 PASS/FAIL/BLOCKED 표.
4. 결론(수정별): 머지 가능 / 수정 후 재검토 / 보류.
5. 검토 중 원본 파일·브랜치는 수정하지 않는다.
```

## 관련 지식

- [entry-debugger-notification-popups.md](./entry-debugger-notification-popups.md) — 직전 일관성 작업
- [entry-debugger-refactor-review-prompt-2.6.1.md](./entry-debugger-refactor-review-prompt-2.6.1.md) — 2.6.1 검토 프롬프트(같은 형식)
