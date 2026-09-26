// 隐藏原作者 GitHub 仓库入口（右上角的 GitHub 图标链接）
// 该链接由 React 渲染，用 CSS 隐藏最稳妥：React 重渲染后样式依然生效，且不改动压缩后的业务 bundle。
(function () {
  function inject() {
    if (document.querySelector('style[data-hide-github]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-hide-github', '');
    s.textContent =
      'a[href*="guanpengchn/markdown-resume"]{display:none !important;}';
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
