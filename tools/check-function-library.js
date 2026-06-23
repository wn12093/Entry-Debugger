'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const templateSource = fs.readFileSync(
  path.join(rootDir, 'entry-debugger-extension', 'function-library-templates.js'),
  'utf8'
);
const injectSource = fs.readFileSync(
  path.join(rootDir, 'entry-debugger-extension', 'inject.js'),
  'utf8'
);

function loadTemplates() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(templateSource, sandbox, {
    filename: 'function-library-templates.js'
  });
  return sandbox.EntryDebuggerFunctionLibraryTemplates;
}

function walkBlocks(node, visitor) {
  if (Array.isArray(node)) {
    node.forEach((item) => walkBlocks(item, visitor));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visitor(node);
  Object.keys(node).forEach((key) => walkBlocks(node[key], visitor));
}

function collectModelFacts(model) {
  const content = typeof model.content === 'string'
    ? JSON.parse(model.content)
    : model.content;
  const blockIds = [];
  const dynamicTypes = new Set();
  const localRefs = new Set();
  let functionLabel = '';

  walkBlocks(content, (block) => {
    if (block.id) blockIds.push(block.id);
    if (typeof block.type === 'string' && block.type.indexOf('stringParam_') === 0) {
      dynamicTypes.add(block.type);
    }
    if (block.type === 'function_field_label' && Array.isArray(block.params)) {
      functionLabel = block.params[0] || '';
    }
    if ((block.type === 'get_func_variable' || block.type === 'set_func_variable') &&
        Array.isArray(block.params) && typeof block.params[0] === 'string') {
      localRefs.add(block.params[0]);
    }
  });

  return {
    blockIds,
    dynamicTypes: Array.from(dynamicTypes),
    functionLabel,
    localIds: (model.localVariables || []).map((item) => item.id),
    localRefs: Array.from(localRefs)
  };
}

function runInsertion(template) {
  let messageHandler = null;
  let hashSequence = 0;
  const posts = [];
  const functions = {};

  class FakeCode {
    constructor(content) {
      this.content = typeof content === 'string' ? JSON.parse(content) : content;
    }

    toJSON() {
      return JSON.parse(JSON.stringify(this.content));
    }
  }

  class FakeFunc {
    constructor(model) {
      this.id = model.id;
      this.type = model.type || 'normal';
      this.localVariables = model.localVariables || [];
      this.useLocalVariables = !!model.useLocalVariables;
      this.content = new FakeCode(model.content);
      this.description = '';
    }

    generateBlock() {
      const facts = collectModelFacts({
        content: this.content.toJSON(),
        localVariables: this.localVariables
      });
      this.description = '[' + facts.functionLabel + ']';
    }
  }

  FakeFunc.isEdit = false;
  FakeFunc.updateMenu = function () {};

  const container = {
    functions_: functions,
    variables_: [],
    lists_: [],
    messages_: [],
    changeFunctionName: function () {},
    saveFunction: function (func) {
      this.functions_[func.id] = func;
    },
    updateList: function () {}
  };

  const Entry = {
    generateHash: function () {
      hashSequence++;
      return 'generated' + hashSequence;
    },
    Func: FakeFunc,
    Code: FakeCode,
    variableContainer: container,
    engine: {
      isState: function () { return false; }
    },
    playground: {
      blockMenu: {
        deleteRendered: function () {},
        align: function () {}
      }
    }
  };

  const windowObject = {
    Entry: Entry,
    location: { origin: 'https://playentry.org' },
    postMessage: function () {},
    addEventListener: function () {},
    EntryDebuggerPageBridge: {
      onMessage: function (handler) {
        messageHandler = handler;
      },
      post: function (type, payload, requestId) {
        posts.push({ type, payload, requestId });
      }
    }
  };
  const sandbox = {
    window: windowObject,
    console: console,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(injectSource, sandbox, { filename: 'inject.js' });
  if (typeof messageHandler !== 'function') {
    throw new Error('inject.js message handler was not registered.');
  }

  messageHandler({
    type: 'ADD_FUNCTION_LIBRARY_TEMPLATE',
    requestId: 'function-library-check',
    payload: {
      templateId: template.id,
      templateName: template.name,
      func: template.function
    }
  });

  const result = posts.find((item) =>
    item.type === 'ADD_FUNCTION_LIBRARY_TEMPLATE_RESULT' &&
    item.requestId === 'function-library-check'
  );
  if (!result || !result.payload || !result.payload.success) {
    throw new Error('Template insertion failed: ' +
      (result && result.payload ? result.payload.error : 'missing result'));
  }

  const added = functions[result.payload.id];
  if (!added) throw new Error('Inserted function was not saved.');
  return {
    added: {
      id: added.id,
      type: added.type,
      localVariables: added.localVariables,
      useLocalVariables: added.useLocalVariables,
      content: added.content.toJSON()
    },
    result: result.payload
  };
}

const templates = loadTemplates();
const template = templates.find((item) => item.id === 'number-to-hangul');
if (!template) throw new Error('number-to-hangul template was not found.');

const originalFacts = collectModelFacts(template.function);
const insertion = runInsertion(template);
const addedFacts = collectModelFacts(insertion.added);

if (insertion.added.id === template.function.id) {
  throw new Error('Function id was not remapped.');
}
if (insertion.added.type !== 'value') {
  throw new Error('Inserted function is not a value function.');
}
if (!insertion.added.useLocalVariables || insertion.added.localVariables.length !== 9) {
  throw new Error('Local variable configuration was not preserved.');
}
if (addedFacts.blockIds.length !== new Set(addedFacts.blockIds).size) {
  throw new Error('Inserted function contains duplicate block ids.');
}
if (addedFacts.blockIds.some((id) => originalFacts.blockIds.includes(id))) {
  throw new Error('One or more block ids were not remapped.');
}
if (addedFacts.localIds.some((id) => originalFacts.localIds.includes(id))) {
  throw new Error('One or more local variable ids were not remapped.');
}
const invalidLocalRefs = addedFacts.localRefs.filter((id) => !addedFacts.localIds.includes(id));
if (invalidLocalRefs.length) {
  throw new Error('Inserted function contains invalid local variable references: ' +
    invalidLocalRefs.join(', ') + ' / locals: ' + addedFacts.localIds.join(', '));
}
if (addedFacts.dynamicTypes.length !== 1 ||
    addedFacts.dynamicTypes[0] === originalFacts.dynamicTypes[0]) {
  throw new Error('Dynamic string parameter type was not remapped consistently.');
}
if (addedFacts.functionLabel !== template.name) {
  throw new Error('Inserted function label does not match the template name.');
}

console.log(JSON.stringify({
  templateId: template.id,
  functionId: insertion.added.id,
  blockCount: addedFacts.blockIds.length,
  localVariableCount: addedFacts.localIds.length,
  dynamicParamType: addedFacts.dynamicTypes[0],
  functionLabel: addedFacts.functionLabel
}, null, 2));
