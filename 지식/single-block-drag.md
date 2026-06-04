# Alt 단일 블록 드래그 구현 기록

확인 날짜: 2026-06-04

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
- `Entry.BlockView.prototype.onMouseDown`, `onMouseMove`, `terminateDrag`를 `EntryDebuggerPatchRegistry`로 한 번만 래핑한다.
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

## 4. Undo 처리

- 단일 분리를 위해 실행한 보조 명령과 최종 `moveBlock`/`insertBlock`이 하나의 사용자 동작처럼 되돌아가야 한다.
- 중간 블록의 `insertBlock(3, 1)`은 `isPass(true)`로 표시한다.
- `terminateDrag` 이후 새 최종 드래그 명령이 생긴 경우 `Entry.isPass(true)`로 표시해 undo가 보조 명령까지 이어지도록 한다.

## 5. 제한과 주의점

- 기본 블록(`getBlockType() === 'basic'`)만 대상으로 한다.
- 블록 꾸러미 안의 블록, 읽기 전용 보드, 이동 불가 블록은 제외한다.
- 첫 블록 단일 분리는 top-level Entry Code 스택에서만 처리한다. statement 내부 첫 블록은 Entry 원본의 statement 재삽입 처리가 더 복잡하므로 안전하게 기존 동작을 유지한다.
- Entry 원본의 SVG 재부모화 구조에 의존하므로 `BlockView`, `Thread`, `Board.insert/separate` 구조가 바뀌면 재검증이 필요하다.

## 6. 설정

- 설정 키: `singleBlockDragEnabled`
- 기본값: `false`
- 위치: 디버깅 탭 내부 설정 탭
- 전체 확장 기능이 꺼지면 함께 비활성화된다.
