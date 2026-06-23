---
상태: 설계
범위: 프로젝트:Entry Debugger
갱신: 2026-06-23
---

# Entry Debugger 할 일

## 지식 폴더 정리 (2.6.1·블록 편집 수정 머지 후)

문서가 30개를 넘겨, 살아있는 레퍼런스와 끝난 일회성(릴리스·프롬프트·제거된 기능)을
분리한다. 보관 방식은 **repo 내 `지식/_archive/`**, 시점은 **진행 중인 PR들이 main에
머지된 뒤**.

- [ ] 완료된 일회성 문서를 `지식/_archive/`로 이관한다.

이관 대상(지금 완료):

- `chrome-web-store-release-2.4.0.md`
- `picture-tools-review-and-release-2.5.0.md`
- `picture-tools-review-prompt-2.5.0.md`
- `entry-debugger-refactor-review-prompt-2.6.1.md`
- `entry-debugger-designer-prompt.md`
- `entry-debugger-icon-generation-prompt.md`
- `entry-eo-generator-extension.md` (EO 기능 제거됨)
- `entry-eo-built-in-generator.md` (EO 기능 제거됨)

각각 머지/완료 시 추가 이관:

- `chrome-web-store-release-2.6.1.md` — 2.6.1 머지 후
- `block-editing-fixes-review-prompt.md` — 이 블록 편집 PR 머지 후
- `entry-debugger-refactor-review.md` — 리팩토링 결론을 `entry-debugger-refactor-architecture.md`로 졸업시킨 뒤

in-place 갱신(stale 정정):

- [ ] `build-dev-extension-windows-crlf.md` — CRLF는 `tools/build-dev-extension.js:69`에서
  이미 **해결됨**. 제목·내용을 "패치 실패"에서 "해결됨"으로 정정한다(현재 2.6.1 문서가
  잘못된 "깨짐" 주장을 참조 중).
- [ ] `entry-debugger-supported-features.md` — 2.4.0 스냅샷 → 현행(2.6.x)화 또는
  "특정 버전 스냅샷"임을 명시한다.

마무리:

- [ ] `지식/README.md`를 활성 목록 + `## 보관`(→ `_archive/`) 상향 포인터로 정리.
- [ ] `_docs/INDEX.md`의 Entry Debugger 클러스터 문서 수를 갱신.

> 완료: `만약~라면~아니면` 블록 텍스트 복사 오류 수정(커밋 523bf43),
> 함수 보관함 `numberToHangul` 예제 추가(커밋 86e5bde).
