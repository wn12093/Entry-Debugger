/**
 * eo-uploader.js - Built-in Entry .eo generator.
 */
(function (global) {
  'use strict';

  var THUMB_LONG_EDGE = 96;
  var ENTRY_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
  var DEFAULT_STATUS = '이미지를 추가해 .eo로 저장한 뒤, 엔트리의 오브젝트 추가하기 > 파일 업로드에서 업로드하세요.';
  var STAGE_TARGET_LONG_EDGE = 200;
  var TAR_BLOCK_SIZE = 512;
  var FILE_ID_LENGTH = 32;
  var SHORT_ID_LENGTH = 4;
  var ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

  function create(deps) {
    deps = deps || {};

    var files = [];
    var busy = false;
    function getPanel() {
      return deps.getPanelEl ? deps.getPanelEl() : null;
    }

    function escapeHTML(str) {
      if (deps.escapeHTML) return deps.escapeHTML(str);
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }

    function escapeAttr(str) {
      if (deps.escapeAttr) return deps.escapeAttr(str);
      return escapeHTML(str).replace(/"/g, '&quot;');
    }

    function bindEvents() {
      var panel = getPanel();
      if (!panel) return;

      var fileInput = panel.querySelector('#ed-generator-file');
      var drop = panel.querySelector('#ed-generator-drop');
      var downloadButton = panel.querySelector('#ed-generator-download');
      var clearButton = panel.querySelector('#ed-generator-clear');

      if (fileInput && fileInput.dataset.bound !== 'true') {
        fileInput.dataset.bound = 'true';
        fileInput.addEventListener('change', function () {
          addFiles(fileInput.files);
          fileInput.value = '';
        });
      }

      if (drop && drop.dataset.bound !== 'true') {
        drop.dataset.bound = 'true';
        drop.addEventListener('click', function () {
          if (fileInput) fileInput.click();
        });
        drop.addEventListener('dragover', function (event) {
          event.preventDefault();
          drop.classList.add('ed-generator-drop-active');
        });
        drop.addEventListener('dragleave', function () {
          drop.classList.remove('ed-generator-drop-active');
        });
        drop.addEventListener('drop', function (event) {
          event.preventDefault();
          drop.classList.remove('ed-generator-drop-active');
          addFiles(event.dataTransfer && event.dataTransfer.files);
        });
      }

      if (downloadButton && downloadButton.dataset.bound !== 'true') {
        downloadButton.dataset.bound = 'true';
        downloadButton.addEventListener('click', function () {
          runDownload();
        });
      }

      if (clearButton && clearButton.dataset.bound !== 'true') {
        clearButton.dataset.bound = 'true';
        clearButton.addEventListener('click', function () {
          if (busy) return;
          files = [];
          renderFileList();
          setStatus(DEFAULT_STATUS, 'info');
        });
      }

      renderFileList();
    }

    function addFiles(fileList) {
      var nextFiles = Array.prototype.slice.call(fileList || []);
      if (!nextFiles.length) return;

      var accepted = [];
      var rejectedBmp = 0;
      var rejectedOther = 0;

      nextFiles.forEach(function (file) {
        var kind = getFileKind(file);
        if (kind === 'bmp') {
          rejectedBmp++;
        } else if (kind) {
          accepted.push(file);
        } else {
          rejectedOther++;
        }
      });

      if (accepted.length) {
        files = files.concat(accepted);
      }

      renderFileList();
      var totalSize = getSelectedFilesSize();
      var limitMessage = getUploadLimitWarning(totalSize, '선택한 이미지 총 용량');

      if (rejectedBmp || rejectedOther) {
        var parts = [];
        if (accepted.length) parts.push(accepted.length + '개 추가');
        if (rejectedBmp) parts.push('BMP ' + rejectedBmp + '개 거부');
        if (rejectedOther) parts.push('지원하지 않는 파일 ' + rejectedOther + '개 제외');
        setStatus(
          parts.join(', ') + '.' + (limitMessage ? ' ' + limitMessage : ''),
          rejectedBmp ? 'error' : (limitMessage ? 'warning' : 'info')
        );
      } else if (limitMessage) {
        setStatus(accepted.length + '개 이미지를 추가했습니다. ' + limitMessage, 'warning');
      } else {
        setStatus(accepted.length + '개 이미지를 추가했습니다. .eo 다운로드 후 오브젝트 추가하기 > 파일 업로드에서 업로드하세요.', 'success');
      }
    }

    function renderFileList() {
      var panel = getPanel();
      if (!panel) return;

      var list = panel.querySelector('#ed-generator-file-list');
      var downloadButton = panel.querySelector('#ed-generator-download');
      var clearButton = panel.querySelector('#ed-generator-clear');
      var hasFiles = files.length > 0;

      if (list) {
        if (!hasFiles) {
          list.textContent = '선택된 이미지가 없습니다.';
        } else {
          list.innerHTML = files.map(function (file) {
            return (
              '<div class="ed-generator-file-item">' +
                '<span title="' + escapeAttr(file.name) + '">' + escapeHTML(file.name) + '</span>' +
                '<em>' + escapeHTML(formatBytes(file.size)) + '</em>' +
              '</div>'
            );
          }).join('');
        }
      }

      if (downloadButton) downloadButton.disabled = busy || !hasFiles;
      if (clearButton) clearButton.disabled = busy || !hasFiles;
    }

    function setStatus(message, type) {
      var panel = getPanel();
      if (!panel) return;
      var status = panel.querySelector('#ed-generator-status');
      if (!status) return;

      status.className = 'ed-generator-status ed-generator-status-' + (type || 'info');
      status.textContent = message;
    }

    function getSelectedFilesSize() {
      return files.reduce(function (sum, file) {
        return sum + (file && file.size || 0);
      }, 0);
    }

    async function runDownload() {
      var panel = getPanel();
      if (busy) return;
      if (!files.length) {
        setStatus('먼저 이미지 파일을 추가하세요.', 'error');
        return;
      }

      busy = true;
      renderFileList();
      setStatus('이미지를 Entry 형식으로 변환하는 중입니다...', 'info');

      try {
        var objectNameInput = panel && panel.querySelector('#ed-generator-object-name');
        var objectName = sanitizeFileName(objectNameInput && objectNameInput.value || '새 오브젝트');
        objectName = objectName.replace(/\.eo$/i, '') || '새 오브젝트';
        var assets = await buildAssets(files);
        var objectJson = buildObjectJson(assets, objectName);
        var blob = await createEoBlob(objectJson, assets);
        downloadEoBlob(blob, objectName + '.eo');

        var limitMessage = getUploadLimitWarning(blob.size, '생성된 .eo 파일 용량');
        if (limitMessage) {
          setStatus('다운로드를 시작했습니다. ' + limitMessage, 'warning');
        } else {
          setStatus('다운로드를 시작했습니다. 받은 .eo 파일은 엔트리의 오브젝트 추가하기 > 파일 업로드에서 업로드하세요.', 'success');
        }
        busy = false;
        renderFileList();
      } catch (err) {
        busy = false;
        renderFileList();
        setStatus(err && err.message ? err.message : String(err), 'error');
      }
    }

    function cleanup() {
      files = [];
      busy = false;
    }

    return {
      bindEvents: bindEvents,
      renderFileList: renderFileList,
      cleanup: cleanup
    };
  }

  async function buildAssets(files) {
    var usedPictureIds = new Set();
    var usedFileIds = new Set();
    var assets = [];

    for (var i = 0; i < files.length; i++) {
      assets.push(await processFile(files[i], i, usedPictureIds, usedFileIds));
    }

    return assets;
  }

  async function processFile(file, index, usedPictureIds, usedFileIds) {
    var kind = getFileKind(file);
    if (kind === 'bmp') {
      throw new Error('BMP 파일은 Entry 모양에서 지원하지 않아 제외해야 합니다: ' + file.name);
    }
    if (!kind) {
      throw new Error('지원하지 않는 이미지 형식입니다: ' + file.name);
    }

    var id = uniqueId(SHORT_ID_LENGTH, usedPictureIds);
    var fileId = uniqueId(FILE_ID_LENGTH, usedFileIds);
    var name = sanitizeShapeName(file.name, index);

    if (kind === 'svg') {
      return processSvgFile(file, id, fileId, name);
    }
    return processBitmapFile(file, id, fileId, name);
  }

  async function processBitmapFile(file, id, fileId, name) {
    var decoded = await decodeBitmap(file);
    if (!decoded.width || !decoded.height) {
      decoded.dispose();
      throw new Error('이미지 크기를 읽을 수 없습니다: ' + file.name);
    }

    var width = decoded.width;
    var height = decoded.height;
    var fullBlob;
    var thumbBlob;
    try {
      fullBlob = await drawPng(decoded.source, width, height);
      var thumb = getThumbSize(width, height);
      thumbBlob = await drawPng(decoded.source, thumb.width, thumb.height);
    } finally {
      decoded.dispose();
    }

    return {
      id: id,
      fileId: fileId,
      name: name,
      imageType: 'png',
      width: width,
      height: height,
      imageBytes: await blobToUint8Array(fullBlob),
      thumbBytes: await blobToUint8Array(thumbBlob)
    };
  }

  async function processSvgFile(file, id, fileId, name) {
    var svgText = await file.text();
    var size = extractSvgDimensions(svgText);
    var fullBlob = await rasterizeSvg(svgText, size.width, size.height);
    var thumb = getThumbSize(size.width, size.height);
    var thumbBlob = await rasterizeSvg(svgText, thumb.width, thumb.height);

    return {
      id: id,
      fileId: fileId,
      name: name,
      imageType: 'svg',
      width: size.width,
      height: size.height,
      svgBytes: new TextEncoder().encode(svgText),
      fullPngBytes: await blobToUint8Array(fullBlob),
      thumbBytes: await blobToUint8Array(thumbBlob)
    };
  }

  function buildObjectJson(assets, objectName) {
    return {
      functions: [],
      variables: [],
      messages: [],
      tables: [],
      expansionBlocks: [],
      aiUtilizeBlocks: [],
      objects: [
        buildObjectModel(assets, objectName)
      ]
    };
  }

  function buildObjectModel(assets, objectName) {
    var selected = assets[0];
    var usedIds = new Set(assets.map(function (asset) { return asset.id; }));
    var objectId = uniqueId(SHORT_ID_LENGTH, usedIds);
    var sceneId = uniqueId(SHORT_ID_LENGTH, usedIds);
    var scale = getScale(selected);

    return {
      id: objectId,
      name: objectName,
      script: '[]',
      objectType: 'sprite',
      rotateMethod: 'free',
      scene: sceneId,
      selectedPictureId: selected.id,
      lock: false,
      sprite: {
        pictures: assets.map(function (asset) {
          return buildPictureJson(asset, scale);
        }),
        sounds: []
      },
      entity: {
        x: 0,
        y: 0,
        regX: selected.width / 2,
        regY: selected.height / 2,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        direction: 90,
        width: selected.width,
        height: selected.height,
        font: 'undefinedpx ',
        visible: true
      }
    };
  }

  function buildPictureJson(asset, scale) {
    return {
      id: asset.id,
      name: asset.name,
      filename: asset.fileId,
      imageType: asset.imageType,
      fileurl: getPictureFileUrl(asset),
      dimension: {
        width: asset.width,
        height: asset.height,
        scaleX: scale,
        scaleY: scale
      }
    };
  }

  function getPictureFileUrl(asset) {
    var parts = getPartition(asset.fileId);
    return 'temp/' + parts.first + '/' + parts.second + '/image/' + asset.fileId + '.' + asset.imageType;
  }

  async function createEoBlob(objectJson, assets) {
    if (typeof CompressionStream !== 'function') {
      throw new Error('현재 브라우저가 gzip 압축을 지원하지 않습니다. 최신 Chrome에서 다시 시도하세요.');
    }

    var tarBlob = buildTarBlob(buildTarEntries(objectJson, assets));
    var gzipStream = tarBlob.stream().pipeThrough(new CompressionStream('gzip'));
    var gzipBytes = await new Response(gzipStream).arrayBuffer();
    return new Blob([gzipBytes], { type: 'application/octet-stream' });
  }

  function buildTarEntries(objectJson, assets) {
    var encoder = new TextEncoder();
    var entries = [];
    var dirs = new Set();

    addDirEntry(entries, dirs, 'object/');
    assets.forEach(function (asset) {
      var parts = getPartition(asset.fileId);
      addDirEntry(entries, dirs, 'object/' + parts.first + '/');
      addDirEntry(entries, dirs, 'object/' + parts.first + '/' + parts.second + '/');
      addDirEntry(entries, dirs, 'object/' + parts.first + '/' + parts.second + '/image/');
      addDirEntry(entries, dirs, 'object/' + parts.first + '/' + parts.second + '/thumb/');
    });

    entries.push({
      type: 'file',
      path: 'object/object.json',
      bytes: encoder.encode(JSON.stringify(objectJson))
    });

    assets.forEach(function (asset) {
      var parts = getPartition(asset.fileId);
      var base = 'object/' + parts.first + '/' + parts.second;
      if (asset.imageType === 'svg') {
        entries.push({
          type: 'file',
          path: base + '/image/' + asset.fileId + '.svg',
          bytes: asset.svgBytes
        });
        entries.push({
          type: 'file',
          path: base + '/image/' + asset.fileId + '.png',
          bytes: asset.fullPngBytes
        });
      } else {
        entries.push({
          type: 'file',
          path: base + '/image/' + asset.fileId + '.png',
          bytes: asset.imageBytes
        });
      }
      entries.push({
        type: 'file',
        path: base + '/thumb/' + asset.fileId + '.png',
        bytes: asset.thumbBytes
      });
    });

    return entries;
  }

  function addDirEntry(entries, dirs, path) {
    if (dirs.has(path)) return;
    dirs.add(path);
    entries.push({
      type: 'directory',
      path: path,
      bytes: new Uint8Array(0)
    });
  }

  function buildTarBlob(entries) {
    var chunks = [];
    entries.forEach(function (entry) {
      var bytes = entry.bytes || new Uint8Array(0);
      chunks.push(makeTarHeader(entry.path, bytes.length, entry.type));
      if (bytes.length) {
        chunks.push(bytes);
        chunks.push(new Uint8Array(getTarPadding(bytes.length)));
      }
    });
    chunks.push(new Uint8Array(TAR_BLOCK_SIZE * 2));
    return new Blob(chunks, { type: 'application/x-tar' });
  }

  function makeTarHeader(path, size, type) {
    var pathBytes = new TextEncoder().encode(path);
    if (pathBytes.length > 100) {
      throw new Error('tar 경로가 너무 깁니다: ' + path);
    }

    var header = new Uint8Array(TAR_BLOCK_SIZE);
    writeTarText(header, 0, 100, path);
    writeTarOctal(header, 100, 8, type === 'directory' ? 0o755 : 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, type === 'directory' ? 0 : size);
    writeTarOctal(header, 136, 12, 0);
    for (var i = 148; i < 156; i++) header[i] = 32;
    header[156] = type === 'directory' ? 53 : 48;
    writeTarText(header, 257, 6, 'ustar');
    writeTarText(header, 263, 2, '00');

    var checksum = header.reduce(function (sum, byte) {
      return sum + byte;
    }, 0);
    writeTarChecksum(header, checksum);
    return header;
  }

  function writeTarText(buffer, offset, length, text) {
    var bytes = new TextEncoder().encode(text);
    buffer.set(bytes.slice(0, length), offset);
  }

  function writeTarOctal(buffer, offset, length, value) {
    var text = value.toString(8).padStart(length - 1, '0');
    writeTarText(buffer, offset, length - 1, text);
    buffer[offset + length - 1] = 0;
  }

  function writeTarChecksum(buffer, checksum) {
    var text = checksum.toString(8).padStart(6, '0');
    writeTarText(buffer, 148, 6, text);
    buffer[154] = 0;
    buffer[155] = 32;
  }

  function getTarPadding(size) {
    return (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  }

  async function decodeBitmap(file) {
    if ('createImageBitmap' in window) {
      try {
        var bitmap = await createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          dispose: function () { bitmap.close(); }
        };
      } catch (e) {}
    }
    return loadImage(file);
  }

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () {
        resolve({
          source: image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          dispose: function () { URL.revokeObjectURL(url); }
        });
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('이미지를 디코딩할 수 없습니다.'));
      };
      image.src = url;
    });
  }

  async function rasterizeSvg(svgText, width, height) {
    var blob = new Blob([svgText], { type: 'image/svg+xml' });
    var decoded = await loadImage(blob);
    try {
      return await drawPng(decoded.source, width, height);
    } finally {
      decoded.dispose();
    }
  }

  function drawPng(source, width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, 'image/png');
  }

  function canvasToBlob(canvas, type) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('이미지 변환에 실패했습니다.'));
          return;
        }
        resolve(blob);
      }, type);
    });
  }

  function extractSvgDimensions(svgText) {
    var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('SVG 파일을 읽을 수 없습니다.');
    }

    var svg = doc.documentElement;
    var width = parseSvgLength(svg.getAttribute('width'));
    var height = parseSvgLength(svg.getAttribute('height'));
    var viewBox = svg.getAttribute('viewBox');
    if ((!width || !height) && viewBox) {
      var parts = viewBox.trim().split(/[,\s]+/).map(Number);
      if (parts.length >= 4) {
        width = width || parts[2];
        height = height || parts[3];
      }
    }

    if (!width || !height || width <= 0 || height <= 0) {
      throw new Error('SVG의 width/height 또는 viewBox를 찾을 수 없습니다.');
    }

    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    };
  }

  function parseSvgLength(value) {
    if (!value || /%$/.test(String(value).trim())) return 0;
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getFileKind(file) {
    var ext = getExtension(file && file.name);
    var mime = String(file && file.type || '').toLowerCase();

    if (ext === 'bmp' || mime === 'image/bmp' || mime === 'image/x-ms-bmp') return 'bmp';
    if (ext === 'svg' || mime === 'image/svg+xml') return 'svg';
    if (ACCEPTED_EXTENSIONS.indexOf(ext) !== -1) return 'bitmap';
    if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif' || mime === 'image/webp') {
      return 'bitmap';
    }
    return '';
  }

  function getExtension(name) {
    var match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function getThumbSize(width, height) {
    if (width >= height) {
      return {
        width: THUMB_LONG_EDGE,
        height: Math.max(1, Math.round(height * THUMB_LONG_EDGE / width))
      };
    }
    return {
      width: Math.max(1, Math.round(width * THUMB_LONG_EDGE / height)),
      height: THUMB_LONG_EDGE
    };
  }

  function getScale(asset) {
    var longEdge = Math.max(asset.width || 1, asset.height || 1);
    return STAGE_TARGET_LONG_EDGE / longEdge;
  }

  function getPartition(fileId) {
    return {
      first: fileId.slice(0, 2),
      second: fileId.slice(2, 4)
    };
  }

  function uniqueId(length, used) {
    var id;
    do {
      id = '';
      for (var i = 0; i < length; i++) {
        id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
      }
    } while (used && used.has(id));
    if (used) used.add(id);
    return id;
  }

  function sanitizeShapeName(name, index) {
    var base = String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return base || ('모양 ' + (index + 1));
  }

  function sanitizeFileName(name) {
    var cleaned = String(name || '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();
    return cleaned || '새 오브젝트';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function getUploadLimitWarning(bytes, label) {
    if (bytes <= ENTRY_UPLOAD_LIMIT_BYTES) return '';
    return (
      label + '이 ' + formatBytes(bytes) +
      '입니다. 10MB를 넘으면 엔트리의 오브젝트 파일 업로드가 실패할 수 있습니다.'
    );
  }

  function blobToUint8Array(blob) {
    return blob.arrayBuffer().then(function (buffer) {
      return new Uint8Array(buffer);
    });
  }

  function downloadEoBlob(blob, filename) {
    var safeName = sanitizeFileName(String(filename || 'entry-object').replace(/\.gz$/i, ''));
    if (!/\.eo$/i.test(safeName)) safeName += '.eo';

    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  }

  global.EntryDebuggerEoUploader = {
    create: create
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
