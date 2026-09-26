/*!
 * Service Worker 注册脚本 —— 让工具「断网也能打开和编辑」
 *
 * 只在 http / https 下注册（本地双击打开 file:// 时浏览器不允许，自动跳过，不影响使用）。
 * 缓存策略见 sw.js：网络优先、缓存兜底，因此不会出现「改了文件却还看到旧版本」。
 */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (e) {
      // 注册失败不影响任何功能，只是没有离线能力
      console.warn('Service Worker 注册失败（不影响使用）:', e && e.message ? e.message : e);
    });
  });
})();
