/**
 * hangul-search.js - Hangul-aware search helpers for Entry Debugger.
 *
 * This keeps the extension runtime bundle-free while providing the same search
 * primitives we need from es-hangul: choseong, jamo disassembly, and QWERTY
 * keyboard forms.
 */
(function () {
  'use strict';

  if (window.EntryDebuggerHangulSearch) return;

  var HANGUL_START = 0xAC00;
  var HANGUL_END = 0xD7A3;
  var HANGUL_BASE = 0xAC00;
  var JUNGSEONG_COUNT = 21;
  var JONGSEONG_COUNT = 28;
  var CHOSEONGS = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];
  var JUNGSEONGS = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ',
    'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
  ];
  var JONGSEONGS = [
    '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ',
    'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ',
    'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];
  var QWERTY_TO_JAMO = {
    r: 'ㄱ', R: 'ㄲ', s: 'ㄴ', e: 'ㄷ', E: 'ㄸ', f: 'ㄹ', a: 'ㅁ',
    q: 'ㅂ', Q: 'ㅃ', t: 'ㅅ', T: 'ㅆ', d: 'ㅇ', w: 'ㅈ', W: 'ㅉ',
    c: 'ㅊ', z: 'ㅋ', x: 'ㅌ', v: 'ㅍ', g: 'ㅎ',
    k: 'ㅏ', o: 'ㅐ', i: 'ㅑ', O: 'ㅒ', j: 'ㅓ', p: 'ㅔ', u: 'ㅕ',
    P: 'ㅖ', h: 'ㅗ', y: 'ㅛ', n: 'ㅜ', b: 'ㅠ', m: 'ㅡ', l: 'ㅣ'
  };
  var JAMO_TO_QWERTY = {
    'ㄱ': 'r', 'ㄲ': 'R', 'ㄳ': 'rt', 'ㄴ': 's', 'ㄵ': 'sw', 'ㄶ': 'sg',
    'ㄷ': 'e', 'ㄸ': 'E', 'ㄹ': 'f', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq',
    'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg', 'ㅁ': 'a', 'ㅂ': 'q',
    'ㅃ': 'Q', 'ㅄ': 'qt', 'ㅅ': 't', 'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w',
    'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
    'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p',
    'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅘ': 'hk', 'ㅙ': 'ho', 'ㅚ': 'hl',
    'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj', 'ㅞ': 'np', 'ㅟ': 'nl', 'ㅠ': 'b',
    'ㅡ': 'm', 'ㅢ': 'ml', 'ㅣ': 'l'
  };

  function normalize(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function isCompleteHangul(character) {
    var code = character.charCodeAt(0);
    return code >= HANGUL_START && code <= HANGUL_END;
  }

  function disassembleCharacter(character) {
    if (!character || !isCompleteHangul(character)) return character || '';

    var offset = character.charCodeAt(0) - HANGUL_BASE;
    var choseongIndex = Math.floor(offset / (JUNGSEONG_COUNT * JONGSEONG_COUNT));
    var jungseongIndex = Math.floor((offset % (JUNGSEONG_COUNT * JONGSEONG_COUNT)) / JONGSEONG_COUNT);
    var jongseongIndex = offset % JONGSEONG_COUNT;

    return CHOSEONGS[choseongIndex] + JUNGSEONGS[jungseongIndex] + JONGSEONGS[jongseongIndex];
  }

  function disassemble(value) {
    return Array.from(String(value == null ? '' : value)).map(disassembleCharacter).join('');
  }

  function getChoseong(value) {
    return Array.from(String(value == null ? '' : value)).map(function (character) {
      if (isCompleteHangul(character)) {
        var offset = character.charCodeAt(0) - HANGUL_BASE;
        return CHOSEONGS[Math.floor(offset / (JUNGSEONG_COUNT * JONGSEONG_COUNT))];
      }
      return /^[ㄱ-ㅎ]$/.test(character) ? character : '';
    }).join('');
  }

  function qwertyToJamo(value) {
    return Array.from(String(value == null ? '' : value)).map(function (character) {
      return QWERTY_TO_JAMO[character] || character;
    }).join('').toLowerCase();
  }

  function hangulToQwerty(value) {
    return Array.from(disassemble(value)).map(function (character) {
      return JAMO_TO_QWERTY[character] || character;
    }).join('').toLowerCase();
  }

  function createTargetTokens(value) {
    var raw = String(value == null ? '' : value);
    return {
      text: normalize(raw),
      disassembled: normalize(disassemble(raw)),
      choseong: normalize(getChoseong(raw)),
      qwerty: normalize(hangulToQwerty(raw))
    };
  }

  function isChoseongQuery(value) {
    return /^[ㄱ-ㅎ\s]+$/.test(normalize(value));
  }

  function isQwertyQuery(value) {
    var compact = String(value == null ? '' : value).replace(/\s+/g, '');
    return compact.length >= 2 && /[A-Za-z]/.test(compact);
  }

  function matches(text, query) {
    var haystacks = createTargetTokens(text);
    var rawQuery = String(query == null ? '' : query);
    var normalizedQuery = normalize(rawQuery);

    if (!normalizedQuery) return true;
    if (haystacks.text.indexOf(normalizedQuery) !== -1) return true;

    var disassembledQuery = normalize(disassemble(rawQuery));
    if (disassembledQuery && haystacks.disassembled.indexOf(disassembledQuery) !== -1) {
      return true;
    }

    if (isChoseongQuery(rawQuery) && haystacks.choseong.indexOf(normalizedQuery) !== -1) {
      return true;
    }

    if (isQwertyQuery(rawQuery)) {
      var jamoQuery = normalize(qwertyToJamo(rawQuery));
      if (jamoQuery && haystacks.disassembled.indexOf(jamoQuery) !== -1) return true;
      if (haystacks.qwerty.indexOf(normalizedQuery) !== -1) return true;
    }

    return false;
  }

  window.EntryDebuggerHangulSearch = {
    normalize: normalize,
    disassemble: disassemble,
    getChoseong: getChoseong,
    qwertyToJamo: qwertyToJamo,
    hangulToQwerty: hangulToQwerty,
    matches: matches
  };
})();
