/**
 * app.js - 다량 이미지 업로더 UI 진입점
 *
 * 08-eo-format.md를 단일 진실로 사용합니다. 포맷과 패키징 로직은
 * app/modules/ 아래 모듈에 분리되어 있습니다.
 */

import {
  MAX_TOTAL_BYTES,
  STAGE_TARGET_LONG_EDGE,
  WARN_IMAGE_BYTES
} from './modules/constants.js';
import {
  isSupportedImageFile,
  processImageFile
} from './modules/image-processing.js';
import {
  uniqueFileId,
  uniqueShortId
} from './modules/ids.js';
import { buildEoBlob } from './modules/eo-builder.js';
import {
  downloadBlob,
  formatBytes,
  sanitizeFileName
} from './modules/utils.js';

const state = {
  items: [],
  selectedItemId: null,
  scaleOverride: null,
  draggedItemId: null
};

const usedPictureIds = new Set();
const usedFileIds = new Set();

const els = {
  objectName: document.getElementById('object-name'),
  fileInput: document.getElementById('file-input'),
  dropzone: document.getElementById('dropzone'),
  progressArea: document.getElementById('progress-area'),
  progressText: document.getElementById('progress-text'),
  progressCount: document.getElementById('progress-count'),
  progressFill: document.getElementById('progress-fill'),
  statusBox: document.getElementById('status-box'),
  scaleSlider: document.getElementById('scale-slider'),
  scaleOutput: document.getElementById('scale-output'),
  scaleAutoButton: document.getElementById('scale-auto-button'),
  scaleHelp: document.getElementById('scale-help'),
  summaryCount: document.getElementById('summary-count'),
  summarySize: document.getElementById('summary-size'),
  summarySelected: document.getElementById('summary-selected'),
  emptyState: document.getElementById('empty-state'),
  shapeList: document.getElementById('shape-list'),
  generateButton: document.getElementById('generate-button'),
  clearButton: document.getElementById('clear-button')
};

bindEvents();
render();

// UI 이벤트를 한 곳에서 연결합니다.
function bindEvents() {
  els.fileInput.addEventListener('change', function () {
    handleFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  els.dropzone.addEventListener('dragover', function (event) {
    event.preventDefault();
    els.dropzone.classList.add('drag-over');
  });

  els.dropzone.addEventListener('dragleave', function () {
    els.dropzone.classList.remove('drag-over');
  });

  els.dropzone.addEventListener('drop', function (event) {
    event.preventDefault();
    els.dropzone.classList.remove('drag-over');
    handleFiles(event.dataTransfer.files);
  });

  els.scaleSlider.addEventListener('input', function () {
    state.scaleOverride = Number(els.scaleSlider.value);
    renderScaleControls();
    renderList();
  });

  els.scaleAutoButton.addEventListener('click', function () {
    state.scaleOverride = null;
    renderScaleControls();
    renderList();
  });

  els.generateButton.addEventListener('click', handleGenerate);
  els.clearButton.addEventListener('click', clearAll);
}

// 선택된 파일 묶음을 순차 처리하고 진행률을 표시합니다.
async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  const supported = files.filter(isSupportedImageFile);
  const rejectedCount = files.length - supported.length;

  if (!supported.length) {
    showStatus(rejectedCount ? '지원하지 않는 파일 형식입니다. PNG, JPG, BMP, SVG만 사용할 수 있습니다.' : '선택한 파일이 없습니다.', 'error');
    return;
  }

  showProgress('이미지 디코딩 및 썸네일 생성 중...', 0, supported.length);

  const failures = [];
  for (let i = 0; i < supported.length; i += 1) {
    const file = supported[i];
    try {
      const item = await processImageFile(file, {
        id: uniqueShortId(usedPictureIds),
        fileId: uniqueFileId(usedFileIds)
      });
      state.items.push(item);
      if (!state.selectedItemId) {
        state.selectedItemId = item.id;
      }
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
    showProgress('이미지 디코딩 및 썸네일 생성 중...', i + 1, supported.length);
  }

  hideProgress();
  render();

  if (failures.length) {
    showStatus(`처리하지 못한 이미지가 있습니다.\n${failures.join('\n')}`, 'warning');
  } else if (rejectedCount) {
    showStatus(`${rejectedCount}개 파일은 지원하지 않는 형식이라 제외했습니다.`, 'warning');
  }
}

// 전체 화면을 현재 상태 기준으로 다시 그립니다.
function render() {
  ensureSelectedItem();
  renderScaleControls();
  renderSummary();
  renderList();
  renderValidationStatus();
}

// 삭제나 초기화 뒤 selectedPictureId가 비지 않도록 보정합니다.
function ensureSelectedItem() {
  if (!state.items.length) {
    state.selectedItemId = null;
    return;
  }
  if (!state.items.some(function (item) { return item.id === state.selectedItemId; })) {
    state.selectedItemId = state.items[0].id;
  }
}

// §7 자동 scale: 첫 번째 picture의 긴 변을 200px로 맞춥니다.
function autoScale() {
  const first = state.items[0];
  if (!first) return 1;
  return STAGE_TARGET_LONG_EDGE / Math.max(first.width, first.height);
}

// 현재 저장할 공통 표시 배율을 반환합니다.
function currentScale() {
  return state.scaleOverride || autoScale();
}

// scale 슬라이더와 자동값 설명을 갱신합니다.
function renderScaleControls() {
  const scale = currentScale();
  const max = Math.max(10, Math.ceil(scale * 2));
  els.scaleSlider.max = String(max);
  els.scaleSlider.value = String(scale);
  els.scaleOutput.textContent = scale.toFixed(3);
  els.scaleAutoButton.disabled = state.scaleOverride === null;
  els.scaleHelp.textContent = state.scaleOverride === null
    ? `자동값 사용 중: 첫 번째 모양 기준 ${autoScale().toFixed(3)}`
    : `사용자 지정 배율 사용 중: ${scale.toFixed(3)}`;
}

// 모양 수, 합산 크기, 기본 모양 이름을 요약합니다.
function renderSummary() {
  const total = totalOriginalBytes();
  const selected = state.items.find(function (item) {
    return item.id === state.selectedItemId;
  });

  els.summaryCount.textContent = String(state.items.length);
  els.summarySize.textContent = formatBytes(total);
  els.summarySelected.textContent = selected ? selected.name : '없음';
  els.generateButton.disabled = state.items.length === 0;
}

// 현재 원본 이미지 합산 크기를 계산합니다.
function totalOriginalBytes() {
  return state.items.reduce(function (sum, item) {
    return sum + item.bytes;
  }, 0);
}

// 모양 카드 목록을 렌더링합니다.
function renderList() {
  els.emptyState.hidden = state.items.length > 0;
  els.shapeList.replaceChildren();

  state.items.forEach(function (item, index) {
    els.shapeList.appendChild(createShapeCard(item, index));
  });
}

// 한 모양 카드 DOM을 생성합니다.
function createShapeCard(item, index) {
  const card = document.createElement('article');
  card.className = 'shape-card';
  card.draggable = true;
  card.dataset.id = item.id;

  card.addEventListener('dragstart', function () {
    state.draggedItemId = item.id;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', function () {
    state.draggedItemId = null;
    card.classList.remove('dragging');
  });
  card.addEventListener('dragover', function (event) {
    event.preventDefault();
  });
  card.addEventListener('drop', function (event) {
    event.preventDefault();
    reorderItem(state.draggedItemId, item.id);
  });

  const handle = document.createElement('button');
  handle.className = 'drag-handle';
  handle.type = 'button';
  handle.title = '드래그해서 순서 변경';
  handle.textContent = '⋮⋮';

  const thumb = document.createElement('div');
  thumb.className = 'thumb-box';
  const img = document.createElement('img');
  img.alt = `${item.name} 썸네일`;
  img.src = item.thumbUrl;
  thumb.appendChild(img);

  const main = document.createElement('div');
  main.className = 'shape-main';
  main.appendChild(createNameRow(item));
  main.appendChild(createMetaList(item, index));

  const actions = document.createElement('div');
  actions.className = 'shape-actions';
  actions.appendChild(createDefaultChoice(item));
  actions.appendChild(createDeleteButton(item));

  card.append(handle, thumb, main, actions);
  return card;
}

// 모양 이름 편집 행을 생성합니다.
function createNameRow(item) {
  const row = document.createElement('label');
  row.className = 'shape-title-row';

  const label = document.createElement('span');
  label.textContent = '모양 이름';

  const input = document.createElement('input');
  input.className = 'shape-name-input';
  input.type = 'text';
  input.value = item.name;
  input.maxLength = 80;
  input.addEventListener('input', function () {
    item.name = input.value;
    renderSummary();
  });

  row.append(label, input);
  return row;
}

// 카드의 원본 크기, 파일 크기, 타입, 공통 배율 정보를 표시합니다.
function createMetaList(item, index) {
  const wrap = document.createElement('div');
  wrap.className = 'meta-list';

  const metas = [
    `${index + 1}번째`,
    `${item.width} x ${item.height}px`,
    item.imageType.toUpperCase(),
    formatBytes(item.bytes),
    `배율 ${currentScale().toFixed(3)}`
  ];

  if (item.bytes > WARN_IMAGE_BYTES) {
    metas.push('1MB 초과');
  }

  metas.forEach(function (text) {
    const pill = document.createElement('span');
    pill.className = 'meta-pill';
    pill.textContent = text;
    wrap.appendChild(pill);
  });
  return wrap;
}

// selectedPictureId를 지정하는 라디오 버튼을 생성합니다.
function createDefaultChoice(item) {
  const label = document.createElement('label');
  label.className = 'default-choice';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'selected-picture';
  input.checked = item.id === state.selectedItemId;
  input.addEventListener('change', function () {
    state.selectedItemId = item.id;
    renderSummary();
  });

  const text = document.createElement('span');
  text.textContent = '기본 모양';

  label.append(input, text);
  return label;
}

// 모양 삭제 버튼을 생성합니다.
function createDeleteButton(item) {
  const button = document.createElement('button');
  button.className = 'danger-button';
  button.type = 'button';
  button.textContent = '삭제';
  button.addEventListener('click', function () {
    removeItem(item.id);
  });
  return button;
}

// 드래그 앤 드롭으로 모양 순서를 변경합니다.
function reorderItem(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;

  const fromIndex = state.items.findIndex(function (item) { return item.id === fromId; });
  const toIndex = state.items.findIndex(function (item) { return item.id === toId; });
  if (fromIndex < 0 || toIndex < 0) return;

  const moved = state.items.splice(fromIndex, 1)[0];
  state.items.splice(toIndex, 0, moved);
  render();
}

// 모양 하나를 제거하고 썸네일 URL도 해제합니다.
function removeItem(id) {
  const index = state.items.findIndex(function (item) { return item.id === id; });
  if (index < 0) return;

  const item = state.items[index];
  URL.revokeObjectURL(item.thumbUrl);
  state.items.splice(index, 1);
  render();
}

// 전체 입력 상태를 초기화합니다.
function clearAll() {
  state.items.forEach(function (item) {
    URL.revokeObjectURL(item.thumbUrl);
  });
  state.items = [];
  state.selectedItemId = null;
  state.scaleOverride = null;
  usedPictureIds.clear();
  usedFileIds.clear();
  els.objectName.value = '';
  hideProgress();
  hideStatus();
  render();
}

// 현재 검증 경고를 표시합니다.
function renderValidationStatus() {
  const warnings = [];
  if (totalOriginalBytes() > MAX_TOTAL_BYTES) {
    warnings.push(`원본 합산 크기가 ${formatBytes(MAX_TOTAL_BYTES)}를 넘었습니다. 엔트리 업로드 제한에 걸릴 수 있습니다.`);
  }

  const largeCount = state.items.filter(function (item) {
    return item.bytes > WARN_IMAGE_BYTES;
  }).length;
  if (largeCount) {
    warnings.push(`${largeCount}개 이미지가 개별 권장 크기 ${formatBytes(WARN_IMAGE_BYTES)}를 초과했습니다.`);
  }

  if (warnings.length) {
    showStatus(warnings.join('\n'), 'warning');
  } else if (!els.statusBox.classList.contains('success')) {
    hideStatus();
  }
}

// 생성 버튼 클릭 시 .eo Blob을 만들고 다운로드합니다.
async function handleGenerate() {
  const objectName = els.objectName.value.trim();
  if (!objectName) {
    showStatus('오브젝트 이름을 입력하세요.', 'error');
    els.objectName.focus();
    return;
  }
  if (!state.items.length) {
    showStatus('이미지를 한 장 이상 추가하세요.', 'error');
    return;
  }
  if (state.items.some(function (item) { return !item.name.trim(); })) {
    showStatus('비어 있는 모양 이름이 있습니다.', 'error');
    return;
  }

  try {
    showProgress('.eo 파일 생성 중...', 0, 3);
    const scale = currentScale();
    showProgress('tar 패키지 및 gzip 압축 중...', 1, 3);
    const eoBlob = await buildEoBlob(objectName, state.items, state.selectedItemId, scale);
    showProgress('다운로드 준비 중...', 3, 3);

    const filename = `${sanitizeFileName(objectName)}.eo`;
    await downloadBlob(eoBlob, filename);
    hideProgress();

    const limitNote = eoBlob.size > MAX_TOTAL_BYTES
      ? `\n결과 파일 크기가 ${formatBytes(MAX_TOTAL_BYTES)}를 넘었습니다. 엔트리 업로드가 거부될 수 있습니다.`
      : '';
    showStatus(`${filename} 생성 완료 (${formatBytes(eoBlob.size)})${limitNote}`, eoBlob.size > MAX_TOTAL_BYTES ? 'warning' : 'success');
  } catch (error) {
    hideProgress();
    showStatus(error.message || String(error), 'error');
  }
}

// 진행률 표시줄을 갱신합니다.
function showProgress(text, current, total) {
  const ratio = total ? current / total : 0;
  els.progressArea.hidden = false;
  els.progressText.textContent = text;
  els.progressCount.textContent = `${Math.round(ratio * 100)}%`;
  els.progressFill.style.width = `${Math.round(ratio * 100)}%`;
}

// 진행률 표시줄을 숨깁니다.
function hideProgress() {
  els.progressArea.hidden = true;
  els.progressFill.style.width = '0%';
  els.progressCount.textContent = '0%';
}

// 상태 메시지를 표시합니다.
function showStatus(message, type) {
  els.statusBox.hidden = false;
  els.statusBox.className = `status-box ${type || 'info'}`;
  els.statusBox.textContent = message;
}

// 상태 메시지를 숨깁니다.
function hideStatus() {
  els.statusBox.hidden = true;
  els.statusBox.className = 'status-box';
  els.statusBox.textContent = '';
}
