# 다량 이미지 업로더

여러 개의 모양이 포함된 Entry `.eo` 파일을 생성하는 Chrome MV3 확장 프로그램입니다. 모든 처리는 브라우저 안에서만 실행되며 외부 서버 통신은 없습니다.

## 설치 방법

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 폴더를 선택합니다.

```text
C:\Users\young\prg\html\엔트리확프\Entry Debugger\eo-generator
```

## 사용 방법

1. 툴바의 확장 아이콘을 누르면 생성기 탭이 열립니다.
2. `오브젝트 이름`을 입력합니다.
3. PNG, JPG, BMP, SVG 이미지를 드래그하거나 파일 선택으로 추가합니다.
4. 각 모양 이름을 수정하고, 카드 드래그로 순서를 바꿉니다.
5. 라디오 버튼으로 기본 모양을 선택합니다.
6. 필요하면 표시 배율 슬라이더를 조정합니다.
7. `.eo 생성`을 누르고 저장합니다.
8. Entry에서 `오브젝트 추가하기 -> 파일 올리기`로 생성된 `.eo`를 업로드합니다.

## 검증 방법

Windows에서 `tar`가 gzip을 직접 읽을 수 있으면 다음 명령으로 구조를 확인할 수 있습니다.

```powershell
tar -tvf "생성된파일.eo"
```

문서 기준 구조는 다음과 같아야 합니다.

```text
object/
object/object.json
object/{filename[0:2]}/{filename[2:4]}/image/{filename}.{ext}
object/{filename[0:2]}/{filename[2:4]}/thumb/{filename}.{ext}
```

Entry 엔진 검증:

1. `https://playentry.org/ws/`에서 새 작품을 엽니다.
2. `오브젝트 추가하기 -> 파일`을 선택합니다.
3. 생성한 `.eo`를 업로드합니다.
4. 모든 모양이 모양 패널에 나타나는지 확인합니다.

## 주요 함수와 08-eo-format.md 대응

| 함수 | 구현 내용 |
| --- | --- |
| `app/modules/tar.js`의 `buildTarBlob()` | §1 POSIX tar 생성, 디렉터리 엔트리 포함, mode 0755/0644 |
| `app/modules/eo-builder.js`의 `buildTarEntries()` | §2 `object/` 디렉터리 구조와 image/thumb 경로 구성 |
| `app/modules/eo-builder.js`의 `buildObjectJson()` | §3 최상위 `object.json` 스키마 생성 |
| `app/modules/ids.js`의 `uniqueFileId()`, `uniqueShortId()` | §4 32자 filename과 4자 id 생성 |
| `app/modules/image-processing.js`의 `thumbSize()` | §5 긴 변 96px 썸네일 규칙 |
| `app/modules/eo-builder.js`의 `buildPictureJson()` | §6 `temp/{xx}/{yy}/image/...` fileurl 구성 |
| `app/app.js`의 `autoScale()` | §7 첫 번째 picture 긴 변 기준 `200 / max(w, h)` 계산 |
| `app/modules/eo-builder.js`의 `buildEntityJson()` | §8 selectedPictureId 기준 `entity.width/height/regX/regY` 설정 |
| `app/modules/image-processing.js`의 `getImageType()` | §9 지원 이미지 포맷 판별 |

## JS 모듈 구조

```text
app/app.js                         UI 진입점
app/modules/constants.js           상수
app/modules/ids.js                 Entry ID 생성
app/modules/image-processing.js    이미지 디코딩/썸네일
app/modules/tar.js                 POSIX tar 생성
app/modules/eo-builder.js          object.json, tar entry, gzip 생성
app/modules/utils.js               다운로드/파일명/표시 유틸
```

## 제한과 주의

- 원본 합산 크기 10MB 초과, 개별 이미지 1MB 초과는 경고만 표시합니다.
- `.eo` gzip 압축은 Chrome의 `CompressionStream('gzip')`을 사용하고, 다운로드 Blob 타입은 `application/gzip`으로 지정합니다.
- §7 규칙에 따라 생성되는 `.eo`의 `scaleX/scaleY`는 모든 모양에 같은 값으로 저장됩니다.
- 사운드, 블록 스크립트, 변수, 신호, 함수, 여러 오브젝트 생성은 포함하지 않습니다.
