# Entry .eo 내장 생성기 정정 사항

## 운영 방침

- 독립 HTML 생성기는 제거하고 사용자 경로에 연결하지 않는다.
- 디버깅 패널 안의 `업로더` 탭만 유지한다.
- 업로더 UI/이미지 처리/.eo 생성 로직은 `entry-debugger-extension/eo-uploader.js`에서 관리한다.
- 실험실 탭 안의 `다량 이미지 업로더` 토글이 켜져 있을 때만 탭을 표시한다.
- 실험실 탭이 비활성화되면 업로더도 비활성화한다.
- 생성기는 `.eo 다운로드`만 제공한다.
- 다운로드한 `.eo` 파일은 엔트리의 `오브젝트 추가하기 > 파일 업로드`에서 업로드한다.
- 과거의 직접 추가 방식은 data URL을 프로젝트 JSON에 남겨 저장 실패를 만들 수 있어 제거했다.
- 선택 이미지 총 용량 또는 생성된 `.eo` 파일이 10MB를 넘으면 엔트리 업로드가 실패할 수 있으므로 경고를 표시한다.

## 이미지 타입 규칙

`picture.imageType`은 `png`와 `svg`만 사용한다.

- PNG/JPG/JPEG/GIF/WEBP 입력은 모두 PNG로 다시 인코딩한다.
- 비트맵 picture의 `fileurl` 확장자는 항상 `.png`다.
- BMP는 입력 단계에서 거부한다.
- SVG picture의 `imageType`은 `svg`, `fileurl`은 `.svg`를 유지한다.

## tar 파일 구성

비트맵 picture는 파일 2개를 넣는다.

- `object/{xx}/{yy}/image/{filename}.png`
- `object/{xx}/{yy}/thumb/{filename}.png`

SVG picture는 파일 3개를 넣는다.

- `object/{xx}/{yy}/image/{filename}.svg`
- `object/{xx}/{yy}/image/{filename}.png`
- `object/{xx}/{yy}/thumb/{filename}.png`

JSON의 `fileurl`은 Entry 표본처럼 `temp/{xx}/{yy}/image/{filename}.ext` 형식을 사용한다.

## 중심점

`entity.regX`와 `entity.regY`는 소수점을 유지한다.

```js
regX = width / 2;
regY = height / 2;
```

`Math.floor`, `Math.round`를 적용하지 않는다.

## 썸네일

`thumb/` 아래 파일은 항상 PNG다. SVG 썸네일은 만들지 않는다.

썸네일 크기는 긴 변 96px 기준으로 비율을 유지한다.

## 다운로드 확장자

`.eo`는 내부적으로 gzip 압축 tar이지만, 브라우저 다운로드에서는 `.gz`로 저장되면 안 된다.

- Blob MIME은 `application/octet-stream`으로 둔다.
- `<a download="{name}.eo">`를 명시한다.
- 혹시 `.gz`가 붙은 이름이 들어오면 `.eo`로 바꾼다.

## 검증 체크리스트

- 모든 `pictures[].imageType`이 `png` 또는 `svg`다.
- JPG/JPEG/GIF/WEBP 입력도 object.json에서는 `imageType: "png"`다.
- 비트맵 picture는 image PNG 1개와 thumb PNG 1개만 가진다.
- SVG picture는 SVG 원본, image PNG, thumb PNG 3개를 가진다.
- `thumb/` 아래 확장자는 모두 `.png`다.
- `entity.regX === entity.width / 2`다.
- `entity.regY === entity.height / 2`다.
- BMP 입력은 생성 전에 거부된다.
- 다운로드 파일명이 `.eo`로 끝난다.
- 10MB 초과 시 업로드 실패 가능성 경고가 표시된다.
