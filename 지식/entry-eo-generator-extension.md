# 다량 이미지 업로더 기록

확인 날짜: 2026-05-24

대상 기능: 여러 이미지 파일을 한 오브젝트의 모양으로 묶어 현재 Entry 작품에 바로 추가하거나, Entry가 가져올 수 있는 `.eo` 파일로 다운로드한다.

## 현재 운영 방식

- 독립 생성기 페이지를 새 탭으로 여는 방식은 사용하지 않는다.
- 확장프로그램 팝업에서는 `실험실 탭`만 켜고 끈다.
- `다량 이미지 업로더` 토글은 디버깅 패널의 `실험실` 탭 안에 있다.
- 실험실 탭이 꺼지면 업로더 설정도 함께 꺼진다.
- 기본값은 꺼짐이다.
- 토글을 켜면 디버깅 패널의 `실험실` 옆에 `업로더` 탭이 생긴다.
- 업로더 탭은 두 동작을 제공한다.
  - `엔트리에 추가`: 현재 열린 Entry 편집기에 오브젝트 모델을 직접 추가한다.
  - `.eo 다운로드`: 같은 모양 구성으로 tar.gz 패키지를 만들고 `.eo` 확장자로 저장한다.

## 독립 생성기 정리

`entry-debugger-extension/eo-generator/` 독립 페이지 폴더는 제거했다. 사용자에게 노출되는 경로는 디버깅 패널의 내장 `업로더` 탭뿐이며, 실제 생성 로직은 `entry-debugger-extension/eo-uploader.js`에 있다.

## 이미지 타입 규칙

- `picture.imageType`은 `png` 또는 `svg`만 사용한다.
- PNG/JPG/JPEG/GIF/WEBP 입력은 모두 PNG로 다시 인코딩한다.
- BMP는 입력 단계에서 거부한다.
- SVG는 `imageType: "svg"`와 `.svg` fileurl을 유지하되, Entry 표시용 PNG를 함께 만든다.

## `.eo` tar 구성

비트맵 picture:

- `object/{xx}/{yy}/image/{filename}.png`
- `object/{xx}/{yy}/thumb/{filename}.png`

SVG picture:

- `object/{xx}/{yy}/image/{filename}.svg`
- `object/{xx}/{yy}/image/{filename}.png`
- `object/{xx}/{yy}/thumb/{filename}.png`

`object.json`의 `fileurl`은 `temp/{xx}/{yy}/image/{filename}.png|svg` 형식이다.

## Entry 직접 추가

- `eo-uploader.js`가 이미지 파일을 data URL로 변환한다.
- `ADD_GENERATED_OBJECT` 메시지로 page world의 `inject.js`에 오브젝트 모델을 보낸다.
- `inject.js`는 현재 선택된 장면을 찾아 `Entry.container.addObject()` 또는 `addObjectFunc()`로 추가한다.

## 검증 체크리스트

- 실험실 탭 안의 `다량 이미지 업로더`는 기본 꺼짐이다.
- 토글을 켜면 디버깅 패널에 `업로더` 탭이 나타난다.
- BMP 드롭 시 거부 메시지가 표시된다.
- JPG/GIF/WEBP 입력도 `.eo` 내부에서는 PNG로 저장된다.
- SVG 입력은 SVG 원본, image PNG, thumb PNG 3개를 가진다.
- `entity.regX === width / 2`, `entity.regY === height / 2`다.
- 다운로드 파일명은 `.eo`로 끝난다.
- `엔트리에 추가` 후 현재 작품의 오브젝트 목록에 새 오브젝트가 생긴다.
