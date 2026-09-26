// 改写「帮助」弹窗内容（帮助弹窗由 React 渲染，故在每次渲染后用 MutationObserver 修正，幂等、不改动业务 bundle）
// 1) 注意：删除“欢迎点击右上角查看该开源项目，欢迎STAR”
// 2) 使用规则第九条：老的“请使用Chrome，导出设置如下图所示”+ 旧打印截图已不适用，改为说明现在的本地导出方式
// 3) 删除「MARKDOWN语法」标签页（按钮 + 对应面板），若正停留在该页则自动切回「注意」
// 4) 隐藏旧的 Chrome 打印设置截图（旧流程产物，已不适用）
(function () {
  function patch() {
    var dlg = document.querySelector('.MuiDialog-root, [role=dialog]');
    if (!dlg) return;

    // 1) 删除 STAR/开源项目提醒（它是一个 h3）
    dlg.querySelectorAll('h3').forEach(function (h) {
      if (/STAR|开源项目/.test(h.textContent || '')) {
        h.style.display = 'none';
      }
    });

    // 2) 使用规则是一个 <ol>，第九条（最后一个 <li>）改写
    var ol = dlg.querySelector('ol');
    if (ol) {
      var lis = ol.querySelectorAll('li');
      var last = lis[lis.length - 1];
      if (last && /Chrome|导出设置/.test(last.textContent || '')) {
        last.textContent =
          '在工具栏「导入导出」中可导出 PDF（支持分页 A4 与长图连续两种），或导出图片（PNG 长图）；建议编辑后用「保存到本地」把简历备份成文件。';
      }
    }

    // 3) 删除「MARKDOWN语法」标签页
    var mdTab = null;
    Array.prototype.forEach.call(dlg.querySelectorAll('[role=tab]'), function (t) {
      if (/MARKDOWN/i.test(t.textContent || '')) mdTab = t;
    });
    if (mdTab) {
      // 隐藏该标签按钮（不物理移除：该节点由 React 管理，强行删除会导致 React 卸载时报错崩站）
      // 同时禁掉键盘焦点与无障碍读取，避免 Tab / 方向键落到这个隐藏页上
      mdTab.style.display = 'none';
      mdTab.setAttribute('aria-hidden', 'true');
      mdTab.setAttribute('tabindex', '-1');
      // 隐藏对应的内容面板（含语法表/优先级说明的 TabPanel）
      Array.prototype.forEach.call(dlg.querySelectorAll('.MuiTabPanel-root, [role=tabpanel]'), function (p) {
        if (/语法名|优先级|基本语法/.test(p.textContent || '')) {
          p.style.display = 'none';
        }
      });
      // 若当前正停留在 MARKDOWN 页，自动切回「注意」，避免看到空白面板
      var isSelected = mdTab.getAttribute('aria-selected') === 'true' ||
        /Mui-selected/.test(mdTab.className || '');
      if (isSelected) {
        var firstTab = null;
        Array.prototype.forEach.call(dlg.querySelectorAll('[role=tab]'), function (t) {
          if ((t.textContent || '').trim() === '注意') firstTab = t;
        });
        if (firstTab) firstTab.click();
      }
    }

    // 4) 移除旧的 Chrome 打印设置截图（旧流程产物，图片文件已从项目中删除）
    //    直接摘掉节点而不是隐藏：省一次无谓的图片请求。
    //    （它由 React 渲染，但只是把节点从 DOM 里摘掉、不影响 React 状态，实测无副作用）
    dlg.querySelectorAll('img').forEach(function (im) {
      if (/resume-print-config/i.test(im.src || '')) {
        if (im.parentNode) im.parentNode.removeChild(im);
      }
    });
  }

  function start() {
    patch();
    var mo = new MutationObserver(function () { patch(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
