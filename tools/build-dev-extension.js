'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'entry-debugger-extension');
const distDir = path.join(rootDir, 'dist');
const targetDir = path.join(distDir, 'entry-debugger-extension-dev');
const manifestPath = path.join(targetDir, 'manifest.json');

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

copyExtension();
writeDevManifest();

console.log('[build-dev-extension] Wrote ' + targetDir);
console.log('[build-dev-extension] Load this folder in chrome://extensions for local Entry testing.');
