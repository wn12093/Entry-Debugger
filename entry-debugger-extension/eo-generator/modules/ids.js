/**
 * ids.js - Entry .eo에서 쓰는 filename/id 생성기
 */

import {
  ALPHABET,
  FILE_ID_LENGTH,
  SHORT_ID_LENGTH
} from './constants.js';

// §4 32자 lowercase alphanumeric filename을 중복 없이 생성합니다.
export function uniqueFileId(usedSet) {
  let id = randomAlphaNumeric(FILE_ID_LENGTH);
  while (usedSet.has(id)) {
    id = randomAlphaNumeric(FILE_ID_LENGTH);
  }
  usedSet.add(id);
  return id;
}

// §4 object.id, picture.id, scene에 쓰는 4자 ID를 생성합니다.
export function uniqueShortId(usedSet) {
  let id = randomAlphaNumeric(SHORT_ID_LENGTH);
  while (usedSet.has(id)) {
    id = randomAlphaNumeric(SHORT_ID_LENGTH);
  }
  usedSet.add(id);
  return id;
}

// crypto 난수를 base36 문자 집합으로 변환합니다.
function randomAlphaNumeric(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let id = '';
  for (let i = 0; i < bytes.length; i += 1) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}
