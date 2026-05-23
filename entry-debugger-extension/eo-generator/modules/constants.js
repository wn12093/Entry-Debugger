/**
 * constants.js - .eo 생성기 전역 상수
 */

export const THUMBNAIL_LONG_EDGE = 96;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const WARN_IMAGE_BYTES = 1 * 1024 * 1024;
export const STAGE_TARGET_LONG_EDGE = 200;

export const TAR_BLOCK_SIZE = 512;
export const DIR_MODE = 0o755;
export const FILE_MODE = 0o644;

export const FILE_ID_LENGTH = 32;
export const SHORT_ID_LENGTH = 4;
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const IMAGE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['bmp', 'image/bmp'],
  ['svg', 'image/svg+xml']
]);
