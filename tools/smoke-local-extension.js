'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-dev');
let extensionManifest = null;
const localEntryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'http://127.0.0.1:8080/ws/abcdef0123456789abcdef01';
const smokeSettings = {
  enabled: true,
  debuggerTabEnabled: true,
  functionUsageEnabled: true,
  consoleDebuggingEnabled: true,
  boostModeControlVisible: true,
  boostModeEnabled: false,
  labTabEnabled: true,
  eoUploaderEnabled: false,
  turboModeEnabled: false,
  dropdownSearchEnabled: true,
  dropdownSearchBlockMenuEnabled: true,
  dropdownSearchPropertyPanelEnabled: true,
  blockTextCopyEnabled: true,
  singleBlockDragEnabled: false,
  pictureToolsEnabled: false,
  frameProfilerEnabled: false,
  highQualityBlockImageEnabled: true,
  highQualityBlockImageScale: 1000,
  functionLibraryEnabled: true,
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

  return worker;
}

function assertSmokeResult(result) {
  const checks = [
    ['popup version', result.popupResult.versionText === 'v' + extensionManifest.version],
    ['popup debugger toggle', result.popupResult.hasDebuggerToggle],
    ['debugging tab', result.hasDebuggingTab],
    ['debugger panel', result.panelVisible],
    ['settings section', result.settingsTabResult.settingsSectionActive],
    ['Alt single-block drag default off', result.settingsTabResult.singleBlockDragChecked === false],
    ['picture tools default off', result.settingsTabResult.pictureToolsChecked === false],
    ['frame profiler default off', result.settingsTabResult.frameProfilerChecked === false],
    ['settings button returns to variables', result.settingsToggleBackResult.variablesSectionActive],
    ['function library tab', result.hasFunctionLibraryTab],
    ['function library empty state', result.functionLibraryResult.hasEmptyState],
    ['function library has no test add button', result.functionLibraryResult.hasAddButton === false],
    ['function library did not mutate functions',
      result.functionLibraryResult.countBefore === result.functionLibraryResult.countAfter],
    ['property search input', result.hasPropertySearchInput],
    ['high quality warning at 1000%', result.highQualityWarningAt1000],
    ['boost mode control', result.boostModeResult.hasBoostModeControl]
  ];
  const failed = checks.filter((check) => !check[1]).map((check) => check[0]);

  if (failed.length) {
    throw new Error('Smoke assertions failed: ' + failed.join(', '));
  }
}

async function main() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('개발용 확장 manifest가 없습니다. 먼저 npm run build:dev 를 실행하세요.');
  }
  extensionManifest = JSON.parse(
    fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')
  );

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

    const worker = await seedExtensionSettings(context);
    const extensionId = new URL(worker.url()).hostname;
    const popupPage = await context.newPage();
    await popupPage.goto('chrome-extension://' + extensionId + '/popup.html', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await popupPage.waitForSelector('#popup-version', { timeout: 30000 });
    const popupResult = await popupPage.evaluate(() => ({
      versionText: (document.querySelector('#popup-version')?.textContent || '').trim(),
      hasDebuggerToggle: !!document.querySelector('#toggle-debugger-tab')
    }));
    await popupPage.close();

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
    await page.waitForSelector('#ed-boost-mode-toggle', {
      state: 'attached',
      timeout: 60000
    });
    await page.click('.propertyTabdebugging');
    await page.waitForSelector('#ed-debugger-panel', {
      state: 'visible',
      timeout: 60000
    });
    await page.waitForSelector('#ed-settings-tab-btn', {
      state: 'attached',
      timeout: 60000
    });
    await page.click('#ed-settings-tab-btn');
    await page.waitForSelector('#ed-section-settings.ed-section-active', {
      state: 'visible',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-setting-function-usage', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-setting-console-debugging', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-setting-function-private-variables', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-setting-boost-mode-button', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-dropdown-search', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-block-text-copy', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-single-block-drag', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-picture-tools', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-frame-profiler', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-high-quality-block-image', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-toggle-setting-lab-tab', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('#ed-reset-settings-btn', {
      state: 'attached',
      timeout: 60000
    });
    const settingsTabResult = await page.evaluate(() => {
      const getChecked = (selector) => {
        const input = document.querySelector(selector);
        return !!(input && input.checked);
      };
      return {
        hasSettingsButton: !!document.querySelector('#ed-settings-tab-btn'),
        settingsSectionActive: !!document.querySelector('#ed-section-settings.ed-section-active'),
        functionUsageChecked: getChecked('#ed-toggle-setting-function-usage'),
        consoleDebuggingChecked: getChecked('#ed-toggle-setting-console-debugging'),
        functionPrivateVariablesChecked: getChecked('#ed-toggle-setting-function-private-variables'),
        boostModeButtonChecked: getChecked('#ed-toggle-setting-boost-mode-button'),
        dropdownSearchChecked: getChecked('#ed-toggle-dropdown-search'),
        blockTextCopyChecked: getChecked('#ed-toggle-block-text-copy'),
        singleBlockDragChecked: getChecked('#ed-toggle-single-block-drag'),
        pictureToolsChecked: getChecked('#ed-toggle-picture-tools'),
        frameProfilerChecked: getChecked('#ed-toggle-frame-profiler'),
        highQualityBlockImageChecked: getChecked('#ed-toggle-high-quality-block-image'),
        labTabChecked: getChecked('#ed-toggle-setting-lab-tab'),
        hasResetSettingsButton: !!document.querySelector('#ed-reset-settings-btn')
      };
    });
    await page.click('#ed-settings-tab-btn');
    await page.waitForSelector('#ed-section-variables.ed-section-active', {
      state: 'visible',
      timeout: 60000
    });
    const settingsToggleBackResult = await page.evaluate(() => ({
      settingsSectionActive: !!document.querySelector('#ed-section-settings.ed-section-active'),
      variablesSectionActive: !!document.querySelector('#ed-section-variables.ed-section-active'),
      activeSubtabText: (document.querySelector('#ed-debugger-panel .ed-subtab-active')?.textContent || '').trim()
    }));
    await page.click('#ed-settings-tab-btn');
    await page.waitForSelector('#ed-section-settings.ed-section-active', {
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
    await page.waitForSelector('#ed-toggle-function-library', {
      state: 'attached',
      timeout: 60000
    });
    await page.waitForSelector('.ed-subtab[data-tab="function-library"]', {
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

    await page.click('#ed-boost-mode-toggle');
    await page.waitForFunction(() => {
      const button = document.querySelector('#ed-boost-mode-toggle');
      const toast = document.querySelector('#entryToastContainer .entryToastWarning');
      return !!(
        button &&
        button.textContent.includes('부스트모드') &&
        button.querySelector('.ed-boost-mode-switch') &&
        button.classList.contains('ed-boost-mode-toggle-on') &&
        toast &&
        /새로고침 해야 반영됩니다/.test(toast.textContent || '')
      );
    }, { timeout: 60000 });
    const boostModeResult = await page.evaluate(() => {
      const button = document.querySelector('#ed-boost-mode-toggle');
      const toast = document.querySelector('#entryToastContainer .entryToastWarning');
      return {
        hasBoostModeControl: !!button,
        boostModeControlText: button ? button.textContent.trim() : '',
        hasBoostModeSwitch: !!(button && button.querySelector('.ed-boost-mode-switch')),
        boostModeControlPressed: button ? button.getAttribute('aria-pressed') : null,
        boostModeControlOn: !!(button && button.classList.contains('ed-boost-mode-toggle-on')),
        boostToastText: toast ? toast.textContent.trim() : '',
        boostStorageValue: localStorage.getItem('__ENTRY_DEBUGGER_BOOST_MODE_ENABLED__')
      };
    });

    const functionCountBeforeOpen = await page.evaluate(() => {
      const funcs = window.Entry &&
        window.Entry.variableContainer &&
        window.Entry.variableContainer.functions_;
      return funcs ? Object.keys(funcs).length : 0;
    });
    await page.click('.ed-subtab[data-tab="function-library"]');
    await page.waitForSelector('.ed-function-library-empty', {
      state: 'visible',
      timeout: 60000
    });
    const functionLibraryResult = await page.evaluate((beforeCount) => {
      const funcs = window.Entry &&
        window.Entry.variableContainer &&
        window.Entry.variableContainer.functions_;
      const values = funcs ? Object.values(funcs) : [];
      const status = document.querySelector('#ed-function-library-status');
      const notice = document.querySelector('#ed-section-function-library .ed-lab-warning');
      const empty = document.querySelector('#ed-function-library-list .ed-function-library-empty');
      return {
        countBefore: beforeCount,
        countAfter: values.length,
        hasAddButton: !!document.querySelector('#ed-function-library-list .ed-function-add-btn'),
        hasEmptyState: !!empty,
        emptyStateText: empty ? empty.textContent.trim() : '',
        hasFunctionLibraryNotice: !!notice,
        noticeText: notice ? notice.textContent.trim() : '',
        statusText: status ? status.textContent.trim() : ''
      };
    }, functionCountBeforeOpen);

    await page.waitForFunction(() => {
      const panel = document.querySelector('#ed-debugger-panel');
      return !!(panel && panel.offsetParent !== null);
    }, { timeout: 60000 });

    const result = await page.evaluate(({ popupResult, warningAt1000, settingsTabResult, settingsToggleBackResult, boostModeResult, functionLibraryResult }) => {
      const panel = document.querySelector('#ed-debugger-panel');
      const tabs = Array.from(document.querySelectorAll('#ed-debugger-panel .ed-subtab'))
        .map((tab) => tab.textContent.trim());
      const labToggle = document.querySelector('#ed-toggle-turbo-mode');
      const blockMenuToggle = document.querySelector('#ed-toggle-dropdown-search-block-menu');
      const propertyPanelToggle = document.querySelector('#ed-toggle-dropdown-search-property-panel');
      const scaleRange = document.querySelector('#ed-high-quality-scale-range');
      const scaleInput = document.querySelector('#ed-high-quality-scale-input');
      const scaleWarning = document.querySelector('#ed-high-quality-scale-warning');
      const functionLibraryToggle = document.querySelector('#ed-toggle-function-library');
      const functionLibraryTab = document.querySelector('.ed-subtab[data-tab="function-library"]');
      return {
        url: location.href,
        popupResult,
        hasDebuggingTab: !!document.querySelector('.propertyTabdebugging'),
        panelVisible: !!(panel && panel.offsetParent !== null),
        tabs,
        settingsTabResult,
        settingsToggleBackResult,
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
        boostModeResult,
        hasFunctionLibraryToggle: !!functionLibraryToggle,
        functionLibraryChecked: !!(functionLibraryToggle && functionLibraryToggle.checked),
        hasFunctionLibraryTab: !!functionLibraryTab,
        functionLibraryResult,
        hasPropertySearchInput: !!document.querySelector('.entry-debugger-property-search-input')
      };
    }, { popupResult, warningAt1000: highQualityWarningAt1000, settingsTabResult, settingsToggleBackResult, boostModeResult, functionLibraryResult });

    assertSmokeResult(result);
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
