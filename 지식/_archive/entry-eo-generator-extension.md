# 다량 이미지 업로더 기록

> 제거 상태: 2026-06-23 Entry Debugger에서 제거했다. 모양 탭 편의 기능이 엔트리의
> 파일 업로드 흐름에서 다량 이미지와 GIF 프레임 업로드를 지원해 역할이 중복됐기
> 때문이다. 아래 내용은 과거 구현 이력으로만 보존한다.

확인 날짜: 2026-05-24

대상 기능: 여러 이미지 파일을 한 오브젝트의 모양으로 묶어 Entry가 가져올 수 있는 `.eo` 파일로 다운로드한다.

## 현재 운영 방식

- 독립 생성기 페이지를 새 탭으로 여는 방식은 사용하지 않는다.
- 확장프로그램 팝업에서는 `실험실 탭`만 켜고 끈다.
- `다량 이미지 업로더` 토글은 디버깅 패널의 `실험실` 탭 안에 있다.
- 실험실 탭이 꺼지면 업로더 설정도 함께 꺼진다.
- 기본값은 꺼짐이다.
- 토글을 켜면 디버깅 패널의 `실험실` 옆에 `업로더` 탭이 생긴다.
- 업로더 탭은 `.eo 다운로드`만 제공한다.
- 다운로드한 `.eo` 파일은 엔트리의 `오브젝트 추가하기 > 파일 업로드`에서 업로드한다.
- 직접 추가 방식은 저장 가능한 자산 등록 흐름을 타지 않고 data URL을 프로젝트 JSON에 남겨 저장 실패를 만들 수 있어 제거했다.
- 선택한 이미지 총 용량 또는 생성된 `.eo` 파일 용량이 10MB를 넘으면 엔트리 업로드 실패 가능성 경고를 표시한다.

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

## 직접 추가 제거 기록

- 이전 구현은 이미지 파일을 data URL로 변환한 뒤 `Entry.container.addObject()`에 직접 넣었다.
- 이 방식은 화면에는 보이지만 저장 시 `fileurl`/`thumbUrl`에 data URL이 그대로 직렬화되어 저장 실패를 일으킬 수 있다.
- 현재 구현은 직접 추가 버튼과 `ADD_GENERATED_OBJECT` 메시지 처리를 제거하고 `.eo 다운로드`만 유지한다.

## 검증 체크리스트

- 실험실 탭 안의 `다량 이미지 업로더`는 기본 꺼짐이다.
- 토글을 켜면 디버깅 패널에 `업로더` 탭이 나타난다.
- BMP 드롭 시 거부 메시지가 표시된다.
- JPG/GIF/WEBP 입력도 `.eo` 내부에서는 PNG로 저장된다.
- SVG 입력은 SVG 원본, image PNG, thumb PNG 3개를 가진다.
- `entity.regX === width / 2`, `entity.regY === height / 2`다.
- 다운로드 파일명은 `.eo`로 끝난다.
- 다운로드한 `.eo`는 엔트리 `오브젝트 추가하기 > 파일 업로드`로 업로드할 수 있다.
- 10MB 초과 시 업로드 실패 가능성 경고가 표시된다.
