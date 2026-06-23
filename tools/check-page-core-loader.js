'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentSource = fs.readFileSync(
  path.join(rootDir, 'entry-debugger-extension', 'content.js'),
  'utf8'
);

function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') {
        index++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth++;
    if (char === close) {
      depth--;
      if (depth === 0) return index;
    }
  }

  throw new Error('Matching ' + close + ' was not found');
}

function extractDeclaration(name) {
  const marker = 'const ' + name;
  const start = contentSource.indexOf(marker);
  assert.notStrictEqual(start, -1, name + ' declaration was not found');
  const arrayStart = contentSource.indexOf('[', start + marker.length);
  assert.notStrictEqual(arrayStart, -1, name + ' array start was not found');
  const arrayEnd = findMatchingDelimiter(contentSource, arrayStart, '[', ']');
  const semicolon = contentSource.indexOf(';', arrayEnd);
  assert.notStrictEqual(semicolon, -1, name + ' declaration semicolon was not found');
  return contentSource.slice(start, semicolon + 1).trim();
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = contentSource.indexOf(marker);
  assert.notStrictEqual(start, -1, name + ' function was not found');

  const bodyStart = contentSource.indexOf('{', start);
  const bodyEnd = findMatchingDelimiter(contentSource, bodyStart, '{', '}');
  return contentSource.slice(start, bodyEnd + 1).trim();
}

const featureInjectionFunctions = Array.from(
  contentSource.matchAll(/\bfunction (inject[A-Z][A-Za-z]+Script)\s*\(/g),
  (match) => match[1]
).filter((name) => name !== 'injectPageScript');

assert.strictEqual(featureInjectionFunctions.length, 12);
featureInjectionFunctions.forEach((name) => {
  const source = extractFunction(name);
  const coreCall = source.indexOf('injectPageCoreScripts();');
  const featureCall = source.indexOf('injectPageScript(');
  assert.notStrictEqual(coreCall, -1, name + ' must request page-core scripts');
  assert(
    featureCall > coreCall,
    name + ' must append its feature script after requesting page-core scripts'
  );
});

const appended = [];
const liveElements = new Map();
const parent = {
  appendChild(script) {
    appended.push(script);
    liveElements.set(script.id, script);
    script.parentNode = parent;
  }
};
const document = {
  head: parent,
  documentElement: parent,
  getElementById(id) {
    return liveElements.get(id) || null;
  },
  createElement(tagName) {
    assert.strictEqual(tagName, 'script');
    return {
      remove() {
        liveElements.delete(this.id);
        this.parentNode = null;
      }
    };
  }
};
const sandbox = {
  chrome: {
    runtime: {
      getURL(src) {
        return 'chrome-extension://test/' + src;
      }
    }
  },
  document
};

const testSource = [
  extractDeclaration('PAGE_CORE_SCRIPTS'),
  'let pageCoreScriptsInjected = false;',
  extractFunction('injectDebuggerScript'),
  extractFunction('injectPageCoreScripts'),
  extractFunction('injectPageScript'),
  'globalThis.testApi = { injectDebuggerScript };'
].join('\n\n');

vm.createContext(sandbox);
vm.runInContext(testSource, sandbox, { filename: 'content-page-core-loader.js' });
sandbox.testApi.injectDebuggerScript();

const expectedScripts = [
  ['entry-debugger-hangul-search', 'hangul-search.js'],
  ['entry-debugger-page-bridge', 'page-bridge.js'],
  ['entry-debugger-entry-adapter', 'entry-adapter.js'],
  ['entry-debugger-patch-registry', 'patch-registry.js'],
  ['entry-debugger-inject', 'inject.js']
];

assert.deepStrictEqual(
  appended.map((script) => [script.id, script.src.replace('chrome-extension://test/', '')]),
  expectedScripts
);
appended.forEach((script) => {
  assert.strictEqual(script.async, false, script.id + ' must preserve evaluation order');
  assert.strictEqual(typeof script.onload, 'function', script.id + ' must clean itself up');
});

sandbox.testApi.injectDebuggerScript();
assert.strictEqual(appended.length, expectedScripts.length);

appended.forEach((script) => script.onload());
assert.strictEqual(liveElements.size, 0);

console.log(JSON.stringify({
  check: 'page-core-loader',
  appendOrder: appended.map((script) => script.id),
  featureInjectionPaths: featureInjectionFunctions,
  cleanupAfterLoad: true,
  scope: 'DOM append order, in-flight duplicate guard, and onload cleanup',
  deferred: 'Promise sequencing and load-failure recovery'
}, null, 2));
