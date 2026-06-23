'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');

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
const contentScript = readUtf8(path.join(extensionDir, 'content.js'));
const functionTemplates = readUtf8(path.join(extensionDir, 'function-library-templates.js'));
const popupHtml = readUtf8(path.join(extensionDir, 'popup.html'));
const removedUploaderPath = path.join(extensionDir, 'eo-uploader.js');
const extensionFiles = walk(extensionDir);

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

if (/127\.0\.0\.1|localhost/.test(contentScript)) {
  fail('Production content.js must not include local workspace hosts.');
}

if (/test-function|테스트 함수|260603_205/.test(functionTemplates)) {
  fail('Production function templates contain a test-only template.');
}

try {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(functionTemplates, sandbox, {
    filename: 'function-library-templates.js'
  });
  const templates = sandbox.EntryDebuggerFunctionLibraryTemplates;
  const templateIds = new Set();

  if (!Array.isArray(templates) || !templates.length) {
    fail('Function library must contain at least one user-facing template.');
  } else {
    templates.forEach((template) => {
      if (!template || !template.id || !template.name || !template.description ||
          !template.source || !template.function) {
        fail('Function template metadata is incomplete.');
        return;
      }
      if (templateIds.has(template.id)) {
        fail('Duplicate function template id: ' + template.id);
      }
      templateIds.add(template.id);

      const func = template.function;
      const content = typeof func.content === 'string'
        ? JSON.parse(func.content)
        : func.content;
      const blockIds = new Set();
      const localIds = new Set((func.localVariables || []).map((item) => item.id));
      const localRefs = new Set();
      let functionLabel = '';

      function walkNode(node) {
        if (Array.isArray(node)) {
          node.forEach(walkNode);
          return;
        }
        if (!node || typeof node !== 'object') return;

        if (node.id) {
          if (blockIds.has(node.id)) {
            fail('Duplicate block id in template ' + template.id + ': ' + node.id);
          }
          blockIds.add(node.id);
        }
        if (node.type === 'function_field_label' && Array.isArray(node.params)) {
          functionLabel = node.params[0] || '';
        }
        if ((node.type === 'get_func_variable' || node.type === 'set_func_variable') &&
            Array.isArray(node.params) && typeof node.params[0] === 'string') {
          localRefs.add(node.params[0]);
        }
        Object.keys(node).forEach((key) => walkNode(node[key]));
      }

      walkNode(content);
      if (functionLabel !== template.name) {
        fail('Function label does not match template name: ' + template.id);
      }
      localRefs.forEach((id) => {
        if (!localIds.has(id)) {
          fail('Unknown local variable reference in template ' + template.id + ': ' + id);
        }
      });
    });
  }
} catch (error) {
  fail('Function template validation failed: ' + error.message);
}

if (/<script[^>]+src=["']https?:\/\//i.test(popupHtml)) {
  fail('Remote script tags are not allowed in the production popup.');
}

if (fs.existsSync(removedUploaderPath) ||
    extensionFiles.some((filePath) => {
      const source = readUtf8(filePath);
      return /eo-uploader\.js|\beoUploaderEnabled\b|ed-toggle-eo-uploader/.test(source);
    })) {
  fail('Removed EO bulk uploader code or settings are still present.');
}

extensionFiles
  .concat(walk(path.join(rootDir, 'tools')))
  .filter((filePath) => filePath.endsWith('.js'))
  .forEach((filePath) => {
    if (filePath.startsWith(extensionDir)) {
      const source = readUtf8(filePath);
      if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
        fail('Remote-code-like execution pattern found in ' + path.relative(rootDir, filePath));
      }
    }

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
