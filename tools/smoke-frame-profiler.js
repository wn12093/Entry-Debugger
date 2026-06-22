'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-dev');
const localEntryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'http://127.0.0.1:8080/ws/abcdef0123456789abcdef01';
const settings = {
  enabled: true,
  debuggerTabEnabled: true,
  functionUsageEnabled: true,
  consoleDebuggingEnabled: true,
  boostModeControlVisible: true,
  boostModeEnabled: false,
  labTabEnabled: true,
  turboModeEnabled: false,
  dropdownSearchEnabled: true,
  dropdownSearchBlockMenuEnabled: true,
  dropdownSearchPropertyPanelEnabled: true,
  blockTextCopyEnabled: true,
  singleBlockDragEnabled: false,
  pictureToolsEnabled: false,
  frameProfilerEnabled: true,
  highQualityBlockImageEnabled: false,
  highQualityBlockImageScale: 1000,
  functionLibraryEnabled: false,
  functionPrivateVariablesEnabled: true
};

function resolvePlaywright() {
  const roots = [
    rootDir,
    path.join(rootDir, '..', '..', 'apps', 'MYentry-game'),
    process.cwd()
  ];
  for (const candidate of roots) {
    try {
      return require(require.resolve('playwright', { paths: [candidate] }));
    } catch (e) {}
  }
  throw new Error('Playwright를 찾을 수 없습니다.');
}

async function seedSettings(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  await worker.evaluate((value) => new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  }), settings);
}

async function main() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('먼저 npm run build:dev 를 실행하세요.');
  }

  const { chromium } = resolvePlaywright();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-frame-profiler-smoke-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--disable-extensions-except=' + extensionDir,
        '--load-extension=' + extensionDir
      ]
    });
    await seedSettings(context);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(localEntryUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(
      () => window.__ENTRY_DEBUGGER_FRAME_PROFILER_INJECTED__ === true &&
        window.Entry?.playground?.object,
      { timeout: 120000 }
    );

    const fixture = await page.evaluate(() => {
      const blocks = [{ type: 'when_run_button_click' }];
      for (let i = 0; i < 1000; i++) {
        blocks.push({ type: 'move_direction', params: [1] });
      }
      const object = Entry.playground.object;
      object.script.load([blocks]);
      return {
        objectId: object.id,
        hatId: object.script.getThreads()[0].getFirstBlock().id
      };
    });

    await page.evaluate(() => Entry.engine.toggleRun());
    await page.waitForFunction(() => Entry.engine.isState('run'), { timeout: 30000 });
    await page.waitForSelector('#ed-frame-profiler .ed-fp-obj', { timeout: 30000 });
    await page.locator('#ed-frame-profiler .ed-fp-obj').first().dispatchEvent('mousedown');
    await page.waitForSelector('#ed-frame-profiler .ed-fp-thread', { timeout: 30000 });

    const threadResult = await page.evaluate(({ objectId, hatId }) => {
      const object = Entry.container.getObject(objectId);
      const block = object.script.findById(hatId);
      const board = block.view.getBoard();
      window.__edFrameProfilerFocus = { activate: 0, select: 0 };
      const activate = board.activateBlock;
      const select = board.setSelectedBlock;
      board.activateBlock = function () {
        window.__edFrameProfilerFocus.activate++;
        return activate.apply(this, arguments);
      };
      board.setSelectedBlock = function () {
        window.__edFrameProfilerFocus.select++;
        return select.apply(this, arguments);
      };
      const row = document.querySelector('#ed-frame-profiler .ed-fp-thread');
      return {
        text: row ? row.textContent.trim() : '',
        objectId: row ? row.getAttribute('data-obj') : null,
        hatId: row ? row.getAttribute('data-hat') : null
      };
    }, fixture);
    await page.locator('#ed-frame-profiler .ed-fp-thread').first().dispatchEvent('mousedown');
    await page.waitForFunction(
      () => window.__edFrameProfilerFocus?.activate > 0 &&
        window.__edFrameProfilerFocus?.select > 0,
      { timeout: 30000 }
    );

    await page.evaluate(() => Entry.engine.togglePause());
    await page.waitForFunction(
      () => document.querySelector('#ed-frame-profiler')?.textContent.includes('일시정지'),
      { timeout: 30000 }
    );
    const pausedText = await page.locator('#ed-frame-profiler').textContent();

    await page.evaluate(async () => {
      await Entry.engine.toggleStop();
    });
    await page.waitForSelector('#ed-frame-profiler', { state: 'detached', timeout: 30000 });
    await page.evaluate(() => Entry.engine.toggleRun());
    await page.waitForSelector('#ed-frame-profiler .ed-fp-obj', { timeout: 30000 });
    await page.evaluate(async () => {
      await Entry.engine.toggleStop();
    });
    await page.waitForSelector('#ed-frame-profiler', { state: 'detached', timeout: 30000 });

    if (!threadResult.text.includes('시작하기 클릭') ||
        threadResult.objectId !== fixture.objectId ||
        threadResult.hatId !== fixture.hatId) {
      throw new Error('동기 스크립트가 올바른 햇 블록으로 표시되지 않았습니다.');
    }
    if (!pausedText.includes('마지막 상태')) {
      throw new Error('일시정지 시 마지막 측정 상태가 유지되지 않았습니다.');
    }

    console.log(JSON.stringify({
      fixture,
      threadResult,
      focus: await page.evaluate(() => window.__edFrameProfilerFocus),
      pausedText,
      stopped: true,
      restartLifecycle: true
    }, null, 2));
  } finally {
    if (context) await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[smoke-frame-profiler] ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
