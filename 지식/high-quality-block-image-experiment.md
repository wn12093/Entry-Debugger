# 초고화질 이미지 저장하기

확인 날짜: 2026-06-02
범위: Entry Debugger 전용

## 목적

Entry 기본 `이미지로 저장하기` 흐름은 유지하면서, 블록 이미지가 생성되는 순간에만 저장 배율을 높여 더 선명한 이미지를 저장한다.

이 기능은 설정 탭 기능이며 프로젝트 JSON을 수정하지 않는다.

## 관련 파일

- `entry-debugger-extension/content.js`
- `entry-debugger-extension/high-quality-block-image.js`
- `entry-debugger-extension/settings.js`
- `entry-debugger-extension/style.css`

## 설정 키와 기본값

```js
highQualityBlockImageEnabled: false,
highQualityBlockImageScale: 1000
```

배율 범위:

- 최소: 200%
- 기본: 1000%
- 최대: 2000%

## 활성/비활성 조건

활성 조건:

```js
enabled &&
highQualityBlockImageEnabled
```

설정 탭의 `모든 항목 기본값으로 초기화` 버튼을 누르면 `highQualityBlockImageEnabled`는 `false`, `highQualityBlockImageScale`은 `1000`으로 정규화된다.

## UI

설정 탭의 `초고화질 이미지 저장하기` 항목에서 설정한다.

- 메인 체크박스: 기능 사용 여부
- range input: 200%~2000% 배율 조정, Entry 기본 슬라이더와 맞게 얇은 회색 트랙과 파란 세로 핸들 스타일 사용
- number input: 배율 직접 입력
- 1000% 이상일 때 `다운로드에 오래 걸릴 수 있습니다.` 안내를 검은색으로 표시

## 메시지 흐름

content script에서 Main World 주입 스크립트로 전달한다.

```js
sendToInject('SET_HIGH_QUALITY_BLOCK_IMAGE_ENABLED', {
  enabled: true,
  scale: 10,
  scalePercent: 1000
});
```

주입 스크립트 준비 이벤트:

```js
HIGH_QUALITY_BLOCK_IMAGE_READY
```

결과 이벤트:

```js
HIGH_QUALITY_BLOCK_IMAGE_RESULT
```

## 구현 방식

파일: `entry-debugger-extension/high-quality-block-image.js`

- `Entry.BlockView.prototype.getDataUrl()`을 패치한다.
- Entry 기본 우클릭 메뉴와 저장 흐름은 그대로 둔다.
- 저장 이미지 생성 중에만 board scale과 SVG bounding box 계산을 설정 배율 기준으로 보정한다.
- 저장이 끝나면 원래 board scale과 bounding rect 함수를 복원한다.

## 프로젝트 데이터 영향

- 프로젝트 JSON을 수정하지 않는다.
- 실제 코드판 확대/축소 상태를 바꾸지 않는다.
- 블록 구조, 파라미터, 오브젝트 데이터에 영향을 주지 않는다.
- 저장용 이미지 생성 계산에만 관여한다.

## 검증 포인트

- 기본값은 꺼짐이다.
- 설정 탭의 초기화 버튼을 누르면 기능과 배율이 기본값으로 돌아간다.
- 슬라이더와 숫자 입력이 같은 값을 표시한다.
- 200%보다 낮은 값은 200%로 정규화된다.
- 2000%보다 높은 값은 2000%로 정규화된다.
- 1000% 이상일 때 경고 문구가 검은색으로 표시된다.
- 블록 우클릭 `이미지로 저장하기`에 적용된다.
- 코드 배경 우클릭 전체 코드 이미지 저장에도 적용된다.
- 저장 후 Entry 작업공간의 실제 확대/축소 상태가 유지된다.

## 주의사항

- 큰 코드 묶음은 이미지 크기와 저장 시간이 크게 증가할 수 있다.
- 안정성 문제가 발견되면 설정 탭에서 기능만 끌 수 있어야 한다.
- `getDataUrl()` 패치는 UI-only 보조 기능이어야 하며 데이터 변환 기능으로 확장하지 않는다.
