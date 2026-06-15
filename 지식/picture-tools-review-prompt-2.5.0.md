# 모양 탭 편의 기능 2.5.0 검토 프롬프트

아래 프롬프트를 새 Codex 컨텍스트나 다른 코드 리뷰 도구에 그대로 전달한다.

````markdown
# 코드 리뷰 요청: Entry Debugger 모양 탭 편의 기능 2.5.0 릴리스 보강

## 리뷰 대상

- 저장소: `205sla/Entry-Debugger`
- 로컬 경로: `C:\Users\young\prg\ENTRY\extensions\Entry Debugger`
- 작업 브랜치: `fix/picture-tools-store-release`
- 확장 production 폴더: `entry-debugger-extension/`
- 핵심 모듈: `entry-debugger-extension/picture-tools.js`
- 구현·검증 기록: `지식/picture-tools-review-and-release-2.5.0.md`

현재 변경은 커밋되지 않은 워킹트리 변경과 신규 파일을 포함한다. `git diff`만 보고 신규 파일을 빠뜨리지 말 것.

먼저 다음을 확인해라.

```powershell
git status --short --branch
git diff --stat
git diff --check
git diff
git ls-files --others --exclude-standard
```

신규 파일은 반드시 전체 정독한다.

- `tools/smoke-picture-tools.js`
- `지식/build-dev-extension-windows-crlf.md`
- `지식/picture-tools-review-and-release-2.5.0.md`
- `지식/picture-tools-review-prompt-2.5.0.md`

## 변경 목적

이미 도입된 모양 탭 편의 기능을 Chrome Web Store에 제출하기 전 검토하면서 다음 문제를 수정했다.

- 복제 시 `scale` 누락
- 추가·삭제가 Entry command/undo 경로를 우회하던 문제
- `injectPicture` 임시 몽키패치의 예외·중첩 복원 위험
- 빠른 재정렬 뒤 위젯 항목과 순서 번호 불일치
- 빠른 삭제의 명령 일부 실패 시 모델/DOM 불일치
- 일괄 이름변경의 저장 모델·painter·이벤트 동기화 부족
- 기능 OFF/cleanup 후 observer와 업로드 비동기 작업 잔존
- 업로드 알림 검색 범위가 페이지 전체였던 문제
- GIF·ZIP 처리 자원 상한 부재
- Windows CRLF 환경에서 `npm run build:dev` 실패

업로드 요구사항은 다음과 같다.

1. GIF를 PNG 프레임으로 먼저 분해한다.
2. `GIF 프레임 수 + 일반 이미지 수`가 10개 이하면 Entry 기본 파일 업로드를 한 번만 사용한다.
3. 10개 이하에서는 확장의 스테이징 진행 UI가 없어야 한다.
4. 11개 이상에서만 10개씩 누적 스테이징한다.
5. 스테이징 중 `추가하기` 또는 닫기 버튼을 누르면 다음 묶음, GIF 디코딩, 대기 작업과 진행 UI를 모두 중단한다.
6. 같은 규칙이 오브젝트 추가하기와 모양 추가하기의 파일 업로드에 적용되어야 한다.

## 중점 검토

1. **Entry 명령과 undo/redo**
   - `objectAddPicture`, `objectRemovePicture` 인자가 Entry 원본 command 정의와 일치하는가.
   - 복사·붙여넣기·복제·삭제 후 undo/redo가 모델과 UI를 일관되게 복구할 수 있는가.

2. **렌더 억제 안전성**
   - `withSuppressedPictureRender()`가 중첩·예외·부분 실패에서 항상 원래 `injectPicture`와 `reloadPlayground`를 복구하는가.
   - 비동기 코드가 억제 구간에 들어가 전역 함수가 장시간 교체될 가능성은 없는가.

3. **빠른 재정렬·삭제**
   - `pictureSortableListWidget._data.items`와 실제 `o.pictures`, DOM, `orderHolder`가 동일한 순서를 유지하는가.
   - 삭제 명령 일부 실패 시 부분 DOM 갱신을 하지 않고 실제 모델 기준으로 복구하는가.
   - 1,000개 이상 모양에서 성능 최적화가 기본 Entry 동작을 깨지 않는가.

4. **일괄 이름변경**
   - `picture.name`, 직렬화 결과, 선택 모양, painter 파일명, `pictureNameChanged`, `reloadPlayground`가 충분히 동기화되는가.
   - 기존 이름 충돌, 빈 이름, 편집 중 blur, 재렌더 직후 선택 상태에 회귀가 없는가.

5. **업로드 경계와 세션 취소**
   - GIF 분해 뒤 최종 개수를 기준으로 10/11 경계가 정확한가.
   - 10개 이하 경로가 진행 UI 없이 네이티브 change 이벤트 한 번만 발생시키는가.
   - `uploadSessionId`, `filePickerSessionId`, `activeStageSessionId`가 이전 모달의 비동기 작업을 확실히 무효화하는가.
   - Entry 모달이 제거되지 않고 숨겨지는 현재 동작에서도 `추가하기`와 X가 취소로 처리되는가.
   - 취소 직전·직후 새 업로드 창을 열 때 이전 queue나 timer가 섞이지 않는가.
   - 오브젝트 추가하기와 모양 추가하기를 각각 확인할 것.

6. **observer와 기능 수명주기**
   - 기능 OFF, 확장 전체 OFF, SPA 이동, cleanup, 재활성화에서 observer 중복 또는 잔존이 없는가.
   - 비활성 상태에서 선택 강조나 업로드 후킹이 Entry 기본 동작을 가로채지 않는가.

7. **Entry 내부 의존성**
   - `entry-adapter.js`로 옮긴 접근이 충분한가.
   - `file_add_box`, `imbtn_pop_close`, `btn_back`, `pictureSortableListWidget`, `_data.items`가 바뀔 때 실패 방식이 안전한가.

8. **자원과 보안**
   - GIF 2,000프레임, 프레임당 16,777,216픽셀, ZIP 512MiB 제한이 적절히 적용되는가.
   - decoder/image/Blob/DOM/timer가 취소·예외 때 정리되는가.
   - 추가 권한, 원격 실행 코드, `eval`/`Function`, 경로 트래버설 위험이 없는가.

9. **Windows 개발 빌드**
   - CRLF를 LF로 정규화한 뒤 패치 문자열을 찾는 방식이 산출물 EOL과 기능을 깨지 않는가.
   - `content.js`의 대상 블록이 바뀔 때 명확하게 실패하는가.

10. **테스트 품질**
    - `tools/smoke-picture-tools.js`가 실제 구현을 검증하며 지나치게 구현 세부에 결합되지 않았는가.
    - fixture 모달과 현재 playentry.org 모달의 차이 때문에 놓치는 회귀가 무엇인지 제시할 것.

## 검증 명령

로컬 Entry 서버가 필요한 검증에서만 서버를 시작하고, 끝나면 반드시 종료한다.

```powershell
cd C:\Users\young\prg\ENTRY\_docs\local-entry-testing
.\start-local-entry-server.bat

cd "C:\Users\young\prg\ENTRY\extensions\Entry Debugger"
npm run check
npm run build:dev
npm run smoke:local
npm run smoke:picture-tools

cd C:\Users\young\prg\ENTRY\_docs\local-entry-testing
.\stop-local-entry-server.bat
```

Chromium 실사이트 검증이 필요하면 임시 프로필과 개발용 확장을 사용하되 작품을 저장하거나 최종 `추가하기`를 눌러 외부 상태를 변경하지 말 것.

확인할 핵심 시나리오:

- 모양 추가하기: PNG 1개, PNG 10개, PNG 11개
- 모양 추가하기: 다중 프레임 GIF + PNG 합계 10개와 11개
- 모양 추가하기: 25개 업로드 첫 묶음 뒤 `추가하기` 취소와 X 취소
- 오브젝트 추가하기: 같은 10/11 경계와 취소
- 복제한 모양의 `scale`
- 삭제·복제 후 undo/redo 반복
- 일괄 이름변경 후 작품 직렬화 결과

## 현재 검증 근거

- `npm run check`: 통과
- `npm run build:dev`: Windows에서 통과
- `npm run smoke:local`: 통과, 모양 도구 기본 OFF 확인
- `npm run smoke:picture-tools`: 통과
- playentry.org 모양 추가하기:
  - 1개 업로드에서 진행 UI 없음
  - 25개 업로드 첫 10개 뒤 X를 누르면 `[10]`에서 중단
  - 모달 종료 뒤 진행 UI 없음
  - 관련 console/page error 없음
- 제출 ZIP:
  - `Entry-Debugger-2.5.0-chrome-web-store.zip`
  - 26개 파일
  - 루트 `manifest.json`
  - SHA-256 `1AA649EE8439415A5BC99A7370FB3C79B378F76A75D5983B83D5BC26205E9E5A`

위 결과를 그대로 신뢰하지 말고 코드와 필요한 테스트로 독립 확인할 것.

## 기대 산출물

코드 리뷰 형식으로 작성한다.

1. findings를 심각도 순서로 먼저 제시
2. 각 finding에 파일과 정확한 줄 번호 포함
3. `블로커`와 `비블로커` 구분
4. 재현 조건, 실제 영향, 권장 수정 포함
5. 발견 사항이 없으면 “릴리스 블로커 없음”을 명시
6. 남은 테스트 공백과 Entry 업데이트에 따른 잔여 위험 별도 정리
7. 마지막에 Chrome Web Store 제출 가능 여부를 `가능 / 수정 후 가능 / 불가` 중 하나로 판단

리뷰 단계에서는 요청받지 않은 코드 수정이나 커밋을 하지 말 것.
````
