/*!
 * 公共工具模块（各补丁脚本共享）
 *
 * 背景：toast() 原先在 export.v12.js / upload.js 各写了一份；
 *       沿 React fiber 查找 mobx store 的逻辑在 theme-sync.js / upload.js 各写了一份。
 *       这里合并为唯一实现，避免多处维护、行为不一致。
 *
 * 加载顺序：必须在其它补丁脚本之前加载（见 index.html）。
 */
(function () {
  'use strict';

  var RF = window.__rf = window.__rf || {};

  /* 统一轻提示：默认蓝底，isError=true 时红底 */
  RF.toast = function (msg, isError) {
    var old = document.querySelector('.rf-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'rf-toast';
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'background:' + (isError ? '#d32f2f' : '#1976d2') + ';color:#fff;padding:10px 22px;border-radius:4px;' +
      'font-size:14px;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.25);' +
      'font-family:Times New Roman,sans-serif;transition:opacity .3s';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  };

  /* 沿 React 16 内部 fiber 向上查找注入了 resume / navbar 的组件实例。
     needLayout=true 时要求 resume.layout 存在（保持 upload.js 原有语义）。 */
  RF.findStores = function (needLayout) {
    var cell = document.querySelector('.react-grid-item');
    if (!cell) return null;
    var fk = null;
    var keys = Object.keys(cell);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactInternalInstance') === 0) { fk = keys[i]; break; }
    }
    if (!fk) return null;
    var fiber = cell[fk], hops = 0;
    while (fiber && hops < 80) {
      var sn = fiber.stateNode;
      if (sn && sn.props && sn.props.resume && (!needLayout || sn.props.resume.layout)) {
        return { resume: sn.props.resume, navbar: sn.props.navbar };
      }
      fiber = fiber.return;
      hops++;
    }
    return null;
  };

  /* 把工作推迟到空闲时段；任何异常都不外抛 */
  RF.onIdle = function (fn, timeout) {
    var run = function () { try { fn(); } catch (e) { /* 静默 */ } };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: timeout || 4000 });
    else setTimeout(run, Math.min(timeout || 4000, 2000));
  };
})();
