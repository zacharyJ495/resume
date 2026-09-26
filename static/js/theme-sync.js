/*!
 * 主题色同步模块（事件驱动版）
 *
 * 做什么：原站切换全局主题色时，JSS 只更新 <code> 元素颜色；用户手动用油漆桶按钮设过色的
 *         文字是 <font color="..."> 标签，颜色硬编码，不随主题色变化。本模块把它们同步成新主题色，
 *         并把板块标题里的 <font> 换回 <code>（恢复分割线样式），同时更新 mobx store 持久化。
 *
 * 为什么改：原实现用 setInterval(..., 500) 永久轮询，每秒 2 次读取 <code> 的计算样式并全量遍历
 *         <font>。实测默认模板里 <font> 数量为 0，这个轮询绝大多数时间在做无用功，且让页面永不空闲。
 *         现改为：
 *           1) 主题切换一定是「点击色块」触发的 → 点击后定点复查（含延迟复查，等 JSS 生效）；
 *           2) 监听 <head> 的样式变化（JSS 注入 / 改写 <style> 时触发）；
 *           3) 保留一个低频兜底（1.5s），且页面在后台时直接跳过（document.hidden）；
 *           4) 缓存 <code> 元素引用，避免每轮 querySelector。
 *         对外行为与原来一致，只是不再空转。
 */
(function () {
  'use strict';

  var RF = window.__rf || {};
  var lastColor = null;
  var cachedCode = null;

  function rgbToHex(rgbStr) {
    var m = String(rgbStr || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    var r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10);
    return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  /* 页面上的 <code> 元素（主题色载体）；缓存并校验仍在文档中 */
  function getCodeEl() {
    if (cachedCode && cachedCode.isConnected) return cachedCode;
    cachedCode = document.querySelector('.react-grid-layout code');
    return cachedCode;
  }

  function syncFontColors(newColor) {
    if (!newColor) return;
    var hex = rgbToHex(newColor);
    if (!hex) return;
    var fonts = document.querySelectorAll('.react-grid-layout font');
    for (var i = 0; i < fonts.length; i++) fonts[i].color = hex;
  }

  function syncStore() {
    try {
      var stores = RF.findStores ? RF.findStores() : null;
      if (!stores || !stores.resume || !stores.resume.layout) return;
      var code = getCodeEl();
      if (!code) return;
      var newHex = rgbToHex(getComputedStyle(code).color);
      if (!newHex) return;
      var layout = stores.resume.layout;
      for (var i = 0; i < layout.length; i++) {
        var item = layout[i];
        if (!item.value) continue;
        var old = item.value;
        var next = old.replace(/<font\s+color=["']?#[0-9a-fA-F]{6}["']?\s*>/gi, function (match) {
          return match.replace(/#[0-9a-fA-F]{6}/i, newHex);
        });
        if (next !== old) item.value = next;
      }
    } catch (e) {
      console.error('主题色同步 store 异常:', e);
    }
  }

  /* 板块标题里的 <font> 换成 <code>：模板设计里板块标题用 <code>（带分割线样式），
     用户手动设色后会变成 <font> 导致分割线丢失。 */
  function fixSectionTitles() {
    var fonts = document.querySelectorAll('.react-grid-layout blockquote h2 font');
    for (var i = 0; i < fonts.length; i++) {
      var f = fonts[i];
      var code = document.createElement('code');
      code.textContent = f.textContent;
      if (f.parentNode) f.parentNode.replaceChild(code, f);
    }
  }

  /* 复查：读一次主题色，变了才同步 */
  function check() {
    var code = getCodeEl();
    if (!code) {
      cachedCode = null;
      return;
    }
    var color;
    try { color = getComputedStyle(code).color; } catch (e) { return; }
    if (color && color !== lastColor) {
      lastColor = color;
      syncFontColors(color);
      syncStore();
    }
  }

  var pending = false;
  function scheduleCheck() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; check(); });
  }

  function init() {
    setTimeout(fixSectionTitles, 1000);
    // 首次建立基线颜色（同时把已有 <font> 校正到当前主题色）
    setTimeout(check, 1200);

    // 1) 主题色切换来自点击色块
    document.addEventListener('click', function () {
      scheduleCheck();
      setTimeout(check, 120);   // 等 JSS 应用
      setTimeout(check, 420);   // 再补一次，覆盖较慢的渲染
    }, true);

    // 2) JSS 注入 / 改写 <style> 时也复查
    try {
      var head = document.head || document.documentElement;
      new MutationObserver(scheduleCheck).observe(head, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* 忽略 */ }

    // 3) 低频兜底，页面在后台时完全跳过
    setInterval(function () {
      if (document.hidden) return;
      check();
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
