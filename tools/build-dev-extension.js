'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'entry-debugger-extension');
const distDir = path.join(rootDir, 'dist');
const targetDir = path.join(distDir, 'entry-debugger-extension-dev');
const manifestPath = path.join(targetDir, 'manifest.json');
const contentScriptPath = path.join(targetDir, 'content.js');

const LOCAL_WORKSPACE_MATCHES = [
  'http://127.0.0.1/*',
  'http://localhost/*'
];

const LOCAL_RESOURCE_MATCHES = [
  'http://127.0.0.1/*',
  'http://localhost/*'
];

function copyExtension() {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => !source.includes(path.sep + '.git' + path.sep)
  });
}

function writeDevManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.name = manifest.name + ' (Local Dev)';

  manifest.content_scripts = (manifest.content_scripts || []).map((script) => ({
    ...script,
    matches: Array.from(new Set([...(script.matches || []), ...LOCAL_WORKSPACE_MATCHES]))
  }));

  manifest.web_accessible_resources = (manifest.web_accessible_resources || []).map((block) => ({
    ...block,
    matches: Array.from(new Set([...(block.matches || []), ...LOCAL_RESOURCE_MATCHES]))
  }));

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function enableLocalWorkspaceInContentScript() {
  const productionCheck = [
    "      return url.protocol === 'https:' &&",
    "        url.hostname === 'playentry.org' &&",
    "        url.pathname.indexOf('/ws/') === 0;"
  ].join('\n');
  const localDevCheck = [
    "      var isPlayEntryWorkspace = url.protocol === 'https:' &&",
    "        url.hostname === 'playentry.org' &&",
    "        url.pathname.indexOf('/ws/') === 0;",
    "      var isLocalWorkspace = url.protocol === 'http:' &&",
    "        (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&",
    "        (url.port === '' || url.port === '8080') &&",
    "        url.pathname.indexOf('/ws/') === 0;",
    "      return isPlayEntryWorkspace || isLocalWorkspace;"
  ].join('\n');
  // `.gitattributes`의 `* text=auto` 때문에 Windows에서는 content.js가 CRLF로
  // 체크아웃된다. productionCheck/localDevCheck는 LF로 join되므로 원본을 LF로
  // 정규화해야 includes 매칭이 성립한다. 산출물도 manifest.json(JSON.stringify가
  // LF 출력)과 동일하게 LF로 통일된다.
  const contentScript = fs.readFileSync(contentScriptPath, 'utf8').replace(/\r\n/g, '\n');

  if (!contentScript.includes(productionCheck)) {
    throw new Error('Local workspace content-script patch target was not found.');
  }

  fs.writeFileSync(
    contentScriptPath,
    contentScript.replace(productionCheck, localDevCheck)
  );
}

copyExtension();
writeDevManifest();
enableLocalWorkspaceInContentScript();

console.log('[build-dev-extension] Wrote ' + targetDir);
console.log('[build-dev-extension] Load this folder in chrome://extensions for local Entry testing.');
