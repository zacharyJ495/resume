/*!
 * 打印样式补丁（为「矢量 PDF」导出提供干净的打印版式）
 *
 * 背景：原站没有可用的打印样式——直接按 Ctrl+P 会连工具条、灰色页面底色、纸张边框阴影
 *       一起打出来，而且内容会溢出成两页。所以之前的实现干脆把 window.print 整个接管成
 *       位图导出。本模块补上打印样式，从而可以走浏览器原生打印，得到**真正的矢量文字 PDF**：
 *       字体与编辑区完全一致、可选中可搜索、放大不模糊、文件还更小。
 *
 * 做法：全部隐藏，再让简历纸张 main 及其内容可见（不依赖具体类名，站点改版也不易失效）。
 */
(function () {
  'use strict';

  var CSS = [
    '@media print {',
    '  @page { size: A4 portrait; margin: 0; }',
    '',
    '  html, body {',
    '    background: #fff !important;',
    '    overflow: visible !important;',
    '    height: auto !important;',
    '    margin: 0 !important;',
    '    padding: 0 !important;',
    '  }',
    '',
    '  /* 先全部隐藏，再让简历纸张及其内容可见：工具条等界面元素不会被打印 */',
    '  body * { visibility: hidden !important; }',
    '  main, main * { visibility: visible !important; }',
    '',
    '  main {',
    '    position: absolute !important;',
    '    left: 0 !important;',
    '    top: 0 !important;',
    '    margin: 0 !important;',
    '    border: none !important;',
    '    box-shadow: none !important;',
    '    outline: none !important;',
    '    background: #fff !important;',
    '    overflow: visible !important;',
    '    height: auto !important;',
    '  }',
    '',
    '  /* 去掉编辑态装饰：选中框、拖拽阴影、缩放手柄、占位块 */',
    '  .react-grid-item {',
    '    outline: none !important;',
    '    box-shadow: none !important;',
    '    border-color: transparent !important;',
    '    background: transparent !important;',
    '  }',
    '  .react-grid-layout .react-grid-placeholder { display: none !important; }',
    '  .react-resizable-handle { display: none !important; }',
    '}',
  ].join('\n');

  function inject() {
    if (document.querySelector('style[data-rf-print]')) return;
    var st = document.createElement('style');
    st.setAttribute('data-rf-print', '1');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
