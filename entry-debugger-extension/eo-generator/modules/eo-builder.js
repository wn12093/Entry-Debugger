/**
 * eo-builder.js - Entry .eo object.json/tar/gzip 생성
 */

import { uniqueShortId } from './ids.js';
import { buildTarBlob } from './tar.js';

const encoder = new TextEncoder();

// object.json, tar, gzip을 순서대로 묶어 최종 .eo Blob을 생성합니다.
export async function buildEoBlob(objectName, items, selectedItemId, scale) {
  const objectJson = buildObjectJson(objectName, items, selectedItemId, scale);
  const tarBlob = buildTarBlob(buildTarEntries(objectJson, items));
  return gzipBlob(tarBlob);
}

// §3 object.json 최상위 스키마를 생성합니다.
export function buildObjectJson(objectName, items, selectedItemId, scale) {
  const selected = items.find(function (item) {
    return item.id === selectedItemId;
  }) || items[0];
  const objectIds = new Set(items.map(function (item) {
    return item.id;
  }));
  const objectId = uniqueShortId(objectIds);
  const sceneId = uniqueShortId(objectIds);

  return {
    functions: [],
    variables: [],
    messages: [],
    tables: [],
    expansionBlocks: [],
    aiUtilizeBlocks: [],
    objects: [
      {
        id: objectId,
        name: objectName,
        script: '[]',
        objectType: 'sprite',
        rotateMethod: 'free',
        scene: sceneId,
        selectedPictureId: selected.id,
        lock: false,
        sprite: {
          pictures: items.map(function (item) {
            return buildPictureJson(item, scale);
          }),
          sounds: []
        },
        entity: buildEntityJson(selected, scale)
      }
    ]
  };
}

// §3.3 picture JSON을 생성하고, §6 fileurl은 temp/ 접두어를 사용합니다.
function buildPictureJson(item, scale) {
  const parts = partitionPath(item.fileId);
  return {
    id: item.id,
    name: item.name.trim(),
    filename: item.fileId,
    imageType: item.imageType,
    fileurl: `temp/${parts.first}/${parts.second}/image/${item.fileId}.${item.imageType}`,
    dimension: {
      width: item.width,
      height: item.height,
      scaleX: scale,
      scaleY: scale
    }
  };
}

// §3.4, §8 entity는 selectedPictureId의 원본 크기와 공통 scale을 따릅니다.
function buildEntityJson(selected, scale) {
  return {
    x: 0,
    y: 0,
    regX: Math.floor(selected.width / 2),
    regY: Math.floor(selected.height / 2),
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
    direction: 90,
    width: selected.width,
    height: selected.height,
    font: 'undefinedpx ',
    visible: true
  };
}

// §2 tar 내부 디렉터리와 파일 엔트리를 구성합니다.
export function buildTarEntries(objectJson, items) {
  const entries = [];
  const dirs = new Set();

  addDirEntry(entries, dirs, 'object/');
  items.forEach(function (item) {
    const parts = partitionPath(item.fileId);
    addDirEntry(entries, dirs, `object/${parts.first}/`);
    addDirEntry(entries, dirs, `object/${parts.first}/${parts.second}/`);
    addDirEntry(entries, dirs, `object/${parts.first}/${parts.second}/image/`);
    addDirEntry(entries, dirs, `object/${parts.first}/${parts.second}/thumb/`);
  });

  entries.push({
    type: 'file',
    path: 'object/object.json',
    bytes: encoder.encode(JSON.stringify(objectJson))
  });

  items.forEach(function (item) {
    const parts = partitionPath(item.fileId);
    entries.push({
      type: 'file',
      path: `object/${parts.first}/${parts.second}/image/${item.fileId}.${item.imageType}`,
      bytes: item.originalBytes
    });
    entries.push({
      type: 'file',
      path: `object/${parts.first}/${parts.second}/thumb/${item.fileId}.${item.imageType}`,
      bytes: item.thumbBytes
    });
  });

  return entries;
}

// 디렉터리 엔트리 중복을 막으면서 tar 목록에 추가합니다.
function addDirEntry(entries, dirs, path) {
  if (dirs.has(path)) return;
  dirs.add(path);
  entries.push({
    type: 'directory',
    path,
    bytes: new Uint8Array(0)
  });
}

// §2 partition 경로: filename[0:2] / filename[2:4].
function partitionPath(fileId) {
  return {
    first: fileId.slice(0, 2),
    second: fileId.slice(2, 4)
  };
}

// §1 gzip 압축은 Chrome 내장 CompressionStream을 사용합니다.
async function gzipBlob(blob) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('현재 브라우저가 CompressionStream(gzip)을 지원하지 않습니다. 최신 Chrome에서 다시 시도하세요.');
  }
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  const gzipBytes = await new Response(stream).arrayBuffer();
  return new Blob([gzipBytes], { type: 'application/gzip' });
}
