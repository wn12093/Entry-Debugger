/**
 * utils.js - UI와 다운로드에 쓰는 일반 유틸리티
 */

// 결과 파일명에 사용할 수 없는 문자를 제거합니다.
export function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'entry-object';
}

// 사람이 읽기 쉬운 파일 크기 문자열을 만듭니다.
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// chrome.downloads.download를 우선 사용하고, 실패하면 a[download]로 저장합니다.
export async function downloadBlob(blob, filename) {
  const safeFilename = /\.eo$/i.test(filename) ? filename : `${filename}.eo`;
  const typedBlob = blob.type === 'application/gzip'
    ? blob
    : new Blob([await blob.arrayBuffer()], { type: 'application/gzip' });
  const url = URL.createObjectURL(typedBlob);
  try {
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      await chrome.downloads.download({
        url,
        filename: safeFilename,
        conflictAction: 'uniquify',
        saveAs: true
      });
      return;
    }
  } catch (error) {
    // 사용자가 저장 대화상자를 취소한 경우도 있으므로 a[download] fallback을 시도합니다.
  } finally {
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
