# Entry Debugger 확장 프로그램 아이콘 생성 프롬프트

작성일: 2026-05-24  
대상 버전: Entry Debugger `2.0.0`  
사용 위치: Chrome 확장 프로그램 아이콘, Chrome 웹스토어 등록 이미지 후보

## 1. 아이콘 목표

Entry Debugger는 엔트리 만들기 화면에서 변수, 리스트, 신호, 장면, 함수 내부 사용 위치, 콘솔 로그를 빠르게 확인하고 조작하는 디버깅 보조 도구다.

아이콘은 다음 인상을 주어야 한다.

- 개발/디버깅 도구
- 엔트리 작품을 분석하고 관찰하는 느낌
- 변수와 신호를 다루는 느낌
- 작고 선명한 Chrome 확장 프로그램 아이콘
- 친근하지만 장난감처럼 가볍지 않은 작업 도구

주의:

- 엔트리 공식 로고를 직접 복제하지 않는다.
- 특정 회사/서비스의 상표처럼 보이는 형태를 피한다.
- 작은 크기에서도 알아볼 수 있도록 복잡한 디테일을 줄인다.
- 긴 텍스트는 넣지 않는다.
- `Entry Debugger` 전체 문구는 아이콘에 넣지 않는다.
- 배경 제거가 쉽도록 생성 단계에서는 투명 배경 대신 아이콘에 쓰이지 않는 단색 배경을 요청한다.

## 2. 반영할 색상 팔레트

아이콘 내부에는 아래 색상 팔레트를 중심으로 사용한다.

| 색상 | HEX | 권장 역할 |
|---|---|---|
| Green | `#32D27D` | 정상 상태, 실행, 확인, 활성 상태 |
| Blue | `#5096F5` | 메인 도구 색, 검사, 정보, 안정감 |
| Purple | `#6E5AE6` | 디버깅, 함수, 확장 기능, 고급 기능 |
| Yellow | `#FFC800` | 변수 값, 신호, 주목 포인트 |
| Red Orange | `#FA5536` | 오류, 경고, 브레이크포인트 느낌 |

색상 지침:

- 아이콘 내부의 핵심 색은 위 5색을 사용한다.
- 필요한 경우 흰색, 아주 어두운 남색/회색 같은 중립색을 소량 사용할 수 있다.
- 아이콘이 너무 무지개처럼 보이지 않도록 2~3개 색을 중심으로 쓰고, 나머지는 작은 포인트로만 사용한다.
- 배경 제거용 단색 배경은 위 팔레트 색을 절대 사용하지 않는다.
- 초록색 계열이 팔레트에 포함되어 있으므로 생성용 배경은 밝은 자홍색(`#FF00FF`)을 우선 사용한다.

## 3. 기본 생성 프롬프트

아래 프롬프트를 이미지 생성 AI에 그대로 입력한다.

```text
Create a clean Chrome extension icon for a tool named "Entry Debugger".

The icon should represent debugging, inspecting variables, and monitoring a visual coding project. Use an original symbol, not any official Entry logo. The main motif should combine a friendly debugging bug or magnifying glass with small code/variable nodes, signal dots, or a simplified block-coding interface cue.

Use this exact color palette inside the icon:
- Green #32D27D
- Blue #5096F5
- Purple #6E5AE6
- Yellow #FFC800
- Red orange #FA5536

Prefer blue #5096F5 and purple #6E5AE6 as the main tool/debugging colors. Use green #32D27D for active or success accents, yellow #FFC800 for variable/signal highlights, and red orange #FA5536 only as a small warning or breakpoint accent. Neutral white or very dark navy/gray may be used sparingly for contrast.

Make it simple, bold, and readable at very small sizes such as 48x48 and 128x128. Use a modern app-icon style with clear silhouette, strong contrast, rounded geometry, and a polished but not overly decorative look. The icon should feel like a practical developer tool for students and creators.

No long text. No full product name. Avoid tiny details. Avoid photorealism. Avoid copying existing brand logos. Centered composition, square canvas, high resolution.

Use a single flat solid-color background for easy background removal. The background color must not appear inside the icon itself and must not be one of the palette colors. Prefer bright magenta (#FF00FF) as the chroma-key background, and keep the icon edges clean and separated from the background.
```

## 4. 한국어 보조 프롬프트

한국어 입력이 더 잘 맞는 이미지 생성 AI에는 아래를 사용한다.

```text
"Entry Debugger"라는 Chrome 확장 프로그램 아이콘을 만들어줘.

이 확장 프로그램은 엔트리 만들기 화면에서 변수, 리스트, 신호, 장면, 함수 내부 사용 위치, 콘솔 로그를 확인하는 디버깅 도구야. 아이콘은 디버깅, 변수 관찰, 코드 흐름 분석의 느낌이 나야 해.

공식 엔트리 로고를 복제하지 말고, 독창적인 심볼로 만들어줘. 작은 디버깅 벌레, 돋보기, 코드 노드, 변수 점, 블록 코딩 인터페이스 느낌 중 일부를 조합해도 좋아.

아이콘 내부 색상은 아래 팔레트를 중심으로 사용해줘.

- 초록: #32D27D
- 파랑: #5096F5
- 보라: #6E5AE6
- 노랑: #FFC800
- 빨강/주황: #FA5536

메인 색은 파랑(#5096F5)과 보라(#6E5AE6)를 우선 사용해줘. 초록(#32D27D)은 실행/정상/활성 포인트, 노랑(#FFC800)은 변수 값이나 신호 포인트, 빨강/주황(#FA5536)은 오류/경고/브레이크포인트 같은 작은 포인트로만 사용해줘. 대비가 필요하면 흰색이나 아주 어두운 남색/회색 같은 중립색을 소량 사용해도 돼.

48x48과 128x128처럼 작은 크기에서도 선명해야 하므로 형태는 단순하고 실루엣은 강하게 만들어줘. 현대적인 앱 아이콘 스타일, 명확한 대비, 둥근 기하 형태, 실용적인 개발 도구 느낌을 원해.

긴 텍스트 금지. 제품명 전체 텍스트 금지. 너무 작은 디테일 금지. 포토리얼 금지. 기존 브랜드 로고 복제 금지. 중앙 정렬 구성, 정사각형 캔버스, 고해상도.

배경 제거가 쉽도록 투명 배경이 아니라 단색 배경으로 만들어줘. 배경색은 아이콘 내부 팔레트에 쓰이지 않는 색이어야 해. 초록색 계열은 아이콘에 사용되므로 배경은 밝은 자홍색(#FF00FF)을 우선 사용해줘. 아이콘 가장자리는 배경과 깔끔하게 분리되어야 해.
```

## 5. 추천 변형 프롬프트

### 5.1 돋보기 중심

```text
Design a minimal Chrome extension icon for "Entry Debugger" using a magnifying glass inspecting variable nodes and a small code block shape. Use the exact icon palette: #32D27D, #5096F5, #6E5AE6, #FFC800, #FA5536. Prefer #5096F5 and #6E5AE6 as the main colors, with #FFC800 and #32D27D as small node highlights and #FA5536 as a tiny warning accent. The icon should communicate inspection, debugging, and visual programming. Original design, no official Entry logo, no long text. Strong silhouette, modern rounded app icon, readable at 48x48. Use a single flat bright magenta #FF00FF chroma-key background that does not appear in the icon, for easy background removal.
```

### 5.2 디버깅 벌레 중심

```text
Design a friendly but professional debugging bug icon for a Chrome extension called "Entry Debugger". Use the exact icon palette: #32D27D, #5096F5, #6E5AE6, #FFC800, #FA5536. Prefer #6E5AE6 and #5096F5 for the bug/tool body, #32D27D for active status accents, #FFC800 for variable dots, and #FA5536 only as a tiny breakpoint or error accent. The bug should be stylized and simple, combined with tiny code brackets or variable dots to suggest debugging a block-coding project. Original symbol, not a brand logo. Bold shape, clear contrast, centered, readable at 48x48 and 128x128. Use a single flat bright magenta #FF00FF chroma-key background that does not appear in the icon, for easy background removal.
```

### 5.3 변수/신호 노드 중심

```text
Create a modern extension icon showing connected variable nodes, signal dots, and a small inspector cursor or lens. Use the exact icon palette: #32D27D, #5096F5, #6E5AE6, #FFC800, #FA5536. Use #5096F5 and #6E5AE6 for the main inspection symbol, #FFC800 for key variable nodes, #32D27D for active/success nodes, and #FA5536 for one small alert node. It should represent monitoring variables, lists, messages, and scenes in a visual coding project. Clean geometric style, strong contrast, original design, no official logos, no long text, square canvas, readable at small sizes. Use a single flat bright magenta #FF00FF chroma-key background that does not appear in the icon, for easy background removal.
```

### 5.4 블록 코딩 패널 중심

```text
Create a compact Chrome extension icon for a debugging panel inside a block-coding editor. Use the exact icon palette: #32D27D, #5096F5, #6E5AE6, #FFC800, #FA5536. Use #5096F5 and #6E5AE6 for the panel and inspector symbol, #FFC800 for a variable value highlight, #32D27D for a check/active accent, and #FA5536 for a tiny error marker. Show a simplified panel with one or two variable rows and a small check or magnifier symbol. The design should be abstract and original, not a screenshot. Modern tool icon, rounded shapes, high contrast, no long text, readable at 48x48. Use a single flat bright magenta #FF00FF chroma-key background that does not appear in the icon, for easy background removal.
```

## 6. 네거티브 프롬프트

이미지 생성 도구가 네거티브 프롬프트를 지원하면 함께 사용한다.

```text
official Entry logo, copied brand logo, trademark infringement, long text, tiny unreadable text, cluttered details, realistic screenshot, photorealistic, low contrast, overly complex, blurry, pixelated, noisy background, busy background, gradient background, patterned background, transparent background, colors outside the requested palette inside the icon, thin lines, small labels, mascot-only design, childish toy style
```

## 7. 산출물 요구 사항

이미지 생성 후 다음 조건으로 정리한다.

- 원본: 최소 `1024x1024` PNG
- 생성용 배경: 배경 제거가 쉬운 단색 배경
- 권장 배경색: 아이콘 내부 팔레트와 겹치지 않는 밝은 자홍색(`#FF00FF`)
- 아이콘 내부 팔레트: `#32D27D`, `#5096F5`, `#6E5AE6`, `#FFC800`, `#FA5536`
- 최종 적용 파일: 배경 제거 후 투명 PNG 권장
- 최종 확장 아이콘:
  - `icon128.png`: `128x128`
  - `icon48.png`: `48x48`
- 작은 크기 검수:
  - 48px에서 주 실루엣이 보이는가
  - 단색 배경과 아이콘 가장자리가 깔끔하게 구분되는가
  - 배경 제거 후 가장자리가 지저분하지 않은가
  - 텍스트 없이도 디버깅/검사 도구 느낌이 나는가
  - 공식 엔트리 로고처럼 오해되지 않는가

## 8. 추천 선택 기준

여러 시안이 나오면 아래 기준으로 고른다.

1. 48px에서 가장 잘 보이는가
2. 디버깅 도구라는 인상이 바로 오는가
3. 엔트리 공식 로고와 충분히 다른가
4. 너무 장난감 같지 않고 실제 도구처럼 보이는가
5. 지정 팔레트가 자연스럽게 반영되었는가
6. 웹스토어, 브라우저 툴바, 확장 관리 페이지에서 모두 어울리는가

## 9. 현재 확장 아이콘 파일

현재 확장 프로그램은 다음 파일을 사용한다.

- `entry-debugger-extension/icon48.png`
- `entry-debugger-extension/icon128.png`

새 아이콘을 적용할 때는 위 두 파일을 같은 크기의 PNG로 교체하면 된다.
