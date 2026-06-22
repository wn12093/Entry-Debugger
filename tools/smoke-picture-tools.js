'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-dev');
const localEntryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'http://127.0.0.1:8080/ws/abcdef0123456789abcdef01';
const fixtureGif = path.resolve(
  rootDir,
  '..',
  '..',
  'upstream',
  'entryjs-develop',
  'extern',
  'blockly',
  'media',
  '1x1.gif'
);
const settings = {
  enabled: true,
  debuggerTabEnabled: true,
  functionUsageEnabled: true,
  consoleDebuggingEnabled: true,
  boostModeControlVisible: true,
  boostModeEnabled: false,
  labTabEnabled: false,
  turboModeEnabled: false,
  dropdownSearchEnabled: true,
  dropdownSearchBlockMenuEnabled: true,
  dropdownSearchPropertyPanelEnabled: true,
  blockTextCopyEnabled: true,
  singleBlockDragEnabled: false,
  pictureToolsEnabled: true,
  highQualityBlockImageEnabled: false,
  highQualityBlockImageScale: 1000,
  functionLibraryEnabled: false,
  functionPrivateVariablesEnabled: true
};
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

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

function makePngFiles(dir, count, prefix) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const filePath = path.join(dir, `${prefix}-${String(i + 1).padStart(2, '0')}.png`);
    fs.writeFileSync(filePath, onePixelPng);
    result.push(filePath);
  }
  return result;
}

async function openUploadPanel(page) {
  await page.evaluate(() => {
    document.querySelector('#EntryPopupContainer')?.remove();
    const root = document.createElement('div');
    root.id = 'EntryPopupContainer';
    root.className = 'modal';
    root.style.cssText = 'position:fixed;left:20px;top:20px;z-index:2147483000;background:#fff;padding:20px;';
    root.innerHTML =
      '<div class="popup">' +
        '<div class="popup_wrap__fixture">' +
          '<header><button class="imbtn_pop_close__fixture">X</button>' +
          '<a class="btn__fixture" role="button">추가하기</a></header>' +
          '<div class="file_add_box__fixture" style="width:180px;height:60px;">' +
            '<label for="inpt_file">파일 올리기</label>' +
            '<input type="file" id="inpt_file" multiple>' +
          '</div>' +
          '<ul class="obj_list__fixture"></ul>' +
        '</div>' +
      '</div>';
    root.addEventListener('change', (event) => {
      if (event.target.id !== 'inpt_file') return;
      const list = root.querySelector('.obj_list__fixture');
      Array.from(event.target.files).forEach((file) => {
        const item = document.createElement('li');
        item.textContent = file.name;
        list.appendChild(item);
      });
    });
    root.addEventListener('click', (event) => {
      const action = event.target.closest('a, button');
      if (!action) return;
      if (action.textContent.trim() === '추가하기' ||
          action.matches('[class*="imbtn_pop_close"]')) {
        setTimeout(() => root.remove(), 0);
      }
    });
    document.body.appendChild(root);
    window.__edUploadBatches = [];
    document.querySelector('#inpt_file').addEventListener('change', (event) => {
      window.__edUploadBatches.push(
        Array.from(event.target.files).map((file) => file.name)
      );
    });
  });
}

async function chooseFiles(page, files) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[class*="file_add_box"]').click({ force: true });
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

async function waitForBatchCount(page, count) {
  await page.waitForFunction(
    (expected) => Array.isArray(window.__edUploadBatches) &&
      window.__edUploadBatches.length >= expected,
    count,
    { timeout: 60000 }
  );
}

async function closeUploadPanel(page) {
  await page.locator('#EntryPopupContainer [class*="imbtn_pop_close"]').click({ force: true });
  await page.waitForSelector('#EntryPopupContainer', { state: 'detached', timeout: 30000 });
}

async function main() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('먼저 npm run build:dev 를 실행하세요.');
  }
  if (!fs.existsSync(fixtureGif)) {
    throw new Error('GIF fixture를 찾을 수 없습니다: ' + fixtureGif);
  }

  const { chromium } = resolvePlaywright();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-picture-tools-smoke-'));
  const profileDir = path.join(tempDir, 'profile');
  const fixtureDir = path.join(tempDir, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const png3 = makePngFiles(fixtureDir, 3, 'small');
  const png11 = makePngFiles(fixtureDir, 11, 'bulk');
  const png25 = makePngFiles(fixtureDir, 25, 'cancel');
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
    await page.waitForSelector('#entryPictureTab', { timeout: 180000 });
    await page.waitForFunction(
      () => window.__ENTRY_DEBUGGER_PICTURE_TOOLS_INJECTED__ === true,
      { timeout: 60000 }
    );
    await page.waitForTimeout(500);
    await page.click('#entryPictureTab', { force: true });
    await page.waitForSelector('li.entryPlaygroundPictureElement', { timeout: 60000 });

    await page.evaluate(() => {
      const pg = Entry.playground;
      const object = pg.object;
      const seed = object.pictures[0];
      seed.scale = 37;
      while (object.pictures.length < 5) {
        pg.addPicture(Object.assign({}, seed, {
          name: 'picture_tools_seed_' + object.pictures.length,
          scale: 37
        }), true, false);
      }
      window.__edPictureCommands = [];
      const originalDo = Entry.do;
      Entry.do = function () {
        window.__edPictureCommands.push(arguments[0]);
        return originalDo.apply(this, arguments);
      };
    });
    await page.waitForFunction(
      () => document.querySelectorAll('li.entryPlaygroundPictureElement').length >= 5
    );

    let rows = page.locator('li.entryPlaygroundPictureElement');
    const beforeDelete = await rows.count();
    await rows.nth(1).locator('.entryPlayground_del').click({ force: true });
    await page.waitForFunction(
      (count) => document.querySelectorAll('li.entryPlaygroundPictureElement').length === count - 1,
      beforeDelete
    );
    const deleteCommands = await page.evaluate(() => window.__edPictureCommands.slice());
    if (!deleteCommands.includes('objectRemovePicture')) {
      throw new Error('단일 삭제가 objectRemovePicture 명령을 기록하지 않았습니다.');
    }

    await page.evaluate(() => { window.__edPictureCommands.length = 0; });
    rows = page.locator('li.entryPlaygroundPictureElement');
    const beforeDuplicate = await page.evaluate(() =>
      Entry.playground.object.pictures.map((picture) => picture.id)
    );
    await rows.nth(0).click({ button: 'right', force: true, position: { x: 30, y: 30 } });
    await page.getByText('복제하기 (1개)', { exact: true }).click({ force: true });
    await page.waitForFunction(
      (count) => Entry.playground.object.pictures.length === count + 1,
      beforeDuplicate.length
    );
    const duplicateResult = await page.evaluate((beforeIds) => {
      const added = Entry.playground.object.pictures.find(
        (picture) => !beforeIds.includes(picture.id)
      );
      return {
        scale: added && added.scale,
        commands: window.__edPictureCommands.slice()
      };
    }, beforeDuplicate);
    if (duplicateResult.scale !== 37 ||
        !duplicateResult.commands.includes('objectAddPicture')) {
      throw new Error('복제가 scale 또는 objectAddPicture 명령을 보존하지 않았습니다.');
    }

    rows = page.locator('li.entryPlaygroundPictureElement');
    const rowCount = await rows.count();
    const beforeReorderIds = await page.evaluate(() =>
      Entry.playground.object.pictures.map((picture) => picture.id)
    );
    const firstBox = await rows.nth(0).boundingBox();
    const thirdBox = await rows.nth(Math.min(2, rowCount - 1)).boundingBox();
    if (!firstBox || !thirdBox) throw new Error('순서 변경 좌표를 구하지 못했습니다.');
    await page.mouse.move(firstBox.x + 25, firstBox.y + 25);
    await page.mouse.down();
    await page.mouse.move(firstBox.x + 45, firstBox.y + 55, { steps: 5 });
    await page.mouse.move(thirdBox.x + 25, thirdBox.y + thirdBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const orderLabels = await page.evaluate(() =>
      Entry.playground.object.pictures.map((picture) =>
        String(picture.view && picture.view.orderHolder && picture.view.orderHolder.textContent)
      )
    );
    if (orderLabels.some((value, index) => value !== String(index + 1))) {
      throw new Error('순서 변경 후 화면 번호가 배열 순서와 다릅니다.');
    }
    const afterReorderIds = await page.evaluate(() =>
      Entry.playground.object.pictures.map((picture) => picture.id)
    );
    if (beforeReorderIds.join(',') === afterReorderIds.join(',')) {
      throw new Error('재정렬 결과가 모델에 반영되지 않았습니다.');
    }
    await page.evaluate(() => Entry.stateManager.undo());
    await page.waitForFunction(
      (expected) => Entry.playground.object.pictures.map((picture) => picture.id).join(',') === expected,
      beforeReorderIds.join(',')
    );
    await page.evaluate(() => Entry.stateManager.redo());
    await page.waitForFunction(
      (expected) => Entry.playground.object.pictures.map((picture) => picture.id).join(',') === expected,
      afterReorderIds.join(',')
    );
    await page.evaluate(() => {
      const pg = Entry.playground;
      const object = pg.object;
      const seed = object.pictures[0];
      while (object.pictures.length < 30) {
        pg.addPicture(Object.assign({}, seed, {
          name: 'picture_tools_scroll_' + object.pictures.length
        }), true, false);
      }
    });
    await page.waitForFunction(
      () => document.querySelectorAll('li.entryPlaygroundPictureElement').length === 30
    );
    const outsideScrollSetup = await page.evaluate(() => {
      const row = document.querySelector('li.entryPlaygroundPictureElement');
      const scroller = row.closest('.rcs-inner-container');
      scroller.scrollTop = Math.min(400, scroller.scrollHeight - scroller.clientHeight - 20);
      const rect = scroller.getBoundingClientRect();
      return {
        scrollTop: scroller.scrollTop,
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom
      };
    });
    rows = page.locator('li.entryPlaygroundPictureElement');
    let visibleRowBox = null;
    for (let i = 0; i < await rows.count(); i++) {
      const box = await rows.nth(i).boundingBox();
      if (box && box.y > outsideScrollSetup.top + 10 &&
          box.y < outsideScrollSetup.bottom - 30) {
        visibleRowBox = box;
        break;
      }
    }
    if (!visibleRowBox) throw new Error('자동 스크롤 검증용 모양 행을 찾지 못했습니다.');
    await page.mouse.move(visibleRowBox.x + 25, visibleRowBox.y + 25);
    await page.mouse.down();
    await page.mouse.move(visibleRowBox.x + 35, visibleRowBox.y + 40, { steps: 4 });
    await page.mouse.move(outsideScrollSetup.left - 120, outsideScrollSetup.bottom - 5, {
      steps: 6
    });
    await page.waitForTimeout(100);
    const outsideScrollStart = await page.evaluate(() =>
      document.querySelector('li.entryPlaygroundPictureElement')
        .closest('.rcs-inner-container').scrollTop
    );
    await page.waitForTimeout(250);
    const outsideScrollTop = await page.evaluate(() =>
      document.querySelector('li.entryPlaygroundPictureElement')
        .closest('.rcs-inner-container').scrollTop
    );
    await page.mouse.up();
    if (Math.abs(outsideScrollTop - outsideScrollStart) > 2) {
      throw new Error('모양 목록 가로 범위 밖에서도 자동 스크롤이 발생했습니다.');
    }

    await page.evaluate(() => {
      window.__edRenameEvents = [];
      window.__edReloads = 0;
      const originalDispatch = Entry.dispatchEvent;
      Entry.dispatchEvent = function () {
        if (arguments[0] === 'pictureNameChanged') {
          window.__edRenameEvents.push(arguments[1] && arguments[1].id);
        }
        return originalDispatch.apply(this, arguments);
      };
      const pg = Entry.playground;
      const originalReload = pg.reloadPlayground;
      pg.reloadPlayground = function () {
        window.__edReloads++;
        return originalReload.apply(this, arguments);
      };
    });
    rows = page.locator('li.entryPlaygroundPictureElement');
    await rows.nth(0).click({ force: true, position: { x: 30, y: 30 } });
    await rows.nth(1).click({
      force: true,
      position: { x: 30, y: 30 },
      modifiers: ['Shift']
    });
    await rows.nth(0).click({ button: 'right', force: true, position: { x: 30, y: 30 } });
    await page.getByText('일괄 이름변경하기 (2개)', { exact: true }).click({ force: true });
    const renameModal = page.locator('body > div').filter({
      hasText: '선택한 2개 모양의 새 이름'
    }).last();
    await renameModal.locator('input[type="text"]').fill('bulk_review');
    await renameModal.getByText('확인', { exact: true }).click({ force: true });
    const renameResult = await page.evaluate(() => ({
      names: Entry.playground.object.pictures.slice(0, 2).map((picture) => picture.name),
      serialized: Entry.playground.object.toJSON().sprite.pictures
        .slice(0, 2)
        .map((picture) => picture.name),
      painterName: Entry.playground.painter.file.name,
      selectedName: Entry.playground.object.selectedPicture.name,
      events: window.__edRenameEvents.length,
      reloads: window.__edReloads
    }));
    if (renameResult.names[0] !== 'bulk_review_01' ||
        renameResult.serialized[1] !== 'bulk_review_02' ||
        renameResult.painterName !== renameResult.selectedName ||
        renameResult.events !== 2 ||
        renameResult.reloads !== 1) {
      throw new Error('일괄 이름변경 동기화가 완전하지 않습니다.');
    }

    await openUploadPanel(page);
    await chooseFiles(page, png3);
    await waitForBatchCount(page, 1);
    const smallUpload = await page.evaluate(() => ({
      batches: window.__edUploadBatches.map((batch) => batch.length),
      hasProgress: !!document.querySelector('#ed-picture-tools-prog')
    }));
    if (smallUpload.batches.join(',') !== '3' || smallUpload.hasProgress) {
      throw new Error('10개 이하 업로드가 Entry 기본 단일 전달 경로를 사용하지 않았습니다.');
    }
    await closeUploadPanel(page);

    await openUploadPanel(page);
    await chooseFiles(page, [fixtureGif].concat(png3));
    await waitForBatchCount(page, 1);
    const gifUpload = await page.evaluate(() => ({
      batches: window.__edUploadBatches.map((batch) => batch.length),
      names: window.__edUploadBatches.flat(),
      hasProgress: !!document.querySelector('#ed-picture-tools-prog')
    }));
    if (gifUpload.batches.join(',') !== '4' ||
        !gifUpload.names.some((name) => /1x1_1\.png$/i.test(name)) ||
        gifUpload.hasProgress) {
      throw new Error('GIF 프레임과 일반 이미지 합산 기준이 잘못되었습니다.');
    }
    await closeUploadPanel(page);

    await openUploadPanel(page);
    await chooseFiles(page, [fixtureGif].concat(png11.slice(0, 10)));
    await waitForBatchCount(page, 2);
    const gifBulkUpload = await page.evaluate(() => ({
      batches: window.__edUploadBatches.map((batch) => batch.length),
      names: window.__edUploadBatches.flat(),
      hasProgress: !!document.querySelector('#ed-picture-tools-prog')
    }));
    if (gifBulkUpload.batches.join(',') !== '10,1' ||
        !gifBulkUpload.names.some((name) => /1x1_1\.png$/i.test(name)) ||
        !gifBulkUpload.hasProgress) {
      throw new Error('GIF 프레임을 포함한 11개 업로드가 스테이징되지 않았습니다.');
    }
    await closeUploadPanel(page);

    await openUploadPanel(page);
    await chooseFiles(page, png11);
    await waitForBatchCount(page, 2);
    const bulkUpload = await page.evaluate(() => ({
      batches: window.__edUploadBatches.map((batch) => batch.length),
      hasProgress: !!document.querySelector('#ed-picture-tools-prog')
    }));
    if (bulkUpload.batches.join(',') !== '10,1' || !bulkUpload.hasProgress) {
      throw new Error('11개 업로드가 10개 단위 스테이징으로 처리되지 않았습니다.');
    }
    await closeUploadPanel(page);

    await openUploadPanel(page);
    await chooseFiles(page, png25);
    await waitForBatchCount(page, 1);
    await page.getByText('추가하기', { exact: true }).click({ force: true });
    await page.waitForTimeout(1000);
    const addCancelledBatchCount = await page.evaluate(() => window.__edUploadBatches.length);
    if (addCancelledBatchCount !== 1 || await page.locator('#ed-picture-tools-prog').count()) {
      throw new Error('추가하기를 누른 뒤 스테이징이 계속 진행됐습니다.');
    }

    await openUploadPanel(page);
    await chooseFiles(page, png25);
    await waitForBatchCount(page, 1);
    await page.locator('#EntryPopupContainer [class*="imbtn_pop_close"]').click({ force: true });
    await page.waitForTimeout(1000);
    const closeCancelledBatchCount = await page.evaluate(() => window.__edUploadBatches.length);
    if (closeCancelledBatchCount !== 1 || await page.locator('#ed-picture-tools-prog').count()) {
      throw new Error('업로드 창을 닫은 뒤 스테이징이 계속 진행됐습니다.');
    }

    console.log(JSON.stringify({
      deleteCommands,
      duplicateResult,
      orderLabels,
      renameResult,
      smallUpload,
      gifUpload,
      gifBulkUpload,
      bulkUpload,
      addCancelledBatchCount,
      closeCancelledBatchCount
    }, null, 2));
  } finally {
    if (context) await context.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[smoke-picture-tools] ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
