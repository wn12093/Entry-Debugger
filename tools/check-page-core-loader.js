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

function extractDeclaration(name) {
  const start = contentSource.indexOf('  const ' + name + ' = ');
  assert.notStrictEqual(start, -1, name + ' declaration was not found');
  const end = contentSource.indexOf('\n  ];', start);
  assert.notStrictEqual(end, -1, name + ' declaration end was not found');
  return contentSource.slice(start, end + 5).trim();
}

function extractFunction(name) {
  const marker = '  function ' + name + '(';
  const start = contentSource.indexOf(marker);
  assert.notStrictEqual(start, -1, name + ' function was not found');

  const bodyStart = contentSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < contentSource.length; index++) {
    if (contentSource[index] === '{') depth++;
    if (contentSource[index] === '}') {
      depth--;
      if (depth === 0) {
        return contentSource.slice(start, index + 1).trim();
      }
    }
  }
  throw new Error(name + ' function end was not found');
}

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
  order: appended.map((script) => script.id),
  cleanupAfterLoad: true,
  scope: 'current order, duplicate guard, and load cleanup',
  deferred: 'Promise sequencing and load-failure recovery'
}, null, 2));
