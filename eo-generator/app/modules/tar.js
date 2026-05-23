/**
 * tar.js - 08-eo-format.md §1 POSIX tar 생성기
 */

import {
  DIR_MODE,
  FILE_MODE,
  TAR_BLOCK_SIZE
} from './constants.js';

const encoder = new TextEncoder();

// §1 POSIX tar Blob을 직접 생성합니다. 디렉터리 모드 0755, 파일 모드 0644.
export function buildTarBlob(entries) {
  const chunks = [];
  entries.forEach(function (entry) {
    const bytes = entry.bytes || new Uint8Array(0);
    chunks.push(makeTarHeader(entry.path, bytes.length, entry.type));
    if (bytes.length) {
      chunks.push(bytes);
      chunks.push(new Uint8Array(paddingSize(bytes.length)));
    }
  });
  chunks.push(new Uint8Array(TAR_BLOCK_SIZE * 2));
  return new Blob(chunks, { type: 'application/x-tar' });
}

// tar 파일명 길이와 헤더 필드를 채워 512바이트 헤더를 만듭니다.
function makeTarHeader(path, size, type) {
  const pathBytes = encoder.encode(path);
  if (pathBytes.length > 100) {
    throw new Error(`tar 경로가 너무 깁니다: ${path}`);
  }

  const header = new Uint8Array(TAR_BLOCK_SIZE);
  writeText(header, 0, 100, path);
  writeOctal(header, 100, 8, type === 'directory' ? DIR_MODE : FILE_MODE);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === 'directory' ? 0 : size);
  writeOctal(header, 136, 12, 0);
  fillBytes(header, 148, 8, 32);
  header[156] = type === 'directory' ? 53 : 48;
  writeText(header, 257, 6, 'ustar');
  writeText(header, 263, 2, '00');

  const checksum = header.reduce(function (sum, byte) {
    return sum + byte;
  }, 0);
  writeChecksum(header, checksum);
  return header;
}

// tar 헤더의 텍스트 필드를 ASCII/UTF-8 바이트로 씁니다.
function writeText(buffer, offset, length, text) {
  const bytes = encoder.encode(text);
  buffer.set(bytes.slice(0, length), offset);
}

// tar 헤더의 octal 숫자 필드를 씁니다.
function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0');
  writeText(buffer, offset, length - 1, text);
  buffer[offset + length - 1] = 0;
}

// tar checksum 필드는 6자리 octal + null + space 형식입니다.
function writeChecksum(buffer, checksum) {
  const text = checksum.toString(8).padStart(6, '0');
  writeText(buffer, 148, 6, text);
  buffer[154] = 0;
  buffer[155] = 32;
}

// 지정 범위를 같은 바이트로 채웁니다.
function fillBytes(buffer, offset, length, value) {
  for (let i = 0; i < length; i += 1) {
    buffer[offset + i] = value;
  }
}

// tar 파일 데이터가 512바이트 경계에 맞도록 padding 크기를 구합니다.
function paddingSize(size) {
  return (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
}
