'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'entry-debugger-extension');
const manifestPath = path.join(extensionDir, 'manifest.json');
const readUtf8 = (filePath) => fs.readFileSync(filePath, 'utf8');

function fail(message) {
  console.error('[check-extension] ' + message);
  process.exitCode = 1;
}

function assertFile(relativePath) {
  const filePath = path.join(extensionDir, relativePath);
  if (!fs.existsSync(filePath)) {
    fail('Missing file: ' + relativePath);
  }
}

function walk(dir, result = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, result);
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  });
  return result;
}

const manifest = JSON.parse(readUtf8(manifestPath));
const readme = readUtf8(path.join(rootDir, 'README.md'));
const readmeVersionMatch = readme.match(/\*\*버전\*\*:\s*([0-9]+\.[0-9]+\.[0-9]+)/);

if (!readmeVersionMatch) {
  fail('README version line was not found.');
} else if (readmeVersionMatch[1] !== manifest.version) {
  fail('README version ' + readmeVersionMatch[1] + ' does not match manifest version ' + manifest.version + '.');
}

if (!manifest.content_scripts || !manifest.content_scripts.length) {
  fail('manifest.content_scripts is empty.');
} else {
  manifest.content_scripts.forEach((script, index) => {
    (script.js || []).forEach(assertFile);
    (script.css || []).forEach(assertFile);
    if (!Array.isArray(script.matches) || !script.matches.includes('https://playentry.org/ws/*')) {
      fail('content_scripts[' + index + '] must include https://playentry.org/ws/*');
    }
  });
}

(manifest.web_accessible_resources || []).forEach((resourceBlock) => {
  (resourceBlock.resources || []).forEach(assertFile);
});

if (!readUtf8(path.join(extensionDir, 'popup.html')).includes('id="popup-version"')) {
  fail('popup.html must render the manifest version dynamically.');
}

walk(extensionDir)
  .concat(walk(path.join(rootDir, 'tools')))
  .filter((filePath) => filePath.endsWith('.js'))
  .forEach((filePath) => {
    const result = spawnSync(process.execPath, ['--check', filePath], {
      cwd: extensionDir,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      fail('Syntax check failed for ' + path.relative(rootDir, filePath) + '\n' + result.stderr);
    }
  });

if (!process.exitCode) {
  console.log('[check-extension] OK');
}
