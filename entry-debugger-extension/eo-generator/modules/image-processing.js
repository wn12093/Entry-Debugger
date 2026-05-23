/**
 * image-processing.js - 이미지 디코딩과 썸네일 생성
 */

import {
  IMAGE_TYPES,
  THUMBNAIL_LONG_EDGE
} from './constants.js';

// §9 입력 이미지 확장자와 MIME을 검사합니다.
export function isSupportedImageFile(file) {
  return Boolean(getImageType(file));
}

// §9 Entry가 받는 imageType 값을 파일명/MIME에서 결정합니다.
export function getImageType(file) {
  const ext = getExtension(file.name);
  if (IMAGE_TYPES.has(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }

  for (const [key, mime] of IMAGE_TYPES.entries()) {
    if (file.type === mime) {
      return key === 'jpeg' ? 'jpg' : key;
    }
  }
  if (file.type === 'image/x-ms-bmp') {
    return 'bmp';
  }
  return '';
}

// 한 이미지 파일에서 원본 바이트, 크기, 썸네일 바이트를 준비합니다.
export async function processImageFile(file, ids) {
  const imageType = getImageType(file);
  if (!imageType) {
    throw new Error('지원하지 않는 이미지 형식');
  }

  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const decoded = await decodeImage(file, imageType);
  if (!decoded.width || !decoded.height) {
    decoded.dispose();
    throw new Error('이미지 크기를 읽을 수 없음');
  }

  const thumbBlob = await makeThumbBlob(decoded, file, imageType);
  decoded.dispose();

  return {
    id: ids.id,
    fileId: ids.fileId,
    file,
    imageType,
    originalBytes,
    thumbBytes: new Uint8Array(await thumbBlob.arrayBuffer()),
    thumbUrl: URL.createObjectURL(thumbBlob),
    name: nameWithoutExtension(file.name),
    width: decoded.width,
    height: decoded.height,
    bytes: file.size
  };
}

// 파일명에서 마지막 확장자를 소문자로 뽑습니다.
function getExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

// 확장자를 제거해 기본 모양 이름을 만듭니다.
function nameWithoutExtension(name) {
  return String(name || '모양').replace(/\.[^.]+$/, '') || '모양';
}

// 이미지 디코딩은 createImageBitmap을 우선 사용하고, 실패 시 <img>로 대체합니다.
async function decodeImage(file, imageType) {
  if (imageType !== 'svg' && 'createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: function () {
          bitmap.close();
        }
      };
    } catch (error) {
      // 일부 브라우저 빌드에서는 createImageBitmap이 실패할 수 있어 <img>로 재시도합니다.
    }
  }

  const image = await loadImageElement(file);
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    dispose: function () {
      URL.revokeObjectURL(image.dataset.objectUrl);
    }
  };
}

// <img> 로딩을 Promise로 감싸 디코딩 실패를 명확히 표시합니다.
function loadImageElement(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = function () {
      image.dataset.objectUrl = url;
      resolve(image);
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 디코딩할 수 없음'));
    };
    image.src = url;
  });
}

// §5 썸네일 규칙: 긴 변 96px, 원본 비율 유지.
export function thumbSize(width, height) {
  if (width >= height) {
    return {
      width: THUMBNAIL_LONG_EDGE,
      height: Math.round(height * THUMBNAIL_LONG_EDGE / width)
    };
  }
  return {
    width: Math.round(width * THUMBNAIL_LONG_EDGE / height),
    height: THUMBNAIL_LONG_EDGE
  };
}

// §5, §9: 가능하면 원본과 같은 포맷으로 96px 썸네일을 만들고, SVG는 포맷 보존을 위해 원본을 복사합니다.
async function makeThumbBlob(decoded, file, imageType) {
  if (imageType === 'svg') {
    return file.slice(0, file.size, file.type || IMAGE_TYPES.get(imageType));
  }

  const size = thumbSize(decoded.width, decoded.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, size.width);
  canvas.height = Math.max(1, size.height);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

  if (imageType === 'bmp') {
    return canvasToBmpBlob(canvas);
  }

  const mime = IMAGE_TYPES.get(imageType) || 'image/png';
  return canvasToBlob(canvas, mime);
}

// BMP 썸네일은 canvas가 직접 내보내지 못할 수 있어 24-bit BMP로 직접 인코딩합니다.
function canvasToBmpBlob(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const width = canvas.width;
  const height = canvas.height;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowStride * height;
  const fileSize = 54 + pixelSize;
  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * 4;
      const target = 54 + y * rowStride + x * 3;
      bytes[target] = imageData.data[source + 2];
      bytes[target + 1] = imageData.data[source + 1];
      bytes[target + 2] = imageData.data[source];
    }
  }

  return new Blob([bytes], { type: 'image/bmp' });
}

// canvas.toBlob을 Promise로 바꿔 썸네일 생성 실패를 잡습니다.
function canvasToBlob(canvas, mime) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (!blob) {
        reject(new Error('썸네일 생성 실패'));
        return;
      }
      resolve(blob);
    }, mime, 0.9);
  });
}
