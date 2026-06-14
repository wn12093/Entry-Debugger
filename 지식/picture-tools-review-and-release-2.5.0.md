# 모양 탭 편의 기능 2.5.0 검토 및 릴리스

확인 날짜: 2026-06-15

대상:

- `entry-debugger-extension/picture-tools.js`
- `entry-debugger-extension/entry-adapter.js`
- `entry-debugger-extension/content.js`
- `entry-debugger-extension/settings.js`
- `entry-debugger-extension/manifest.json`
- `tools/build-dev-extension.js`
- `tools/smoke-local-extension.js`
- `tools/smoke-picture-tools.js`
- `package.json`

작업 브랜치: `fix/picture-tools-store-release`

## 0. 작업 목적과 최종 상태

이번 작업은 이미 추가된 `모양 탭 편의 기능`을 Chrome Web Store에 제출할 수 있는 수준으로 검토하고, 발견된 데이터 동기화·업로드 수명주기·Windows 빌드 문제를 수정하는 작업이다.

최종 상태:

- `모양 탭 편의 기능`은 설정에서 기본 꺼짐이다.
- 확장 전체를 끄거나 페이지 수명주기가 끝나면 모양 도구도 명시적으로 비활성화된다.
- 일반 이미지와 GIF 분해 프레임의 합계가 10개 이하면 Entry 기본 업로드 경로를 한 번만 사용한다.
- 11개 이상일 때만 10개 단위 스테이징과 진행 UI를 사용한다.
- 스테이징 중 `추가하기` 또는 닫기 버튼을 누르면 남은 비동기 작업을 중단한다.
- Entry 명령 API를 사용하도록 추가·복제·삭제 경로를 정리해 실행 취소 기록과 모델 변경이 분리되지 않게 했다.
- 로컬 Chromium, 모양 도구 전용 Chromium, 현재 playentry.org 실사이트 Chromium 검증을 통과했다.
- 제출용 ZIP을 생성하고 원본 26개 파일과 ZIP 내부 파일의 SHA-256을 대조했다.

## 1. 변경 파일별 역할

| 파일 | 반영 내용 |
| --- | --- |
| `entry-debugger-extension/picture-tools.js` | 모양 명령 처리, 렌더 억제, 업로드 10개 경계, GIF 합산, 업로드 취소, observer 수명주기, 이름변경 동기화, 자원 제한 |
| `entry-debugger-extension/entry-adapter.js` | 오브젝트 목록, 모양 위젯·항목, 위젯 데이터 갱신, `Entry.do`, `Entry.getOrderedName` 접근을 어댑터로 이동 |
| `entry-debugger-extension/content.js` | 전체 cleanup 시 `single-block-drag`와 `picture-tools`를 명시적으로 비활성화 |
| `entry-debugger-extension/settings.js` | `pictureToolsEnabled` 기본값 OFF와 전체 확장 비활성화 시 OFF 처리. 이 부분은 기능 도입 때 이미 반영된 기준이며 이번 검토에서도 유지 |
| `entry-debugger-extension/manifest.json` | `picture-tools.js` WAR 등록과 버전 `2.5.0`. 추가 권한 없음 |
| `tools/smoke-picture-tools.js` | 모양 데이터·명령·업로드 경계·취소 전용 Chromium 회귀 테스트 신규 추가 |
| `tools/smoke-local-extension.js` | 설정 화면에 모양 도구 토글이 존재하고 기본값이 OFF인지 검증 |
| `tools/build-dev-extension.js` | Windows CRLF 체크아웃에서도 개발 빌드 문자열 패치가 동작하도록 LF 정규화 |
| `package.json` | `npm run smoke:picture-tools` 등록 |
| `README.md` | 새 검증 명령과 10개 업로드·취소 동작을 2.5.0 변경사항에 반영 |
| `지식/build-dev-extension-windows-crlf.md` | Windows 전용 빌드 실패 원인과 재발 방지 기준 기록 |
| `지식/picture-tools-review-and-release-2.5.0.md` | 이번 검토·수정·검증·릴리스 근거 기록 |
| `지식/picture-tools-review-prompt-2.5.0.md` | 새 컨텍스트에서 독립 재검토할 수 있는 명령·중점 항목·기대 산출물 제공 |

## 2. 검토에서 확인한 오류와 수정

| 항목 | 문제 | 수정 기준 |
| --- | --- | --- |
| 모양 복제 | `scale`이 복사되지 않아 크기가 달라질 수 있음 | 복제 데이터에 `scale` 보존 |
| 추가·삭제 | 모델 메서드를 직접 호출해 Entry 실행 취소 기록과 어긋남 | `Entry.do('objectAddPicture' / 'objectRemovePicture')` 사용 |
| 렌더 억제 | `injectPicture` 임시 교체가 중첩·예외에 취약 | 깊이 기반 억제 상태와 `finally` 복원 |
| 빠른 재정렬 | 위젯 항목 매핑과 순서 번호가 이전 상태로 남을 수 있음 | DOM 참조 `Map` 매핑과 `orderHolder` 갱신 |
| 빠른 삭제 | 명령 일부 실패 시 모델과 DOM이 달라질 수 있음 | 전부 성공한 경우에만 부분 갱신, 아니면 전체 렌더링 |
| 일괄 이름변경 | 모델만 바뀌어 painter·저장·이벤트 상태가 어긋날 수 있음 | 선택 모양·painter 이름 동기화, 재로딩, `pictureNameChanged` 발생 |
| 업로드 알림 검색 | 페이지 전체의 `확인` 버튼을 누를 가능성 | Entry 전역 모달 내부로 검색 범위 제한 |
| 기능 비활성화 | observer와 진행 작업이 남을 수 있음 | observer 해제, 업로드 세션 무효화, 진행 UI 제거 |
| GIF·ZIP | 과도한 프레임·해상도·전체 크기 제한이 없음 | GIF 2000프레임, 프레임당 16,777,216픽셀, ZIP 512MiB 제한 |

### 삭제 예외 처리

`fastBulkRemove()`는 모든 Entry 삭제 명령이 실제 모델에서 성공한 경우에만 위젯 항목을 부분 갱신한다. 일부 명령이 실패하면 삭제 대상 전체를 DOM에서 제거하지 않고 `injectPicture()`와 `reloadPlayground()`로 실제 모델 기준 전체 렌더링을 수행한다.

### 렌더 억제 규칙

`withSuppressedPictureRender()`는 `injectPicture`와 필요 시 `reloadPlayground`를 잠시 무력화한다. 중첩 깊이를 추적하고 가장 바깥 호출의 `finally`에서 원래 함수를 복구한다.

이 도우미는 현재 모두 동기식 `Entry.do()` 묶음에서만 사용한다. 콜백 내부에 `await`나 장기 비동기 작업을 추가하면 전역 렌더 함수가 오래 교체된 상태로 남으므로 사용 범위를 다시 설계해야 한다.

## 3. 업로드 동작 규칙

1. 사용자가 선택한 파일을 먼저 확장한다.
2. GIF는 PNG 프레임으로 분해한다.
3. `GIF 프레임 수 + 일반 이미지 수`를 최종 업로드 개수로 계산한다.
4. 최종 개수가 10개 이하면 Entry의 네이티브 파일 입력에 한 번만 전달한다.
5. 이 경로에서는 `스테이징 중` 진행 UI를 표시하지 않는다.
6. 11개 이상이면 10개 단위로 누적 스테이징한다.
7. 스테이징 중 업로드 창의 `추가하기` 또는 닫기 버튼을 누르면 세션을 무효화하고 대기 중인 묶음과 진행 UI를 제거한다.

Entry 업로드 모달은 닫혀도 `#EntryPopupContainer`가 DOM에 숨겨진 채 남을 수 있다. 따라서 DOM 제거만 감시해서는 취소를 판정할 수 없고, 모달 안의 확정·닫기 클릭을 캡처 단계에서 처리해야 한다.

### 업로드 세션 모델

- `uploadSessionId`: 취소 때 증가하는 세대 번호다.
- `filePickerSessionId`: 파일 선택기를 연 시점의 세대 번호다.
- `activeStageSessionId`: 현재 스테이징 루프가 소유한 세대 번호다.
- `uploadRoot`: 파일을 선택한 Entry 업로드 모달이다.
- `isUploadSessionActive()`: 기능 활성화, 세대 일치, 모달과 `#inpt_file` 존재를 함께 확인한다.
- `cancelUploadWork()`: 세대를 무효화하고 queue·진행 상태·숨은 파일 입력 값을 비운다.

GIF 디코딩, 마지막 파일 표시 대기, 묶음 사이 지연마다 세션 활성 상태를 다시 확인한다. 따라서 모달을 닫은 뒤 이미 시작된 비동기 루프가 다음 묶음을 전달하지 않는다.

### 두 업로드 진입점

후킹은 특정 “모양 추가하기” 버튼이 아니라 현재 Entry 모달 내부의 `[class*="file_add_box"]`를 대상으로 한다. 따라서 오브젝트 추가하기와 모양 추가하기의 파일 업로드 화면이 같은 Entry 파일 박스 구조를 사용할 때 동일한 규칙이 적용된다.

현재 실사이트 자동 확인은 모양 추가하기 경로에서 수행했다. 다음 정기 실사이트 회귀 검증에서는 오브젝트 추가하기 경로도 별도로 확인한다.

## 4. Entry 내부 API 사용 기준

- 모양 추가: `Entry.do('objectAddPicture', objectId, picture, false)`
- 모양 삭제: `Entry.do('objectRemovePicture', objectId, picture)`
- 이름 확정에 맞춘 동기화:
  - `picture.name`
  - 선택 모양이면 `playground.painter.file.name`
  - `playground.reloadPlayground()`
  - `Entry.dispatchEvent('pictureNameChanged', picture)`
- 직접 접근이 필요한 `pictureSortableListWidget`과 `_data.items`는 `entry-adapter.js` 뒤로 모은다.
- 성능용 렌더 억제는 동기 명령 구간에서만 사용하고 항상 `finally`에서 원복한다.

Entry 원본 근거:

- `upstream/entryjs-develop/src/command/commands/object.js`
  - `objectAddPicture`
  - `objectRemovePicture`
- `upstream/entryjs-develop/src/class/playground.js`
  - 모양 추가 시 `Entry.getOrderedName`과 `Entry.do('objectAddPicture', ...)`
  - 이름 확정 시 모델·painter·reload·`pictureNameChanged` 동기화

## 5. 수명주기와 기능 비활성화

- `content.js`의 전체 `cleanup()`은 `SET_PICTURE_TOOLS_ENABLED { enabled: false }`를 전송한다.
- page-world 모듈은 OFF 전환 시 context menu를 닫고 observer를 끊고 업로드 세션과 진행 UI를 정리한다.
- 기능이 다시 켜지면 observer를 재연결하고 Entry 준비 재시도를 시작한다.
- MutationObserver 콜백은 기능이 켜진 동안만 선택 강조 갱신을 예약한다.
- 전체 확장 비활성화 시 `settings.js` 정규화 결과도 `pictureToolsEnabled: false`가 된다.

## 6. 자원·보안 기준

- GIF 최대 프레임: 2,000
- GIF 프레임당 최대 픽셀: 16,777,216
- ZIP 이미지 내보내기 누적 최대 크기: 512MiB
- GIF의 `ImageDecoder`와 각 프레임 이미지는 `finally`에서 닫는다.
- ZIP 파일명은 기존 `safeName()`으로 경로 구분자와 위험 문자를 제거한다.
- `eval`과 `new Function`은 사용하지 않는다.
- Manifest 권한은 `storage` 하나이며 `host_permissions`와 `optional_permissions`는 없다.
- production content script는 `https://playentry.org/ws/*`만 대상으로 한다.
- 개발용 localhost match는 `dist/entry-debugger-extension-dev` 생성 때만 추가된다.

## 7. 자동 검증

### `npm run smoke:picture-tools`

다음을 Chromium에서 검증한다.

- 단일 삭제가 `objectRemovePicture` 명령을 사용
- 복제 시 `scale` 보존 및 `objectAddPicture` 명령 사용
- 빠른 재정렬 뒤 순서 번호 갱신
- 일괄 이름변경의 모델·직렬화·painter·이벤트 동기화
- 일반 이미지 3개: 단일 네이티브 전달, 진행 UI 없음
- GIF 1프레임 + 일반 이미지 3개: 총 4개, 진행 UI 없음
- GIF 1프레임 + 일반 이미지 10개: 총 11개, `10 + 1` 스테이징
- 일반 이미지 11개: `10 + 1` 스테이징
- 일반 이미지 25개: `추가하기`와 닫기 버튼 각각 첫 묶음 뒤 취소

최종 결과 요약:

```text
deleteCommands: objectRemovePicture
duplicate scale: 37
duplicate command: objectAddPicture
order labels: 1,2,3,4,5
rename model/serialized/painter/events/reload: 통과
small upload: [3], progress 없음
GIF 1 + PNG 3: [4], progress 없음
GIF 1 + PNG 10: [10,1], progress 있음
PNG 11: [10,1], progress 있음
추가하기 취소: 첫 묶음 1회만 전달
닫기 취소: 첫 묶음 1회만 전달
```

### `npm run smoke:local`

- 개발용 확장 버전 `2.5.0`
- 디버깅 탭·설정 화면·부스트 모드·함수 보관함·속성 검색 회귀 통과
- `pictureToolsEnabled` 설정 토글 존재
- 모양 탭 편의 기능 기본값 OFF 확인

### 정적 검사

- `npm run check`: 통과
- `node --check`: 변경 JavaScript 통과
- `git diff --check`: 오류 없음. Windows의 LF/CRLF 변환 예정 경고만 존재
- production manifest와 README 버전: `2.5.0` 일치
- 확장 production 폴더에 test/spec/smoke fixture 없음

## 8. 실사이트 Chromium 확인

검증 URL:

```text
https://playentry.org/ws/57c0475bc42171e8ffd63379
```

현재 Entry 모달에서 다음을 확인했다.

- `#EntryPopupContainer`, `#inpt_file`, `file_add_box`, `추가하기`, 닫기 버튼 셀렉터 호환
- 확장 디버깅 탭과 부스트 모드 UI 주입
- 이미지 1개 업로드가 Entry 기본 경로로 처리되고 진행 UI가 나타나지 않음
- 25개 업로드에서 첫 10개 전달 직후 닫기 버튼을 누르면 이후 묶음이 전달되지 않음
- 모달을 닫은 뒤 진행 UI가 남지 않음
- 관련 console/page error 없음

실사이트에서는 최종 `추가하기`를 눌러 작품에 저장하지 않았고, 임시 브라우저 프로필을 닫아 외부 상태를 남기지 않았다.

## 9. Windows 개발 빌드 수정

Windows 체크아웃의 `content.js`는 CRLF일 수 있지만 `build-dev-extension.js`의 검색 문자열은 LF로 만들어진다. 이 차이 때문에 정확 문자열 검색이 실패했다.

소스를 읽은 직후 아래처럼 LF로 정규화한다.

```js
fs.readFileSync(contentScriptPath, 'utf8').replace(/\r\n/g, '\n')
```

수정 뒤 `npm run build:dev`와 `npm run smoke:local`이 Windows에서 통과했다. 자세한 원인과 EOL 정책은 `build-dev-extension-windows-crlf.md`를 참고한다.

## 10. 릴리스 점검 명령

```powershell
npm run check
npm run build:dev
npm run smoke:local
npm run smoke:picture-tools
```

Chrome Web Store 제출 ZIP의 루트에는 `manifest.json`이 있어야 하며, `entry-debugger-extension/` 폴더 내용만 포함한다. `dist/`, `tools/`, 테스트 fixture와 프로젝트 문서는 제출물에 넣지 않는다.

검증에 필요할 때만 로컬 Entry 서버를 시작하고 작업 뒤 종료한다.

```powershell
cd C:\Users\young\prg\ENTRY\_docs\local-entry-testing
.\start-local-entry-server.bat
.\stop-local-entry-server.bat
```

## 11. 제출 산출물

- 파일: `Entry-Debugger-2.5.0-chrome-web-store.zip`
- 확장 버전: `2.5.0`
- ZIP 내부 파일: 26개
- 크기: 127,998 bytes
- SHA-256: `1AA649EE8439415A5BC99A7370FB3C79B378F76A75D5983B83D5BC26205E9E5A`
- 검증: 루트 `manifest.json` 존재, 원본 누락·추가·해시 불일치 없음

ZIP은 `.gitignore`의 `*.zip` 규칙에 따라 Git 상태에 표시되지 않는다.

## 12. 남은 위험과 다음 검토 포인트

릴리스 블로커로 확인된 문제는 없지만 다음 항목은 Entry 업데이트나 대규모 사용 시 회귀 가능성이 있다.

- Entry 내부 DOM 클래스 조각: `file_add_box`, `imbtn_pop_close`, `btn_back`, `entryPlaygroundPictureElement`
- Entry 내부 위젯 필드: `pictureSortableListWidget`, `_data.items`
- 실제 다중 프레임 GIF의 긴 디코딩 중 취소와 메모리 사용
- 1,000개 이상 모양에서 부분 재정렬·삭제 성능
- 복제·삭제 뒤 Entry undo/redo를 여러 번 반복하는 시나리오
- 오브젝트 추가하기 파일 업로드 화면에서 10개 경계와 취소
- Entry가 업로드 모달 버튼 문구나 DOM 구조를 변경하는 경우

이 항목은 기능 오류가 확인됐다는 뜻이 아니라, 현재 자동 테스트와 실사이트 검증 범위를 넘어서는 잔여 위험이다.

## 13. 리뷰 인수인계

새 컨텍스트에서 재검토할 때는 `picture-tools-review-prompt-2.5.0.md`의 프롬프트를 사용한다. 현재 변경은 커밋 전 워킹트리에 있으므로 `git diff`뿐 아니라 `git status`의 신규 파일도 반드시 직접 읽어야 한다.
