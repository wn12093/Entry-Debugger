# 다량 이미지 업로더 기록

확인 날짜: 2026-05-24

대상 기능: 여러 이미지 파일을 한 오브젝트의 모양으로 묶은 `.eo` 파일을 클라이언트에서 생성한다. 포맷의 단일 기준은 `C:\Users\young\prg\ENTRY\MYentry\docs\entry-reference\08-eo-format.md`다.

## 산출 위치

독립 설치용 폴더: `eo-generator/`

Entry Debugger 실험실 내장 폴더: `entry-debugger-extension/eo-generator/`

```text
eo-generator/
├── manifest.json
├── background.js
├── README.md
├── package.json
├── app/
│   ├── index.html
│   ├── app.css
│   ├── app.js
│   └── modules/
│       ├── constants.js
│       ├── eo-builder.js
│       ├── ids.js
│       ├── image-processing.js
│       ├── tar.js
│       └── utils.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 구현 요약

- MV3 확장으로 만들었고, 툴바 아이콘 클릭 시 `app/index.html`을 새 탭으로 연다.
- Entry Debugger 확장 안에도 같은 앱을 내장했다. 실험실 탭의 `다량 이미지 업로더` 버튼을 누르면 `chrome.runtime.getURL('eo-generator/index.html')`을 새 탭으로 연다.
- 입력 포맷은 PNG, JPG, BMP, SVG다.
- 모든 처리는 브라우저 안에서 수행하며 외부 서버 통신은 없다.
- gzip 압축은 Chrome 내장 `CompressionStream('gzip')`을 사용한다.
- tar는 직접 구현했다. `object/` 디렉터리 엔트리와 각 partition 디렉터리 엔트리를 포함한다.
- 결과 파일명은 `<오브젝트명>.eo`이며 Windows 파일명 금지 문자를 `_`로 치환한다.
- JS는 기능별 ES module로 분리했다. `app.js`는 UI 진입점만 맡고, `.eo` 포맷 생성은 `modules/eo-builder.js`, tar는 `modules/tar.js`, 이미지 처리는 `modules/image-processing.js`에서 담당한다.

## 08-eo-format.md 대응

| 섹션 | 구현 |
| --- | --- |
| §1 | `modules/tar.js`의 `buildTarBlob()`, `makeTarHeader()`, `modules/eo-builder.js`의 `gzipBlob()` |
| §2 | `modules/eo-builder.js`의 `buildTarEntries()`, `partitionPath()` |
| §3 | `modules/eo-builder.js`의 `buildObjectJson()`, `buildPictureJson()`, `buildEntityJson()` |
| §4 | `modules/ids.js`의 `uniqueFileId()`, `uniqueShortId()` |
| §5 | `modules/image-processing.js`의 `thumbSize()`, `makeThumbBlob()` |
| §6 | `fileurl: temp/{xx}/{yy}/image/{filename}.{ext}` |
| §7 | `autoScale()`로 첫 번째 모양 긴 변 기준 `200 / max(w, h)` 계산 |
| §8 | selected picture 기준 `entity.width/height/regX/regY` 설정 |
| §9 | `getImageType()`으로 지원 이미지 판별 |

## 주의 사항

- §7에 따라 `.eo` 내부의 `dimension.scaleX/scaleY`와 `entity.scaleX/scaleY`는 모든 모양이 같은 값을 사용한다.
- SVG 썸네일은 확장자 보존을 우선해 원본을 thumb에도 복사한다. PNG/JPG/BMP는 긴 변 96px 썸네일을 생성하며, BMP는 24-bit BMP로 직접 인코딩한다.
- 원본 합산 10MB 초과와 개별 이미지 1MB 초과는 차단하지 않고 경고한다.
- 사운드, 블록 스크립트, 변수, 신호, 함수, 여러 오브젝트 생성은 범위 밖으로 두었다.

## 검증

정적 검증:

```powershell
node --check "Entry Debugger/eo-generator/app/app.js"
node --check "Entry Debugger/eo-generator/app/modules/eo-builder.js"
node --check "Entry Debugger/eo-generator/background.js"
Get-Content -Raw -Encoding UTF8 "Entry Debugger/eo-generator/manifest.json" | ConvertFrom-Json
```

생성 파일 검증:

```powershell
tar -tvf "생성된파일.eo"
```

확인해야 할 핵심 경로:

```text
object/
object/object.json
object/{xx}/{yy}/image/{filename}.{ext}
object/{xx}/{yy}/thumb/{filename}.{ext}
```
