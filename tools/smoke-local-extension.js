'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-dev');
const localEntryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'http://127.0.0.1:8080/ws/abcdef0123456789abcdef01';
const smokeSettings = {
  enabled: true,
  debuggerTabEnabled: true,
  functionUsageEnabled: true,
  consoleDebuggingEnabled: true,
  boostModeEnabled: false,
  labTabEnabled: true,
  eoUploaderEnabled: false,
  turboModeEnabled: false,
  dropdownSearchEnabled: true,
  dropdownSearchBlockMenuEnabled: true,
  dropdownSearchPropertyPanelEnabled: true,
  blockTextCopyEnabled: false,
  highQualityBlockImageEnabled: true,
  highQualityBlockImageScale: 1000,
  functionPrivateVariablesEnabled: true
};

function resolvePlaywright() {
  const candidateRoots = [
    rootDir,
    path.join(rootDir, '..', '..', 'apps', 'MYentry-game'),
    process.cwd()
  ];

  for (const candidate of candidateRoots) {
    try {
      return require(require.resolve('playwright', { paths: [candidate] }));
    } catch (e) {}
  }

  throw new Error('Playwright를 찾을 수 없습니다. apps/MYentry-game의 node_modules를 확인하세요.');
}

async function seedExtensionSettings(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }

  await worker.evaluate((settings) => new Promise((resolve, reject) => {
    chrome.storage.local.set(settings, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  }), smokeSettings);
}

async function main() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('개발용 확장 manifest가 없습니다. 먼저 npm run build:dev 를 실행하세요.');
  }

  const { chromium } = resolvePlaywright();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE &&
    fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
    ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    : null;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-debugger-smoke-'));
  const browserLogs = [];
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(executablePath ? { executablePath } : {}),
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--disable-extensions-except=' + extensionDir,
        '--load-extension=' + extensionDir
      ]
    });

    await seedExtensionSettings(context);

    const page = context.pages()[0] || await context.newPage();
    page.on('console', (message) => {
      browserLogs.push(message.type() + ': ' + message.text());
    });

    await page.goto(localEntryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await page.waitForSelector('.propertyTab', { timeout: 180000 });
    await page.waitForSelector('.propertyTabdebugging', { timeout: 60000 });
    await page.click('.propertyTabdebugging');
    await page.waitForSelector('#ed-debugger-panel', {
      state: 'visible',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-dropdown-search-block-menu', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-dropdown-search-property-panel', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-high-quality-scale-range', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-high-quality-scale-input', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForFunction(() => {
      const range = document.querySelector('#ed-high-quality-scale-range');
      const input = document.querySelector('#ed-high-quality-scale-input');
      return !!(range && input && range.value === '1000' && input.value === '1000');
    }, { timeout: 60000 });
    await page.waitForSelector('.entry-debugger-property-search-input', {
      state: 'attached',
      timeout: 60000
    });

    await page.evaluate(() => {
      const range = document.querySelector('#ed-high-quality-scale-range');
      if (!range) return;
      range.value = '900';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const range = document.querySelector('#ed-high-quality-scale-range');
      const input = document.querySelector('#ed-high-quality-scale-input');
      const warning = document.querySelector('#ed-high-quality-scale-warning');
      return !!(
        range &&
        input &&
        warning &&
        range.value === '900' &&
        input.value === '900' &&
        !warning.classList.contains('ed-lab-scale-warning-active')
      );
    }, { timeout: 60000 });
    await page.evaluate(() => {
      const range = document.querySelector('#ed-high-quality-scale-range');
      if (!range) return;
      range.value = '1000';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const range = document.querySelector('#ed-high-quality-scale-range');
      const input = document.querySelector('#ed-high-quality-scale-input');
      const warning = document.querySelector('#ed-high-quality-scale-warning');
      return !!(
        range &&
        input &&
        warning &&
        range.value === '1000' &&
        input.value === '1000' &&
        warning.classList.contains('ed-lab-scale-warning-active')
      );
    }, { timeout: 60000 });
    const highQualityWarningAt1000 = await page.evaluate(() => {
      const warning = document.querySelector('#ed-high-quality-scale-warning');
      return !!(warning && warning.classList.contains('ed-lab-scale-warning-active'));
    });

    await page.waitForFunction(() => {
      const panel = document.querySelector('#ed-debugger-panel');
      const status = document.querySelector('#ed-status');
      return !!(
        panel &&
        panel.offsetParent !== null &&
        status &&
        /연결|주입|대기/.test(status.textContent || '')
      );
    }, { timeout: 60000 });

    const result = await page.evaluate((warningAt1000) => {
      const panel = document.querySelector('#ed-debugger-panel');
      const status = document.querySelector('#ed-status');
      const tabs = Array.from(document.querySelectorAll('#ed-debugger-panel .ed-subtab'))
        .map((tab) => tab.textContent.trim());
      const labToggle = document.querySelector('#ed-toggle-turbo-mode');
      const blockMenuToggle = document.querySelector('#ed-toggle-dropdown-search-block-menu');
      const propertyPanelToggle = document.querySelector('#ed-toggle-dropdown-search-property-panel');
      const scaleRange = document.querySelector('#ed-high-quality-scale-range');
      const scaleInput = document.querySelector('#ed-high-quality-scale-input');
      const scaleWarning = document.querySelector('#ed-high-quality-scale-warning');
      return {
        url: location.href,
        hasDebuggingTab: !!document.querySelector('.propertyTabdebugging'),
        panelVisible: !!(panel && panel.offsetParent !== null),
        statusText: status ? status.textContent.trim() : '',
        tabs,
        hasLabControls: !!labToggle,
        hasDropdownBlockMenuToggle: !!blockMenuToggle,
        hasDropdownPropertyPanelToggle: !!propertyPanelToggle,
        dropdownBlockMenuChecked: !!(blockMenuToggle && blockMenuToggle.checked),
        dropdownPropertyPanelChecked: !!(propertyPanelToggle && propertyPanelToggle.checked),
        highQualityScaleRangeValue: scaleRange ? scaleRange.value : null,
        highQualityScaleInputValue: scaleInput ? scaleInput.value : null,
        highQualityWarningActive: !!(
          scaleWarning && scaleWarning.classList.contains('ed-lab-scale-warning-active')
        ),
        highQualityWarningAt1000: warningAt1000,
        hasPropertySearchInput: !!document.querySelector('.entry-debugger-property-search-input')
      };
    }, highQualityWarningAt1000);

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (browserLogs.length) {
      console.error('[browser logs]');
      console.error(browserLogs.slice(-30).join('\n'));
    }
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[smoke-local-extension] ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
