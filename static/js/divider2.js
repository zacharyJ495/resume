/*!
 * 分割线（横线）垂直居中模块
 * 工具栏「分割线」插入的横线 DOM 为 section>section>[strong/code]>ins>hr，
 * 包裹层 ins/strong/code 会把 hr 顶在网格框的顶部；当网格被拖高时横线停在最上方。
 *
 * 四种横线（横线/加粗/主题色/加粗主题色）都是 ins>hr，ins 的父级分别是
 * section / strong / code / code>strong。让 ins 相对所在网格（.react-grid-item，
 * 本身 position:absolute，即定位上下文）绝对定位到垂直中点即可，
 * ins 脱离文档流不影响网格高度（高度由拖拽内联样式决定），也不会被 flex 拉伸，
 * 从而避免 html2canvas 把黑色背景 hr 拉伸成黑块。
 *
 * 竖线（mark>hr）不在此列，保持原样。
 * 样式注入文档后，导出 cleanClone 复制 cssRules 时会一并带入，导出同样居中。
 */
(function () {
  'use strict';

  var CSS = [
    /* 横线分割线：直接包裹 hr 的 ins 绝对定位到网格垂直中点 */
    '.react-grid-layout .react-grid-item ins:has(> hr) {',
    '  position: absolute;',
    '  top: 50%;',
    '  left: 0;',
    '  width: 100%;',
    '  transform: translateY(-50%);',
    '}'
  ].join('\n');

  function inject() {
    if (document.querySelector('style[data-divider-center]')) return;
    var st = document.createElement('style');
    st.setAttribute('data-divider-center', '1');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
