# Entry Debugger 2.6.1 리팩토링 최종 검토 프롬프트

아래 프롬프트를 새 컨텍스트에 그대로 전달해 독립 검토한다.

```text
Entry Debugger 2.6.1 리팩토링 및 Chrome Web Store 제출 준비 변경을 비판적으로
검토해줘. 먼저 코드를 수정하지 말고, 실제 파일과 diff를 읽어 머지·제출 가능 여부를
판단해. 문서에 적힌 결론을 사실로 가정하지 말 것.

[저장소]
- 경로:
  C:\Users\young\prg\ENTRY\extensions\Entry Debugger
- 대상 브랜치:
  refactor/reliability-release-2.6.1
- 기준 브랜치:
  origin/main
- 전체 변경:
  git diff origin/main...HEAD
- 변경 파일:
  git diff --name-status origin/main...HEAD

[작업 목적]
`지식/entry-debugger-refactor-review.md`에서 채택한 항목 중 웹스토어 릴리스에
안전하게 포함할 수 있는 작은 범위만 반영했다.

1. `tools/check-settings.js`
   - settings.js 기본값과 부분 입력
   - 전체 enabled OFF
   - debugger OFF -> lab OFF
   - lab OFF -> turbo/functionLibrary/frameProfiler 초기화
   - boost 버튼 숨김 -> boost OFF
   - dropdown 하위 토글 저장값 보존
   - 고화질 이미지 배율 정수화·200~2000 clamp
   - MAIN_FEATURE_KEYS와 활성 기능 개수 일치
2. `tools/check-page-core-loader.js`
   - 실제 content.js에서 PAGE_CORE_SCRIPTS와 주입 함수를 추출
   - 코어 4종 -> inject.js 순서
   - 로딩 중 중복 주입 방지
   - script.async=false
   - onload 후 script 제거
3. `entry-debugger-extension/inject.js`
   - `prevSnapshotJSON = ''; pollAndBroadcast();` 계열을 `forceResync()`로 통합
   - 변경 후 즉시 재동기화하는 10개 메시지 경로의 동작 보존
4. 버전 2.6.1과 README·지식 문서·웹스토어 제출 기록 갱신

[의도적으로 제외한 범위]
- settings.js 스키마화
- Promise 기반 page-core 순차 로더
- injectPageScript onerror 및 실패 후 재시도
- page-world fallback 제거
- retry controller 통합
- content.js/inject.js 대규모 파일 분리
- 기능 레지스트리와 메시지 프로토콜 중앙화

[중점 검토]
1. `check-settings.js`가 현재 19개 설정 키와 필드 간 불변조건을 충분히 고정하는가.
   - `enabled:false`여도 dropdown 하위 토글과 이미지 배율은 저장값을 보존해야 한다.
   - 전체 기능 OFF 계산에서 누락된 기능 키가 없는지 settings.js와 대조한다.
   - 기본값 객체 변이, NaN/Infinity/문자열/소수 배율 등 경계가 올바른지 본다.
2. `check-page-core-loader.js`가 제품 코드와 분리된 복제품을 검증하는 테스트가 아닌지
   확인한다. content.js 심볼을 실제로 추출하지만 문자열·중괄호 파싱 방식이 취약하거나
   의미 있는 변경을 놓칠 수 있는지 판단한다.
3. page-core 테스트의 표현 수위가 정확한지 확인한다.
   - 현재 검사는 성공 경로의 append 순서·중복 가드·onload 정리만 다룬다.
   - 실제 네트워크 로드 완료 순서, onerror, 실패 복구, 재시도는 검증하지 않는다.
   - `async=false` 설정만으로 문서가 과도한 보장을 주장하지 않는지 본다.
4. `forceResync()` 치환 전후의 호출 순서와 동기 동작이 완전히 같은지 확인한다.
   - SET_VARIABLE, SET_SYSTEM_VARIABLE, SET_SYSTEM_VISIBLE
   - CHANGE_VARIABLE_SCOPE
   - SET_LIST_ITEM, ADD_LIST_ITEM, REMOVE_LIST_ITEM
   - CHANGE_SCENE
   - ADD_FUNCTION_LIBRARY_TEMPLATE
   - REQUEST_SNAPSHOT
   - startPolling의 초기화는 의도적으로 helper로 바꾸지 않은 것이 적절한지 본다.
5. manifest와 README 버전이 2.6.1로 일치하고 권한·대상 URL·WAR 범위가 넓어지지
   않았는지 확인한다.
6. production 폴더에 테스트 fixture, source map, localhost 대상, 원격 실행 코드,
   불필요한 권한이 들어가지 않았는지 확인한다.
7. 기존 작업 트리에 있던 알림 문서 수정이 실제 코드 상태와 일치하며 이번 커밋에
   섞여도 무관한 변경이 아닌지 판단한다.
8. 문서의 수치와 표현이 실제 코드와 일치하는지 확인한다.
   특히 21개 JS, inject.js 줄 수, 재동기화 경로 10곳, 성공 경로만 검증한다는 제한.

[실행할 검증]
PowerShell에서는 npm.ps1 실행 정책 문제를 피하려고 npm.cmd를 사용한다.

  npm.cmd run check
  npm.cmd run build:dev
  git diff --check

가능하면 다음도 실행한다.

  npm.cmd run smoke:local
  npm.cmd run smoke:picture-tools
  npm.cmd run smoke:frame-profiler

단, smoke:local 계열은 로컬 Entry 서버 127.0.0.1:8080과 외부 Entry 자원이 필요하다.
현재 환경에서는 외부 자원이 ERR_NETWORK_ACCESS_DENIED로 차단되어 `.propertyTab`
생성 전 180초 타임아웃이 발생했다. 이 경우 코드 실패와 환경 실패를 구분해서 보고한다.

이 작업에서 별도로 통과한 Chromium 회귀 하네스가 현재 머신에 남아 있다면:

  node C:\tmp\verify-entry-debugger-toast.js

이 하네스는 네이티브 토스트, 설정 초기화, 블록 텍스트 복사, 모양 도구 confirm/prompt/
진행 UI를 검증한다. 파일이 없으면 미실행으로 기록하고 대체 검증을 제안한다.

[웹스토어 ZIP]
- 파일:
  C:\Users\young\prg\ENTRY\extensions\Entry Debugger\
  Entry-Debugger-2.6.1-chrome-web-store.zip
- 예상 크기: 137,636 bytes
- 예상 SHA-256:
  D643F4B73C9C1BB2388FD213B5BCE31234724CB471A336E9C3CA019691ADAA61
- 예상 파일 수: 26개
- ZIP 루트에 manifest.json이 있어야 한다.
- 원본 `entry-debugger-extension/`과 압축 해제본의 상대 경로·파일별 SHA-256이
  모두 일치해야 한다.

[참고 문서]
- 지식/entry-debugger-refactor-review.md
- 지식/entry-debugger-refactor-architecture.md
- 지식/chrome-web-store-release-2.6.1.md
- 지식/entry-debugger-notification-popups.md
- README.md

[산출물]
1. findings를 심각도순으로 먼저 작성하고 파일·줄번호를 붙인다.
2. 블로커와 비블로커를 명확히 구분한다.
3. 문제가 없으면 "블로커 없음"을 분명히 쓰고 남은 검증 공백을 별도로 적는다.
4. 테스트 결과를 PASS / FAIL / BLOCKED 표로 정리한다.
5. 최종 결론을 다음 중 하나로 제시한다.
   - 머지 및 웹스토어 제출 가능
   - 수정 후 재검토
   - 제출 보류
6. 검토 중에는 원본 파일, 브랜치, ZIP을 수정하거나 다시 만들지 않는다.
```
