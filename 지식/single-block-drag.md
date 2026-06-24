# Alt 단일 블록 드래그 구현 기록

확인 날짜: 2026-06-04

마지막 갱신: 2026-06-24

대상 기능: Entry 만들기 화면에서 여러 블록이 직렬로 연결되어 있을 때, `Alt` 키를 누른 채 중간 블록을 드래그하면 선택한 블록만 분리해서 이동한다.

## 1. Entry 원본에서 확인한 사실

- 블록 드래그 시작/이동/종료는 Entry 원본의 `src/playground/block_view.js`에서 처리한다.
- 기본 드래그는 선택한 블록 아래에 연결된 블록을 SVG 자식 그룹으로 함께 들고 이동한다.
- 드래그 종료 시 `separateBlock`, `insertBlock`, `moveBlock` 명령이 실행되며, 기본 `separateBlock`은 선택한 블록부터 아래 전체를 분리한다.
- `Entry.Thread.separate(block, count, index)`와 `Entry.Collection.splice(index, amount)`는 count 기반 분리를 지원한다. 다만 기존 명령은 undo 상태를 아래 전체 기준으로 기록하므로 그대로 단일 분리에 쓰기 어렵다.
- `Alt` 키는 작업공간 단축키(`Alt+1/2/3/4`, `Alt+[`/`]`)에 쓰이지만, 단독 `Alt+드래그` 분기는 없다.

## 2. 확장 구현

파일: `entry-debugger-extension/single-block-drag.js`

- Main World에 주입되는 독립 패치 스크립트다.
- `Entry.BlockView.prototype.onMouseDown`, `terminateDrag`를 `EntryDebuggerPatchRegistry`로 한 번만 래핑한다.
- `onMouseMove`는 `BlockView` 생성자에서 이미 인스턴스에 바인딩되므로 prototype 래핑만으로는 기존 블록에 적용되지 않는다. 따라서 `onMouseDown`에서 해당 블록 뷰 인스턴스의 `onMouseMove`를 교체한다.
- `mousedown`에서 `event.altKey`가 눌렸는지 기록한다.
- 실제 드래그 반경을 넘은 첫 `mousemove`에서만 단일 분리 준비를 실행한다. 따라서 `Alt+클릭`만으로는 프로젝트 구조가 바뀌지 않는다.
- 마지막 블록처럼 아래 연결 블록이 없는 경우에는 기존 드래그와 같으므로 별도 처리하지 않는다.

## 3. 분리 전략

중간 블록 예시: `1-2-3-4`에서 `2`를 Alt 드래그

1. `Entry.do('separateBlock', 2, Entry.DRAG_MODE_MOUSEDOWN)`으로 `2-3-4`를 기존 `1`에서 분리한다.
2. `Entry.do('insertBlock', 3, 1).isPass(true)`로 `3-4`를 다시 `1` 뒤에 붙인다.
3. 이후 기존 Entry 드래그 로직이 `2`만 움직인다.

첫 블록 예시: `1-2-3-4`에서 `1`을 Alt 드래그

1. `Entry.do('separateBlock', 2, Entry.DRAG_MODE_MOUSEDOWN)`으로 `2-3-4`를 별도 스택으로 원위치에 남긴다.
2. 기존 Entry 드래그 로직이 `1`만 움직인다.

statement 내부 첫 블록 예시: `만일 참이라면 { 1-2 }`에서 `1`을 Alt 드래그

1. 원래 statement thread를 기억한다.
2. `Entry.do('separateBlock', 1, Entry.DRAG_MODE_MOUSEDOWN)`으로 `1-2`를 statement에서 분리한다.
3. `Entry.do('insertBlock', 2, 원래 statement thread, 2부터의 블록 수).isPass(true)`로 `2` 이하를 원래 statement의 맨 위에 되돌린다.
4. 기존 Entry 드래그 로직이 `1`만 움직인다.

## 4. Undo 처리

- 단일 분리를 위해 실행한 보조 명령과 최종 `moveBlock`/`insertBlock`이 하나의 사용자 동작처럼 되돌아가야 한다.
- 중간 블록의 `insertBlock(3, 1)`은 `isPass(true)`로 표시한다.
- `terminateDrag` 이후 새 최종 드래그 명령이 생긴 경우 `Entry.isPass(true)`로 표시해 undo가 보조 명령까지 이어지도록 한다.

## 5. 제한과 주의점

- 기본 블록(`getBlockType() === 'basic'`)만 대상으로 한다.
- 블록 꾸러미 안의 블록, 읽기 전용 보드, 이동 불가 블록은 제외한다.
- 첫 블록 단일 분리는 top-level Entry Code 스택과 statement thread 안의 첫 블록을 처리한다.
- statement 내부 첫 블록은 아래 블록들을 원래 statement thread에 되돌리는 보조 `insertBlock` 명령을 사용한다.
- Entry 원본의 SVG 재부모화 구조에 의존하므로 `BlockView`, `Thread`, `Board.insert/separate` 구조가 바뀌면 재검증이 필요하다.

## 6. 설정

- 설정 키: `singleBlockDragEnabled`
- 기본값: `false`
- 위치: 디버깅 탭 내부 설정 탭
- 전체 확장 기능이 꺼지면 함께 비활성화된다.

## 7. 2026-06-24 실제 마우스 드래그 회귀 수정

증상:

- 코드상 직접 `blockView.onMouseDown(event)` 뒤 `blockView.onMouseMove(event)`를 호출하면 단일 분리가 동작했다.
- 하지만 실제 Chromium/Entry 화면에서 `Alt`를 누르고 마우스로 드래그하면 기존 Entry 동작처럼 선택 블록 아래 스택이 함께 이동했다.

원인:

- Entry 원본 `src/playground/block_view.js`는 `onMouseDown` 중 `$(document).bind('mousemove.block', this.onMouseMove)`로 이동 핸들러를 문서에 바인딩한다.
- jQuery가 실제 `mousemove`를 호출할 때 래퍼 내부의 `this`는 블록 뷰가 아니라 `document`가 된다.
- 확장 구현이 인스턴스 `onMouseMove` 래퍼 안에서 `shouldPrepareOnMove(entry, this, event)`처럼 `this`를 블록 뷰로 가정하고 있었다.
- 그 결과 실제 마우스 이벤트에서는 단일 분리 준비 조건이 통과하지 못했고, 원래 Entry 드래그만 실행됐다.

수정:

- `installInstanceMoveHook(entry, blockView)`에서 래퍼가 `this`에 의존하지 않도록 한다.
- 단일 분리 판단과 준비는 클로저로 잡은 `blockView`를 사용한다.
- 원본 `instanceMove`도 `instanceMove.apply(blockView, arguments)`로 호출해 Entry 원본 `onMouseMove`가 항상 올바른 블록 뷰 컨텍스트에서 실행되도록 한다.

검증:

- `npm run build:dev`: 통과
- `npm run check`: 통과
- 로컬 Entry 서버 `http://127.0.0.1:8080/ws/abcdef0123456789abcdef01` + Chromium + 개발용 확장으로 실제 마우스 스모크를 수행했다.
- 테스트 스택: `이동 방향으로 10 만큼 움직이기 -> 화면 끝에 닿으면 튕기기 -> 1 초 기다리기`
- 가운데 `화면 끝에 닿으면 튕기기` 블록을 `Alt`를 누른 채 실제 마우스로 드래그했다.
- 이벤트 로그에서 `mousedown`과 `mousemove`의 `altKey`가 모두 `true`였고, 대상 블록 플래그 `requested`, `hookInstalled`, `prepared`가 모두 `true`가 됐다.
- 결과 스택은 `이동 방향으로 10 만큼 움직이기 -> 1 초 기다리기`와 `화면 끝에 닿으면 튕기기`로 분리됐다.

주의:

- 테스트 좌표를 블록 전체 `svgGroup.getBoundingClientRect()`의 중앙으로 잡으면 아래에 연결된 자식 블록 영역을 클릭할 수 있다. 실제 스모크에서는 대상 블록의 윗부분 본체 영역을 클릭해야 한다.
- 숫자 입력칸 같은 내부 값 블록을 클릭하면 부모 statement 블록이 아니라 내부 값 블록이 드래그될 수 있으므로, 수동 검증도 블록 몸통 부분에서 시작한다.

## 8. 2026-06-24 statement 내부 첫 블록 회귀 수정

증상:

- 이미지 예시처럼 `만일 참이라면` 안에 `x 좌표를 10 만큼 바꾸기 -> y 좌표를 10 만큼 바꾸기`가 있을 때, 맨 위 `x 좌표` 블록을 `Alt` 드래그해도 단일 이동이 되지 않았다.
- 원인은 `canPrepareSingleBlockDrag()`가 `prevBlock`이 없는 첫 블록을 top-level `Entry.Code` thread에서만 허용했기 때문이다.
- statement 내부 첫 블록의 thread parent는 `_if` 같은 `Entry.Block`이므로 준비 단계가 막혔다.

수정:

- 첫 블록 허용 조건에 statement thread를 추가했다.
- statement thread 여부는 `thread.parent instanceof Entry.Block`이고, 해당 thread가 `thread.parent.statements`에 포함되는지로 판정한다.
- statement 첫 블록은 top-level 첫 블록과 다르게 처리한다. 대상 블록 전체를 statement에서 분리한 뒤, 다음 블록 이하를 원래 statement thread 맨 위에 다시 넣는다.
- 이렇게 해야 `x 좌표`만 드래그 대상이 되고, `y 좌표`는 조건문 안에 남는다.

검증:

- `npm run build:dev`: 통과
- `npm run check`: 통과
- 로컬 Entry 서버 + Chromium + 개발용 확장 실제 마우스 스모크를 수행했다.
- 테스트 스택: `_if { move_x -> move_y }`
- `move_x` 블록 오른쪽 본체 영역에서 `Alt`를 누른 채 실제 마우스로 드래그했다.
- 이벤트 로그에서 `mousedown`과 `mousemove`의 `altKey`가 모두 `true`였고, 대상 블록 플래그 `requested`, `hookInstalled`, `prepared`가 모두 `true`가 됐다.
- 드래그 중/후 구조는 `_if { move_y }`와 조건문 밖 `move_x`로 분리됐다.
