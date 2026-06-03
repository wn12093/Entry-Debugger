/**
 * function-library-templates.js - Built-in Entry function templates.
 *
 * Templates are stored as Entry project function JSON. The Main World injector
 * clones IDs before adding a template to the current project.
 */
(function (global) {
  'use strict';

  global.EntryDebuggerFunctionLibraryTemplates = [
    {
      id: 'test-function',
      name: '테스트 함수',
      description: '문자와 참/거짓 값으로 말하기 또는 생각하기 실행',
      source: '260603_205님 작품 (1).ent',
      function: {
        id: 'vwb1',
        type: 'normal',
        localVariables: [
          {
            name: '지역변수',
            value: 0,
            id: 'vwb1_iir6'
          }
        ],
        useLocalVariables: true,
        content: '[[{"id":"gkyb","x":50,"y":30,"type":"function_create","params":[{"id":"nz4i","x":0,"y":0,"type":"function_field_label","params":["테스트 함수",{"id":"jmg3","x":0,"y":0,"type":"function_field_string","params":[{"id":"62ga","x":0,"y":0,"type":"stringParam_ogzm","params":[null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},{"id":"j767","x":0,"y":0,"type":"function_field_boolean","params":[{"id":"9a5q","x":0,"y":0,"type":"booleanParam_our2","params":[null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":false,"assemble":false,"extensions":[]}],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":false,"assemble":false,"extensions":[]}],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":false,"assemble":true,"extensions":[]},null,null,{"id":"gpo0","x":0,"y":0,"type":"text","params":[10],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]}],"statements":[[{"id":"c5tf","x":0,"y":0,"type":"set_func_variable","params":["vwb1_iir6",{"id":"vle0","x":0,"y":0,"type":"stringParam_ogzm","params":[],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},{"id":"wau8","x":0,"y":0,"type":"if_else","params":[{"id":"aa94","x":0,"y":0,"type":"booleanParam_our2","params":[],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},null,null],"statements":[[{"id":"wwbw","x":0,"y":0,"type":"dialog_time","params":[{"id":"7ol7","x":0,"y":0,"type":"get_func_variable","params":["vwb1_iir6",null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},{"id":"3fv5","x":0,"y":0,"type":"number","params":["4"],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},"speak",null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]}],[{"id":"edru","x":0,"y":0,"type":"dialog_time","params":[{"id":"bgvo","x":0,"y":0,"type":"get_func_variable","params":["vwb1_iir6",null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},{"id":"0efn","x":0,"y":0,"type":"number","params":["4"],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]},"think",null],"statements":[],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]}]],"movable":null,"deletable":1,"emphasized":false,"readOnly":null,"copyable":true,"assemble":true,"extensions":[]}]],"movable":null,"deletable":false,"emphasized":false,"readOnly":null,"copyable":false,"assemble":true,"extensions":[]}]]'
      }
    }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
