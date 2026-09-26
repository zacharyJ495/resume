/*!
 * 彻底移除 Markdown 编辑模式，只保留普通（所见即所得）模式。
 * 业务逻辑在压缩 bundle 中，无法安全物理剥离 Markdown 模块（会破坏整站），
 * 因此从「用户可见、可切换」层面彻底移除：
 *   1) 启动即锁死普通模式（markdownMode 强制 false）；
 *   2) 工具栏「切换模式」按钮隐藏；
 *   3) 菜单项里的「Markdown模式」隐藏（双保险）；
 *   4) 页面标题文字「Markdown简历」→「简历」。
 *
 * 为什么改：原实现每次 DOM 变动都对整篇文档做三次全量 querySelectorAll
 *         （所有 button、所有 li/[role=menuitem]、所有 span），简历编辑时 DOM 变动频繁，
 *         这会造成大量无谓遍历。现改为「变更节点增量处理」：
 *         只检查本次新增/改动的节点及其父节点；仅当新增了整棵子树时才对该子树做一次范围扫描。
 *         看到的最终效果与原来完全一致。
 */
(function () {
  'use strict';

  function hide(el) {
    if (el && el.style.display !== 'none') el.style.display = 'none';
  }

  /* 判断单个元素是否需要处理；命中则就地修正 */
  function patchEl(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.tagName;

    // 工具栏「切换模式」按钮
    if (tag === 'BUTTON') {
      if (el.title === '切换模式') hide(el);
      return;
    }

    // 标题「Markdown简历」→「简历」（仅处理纯文本叶子 span）
    if (tag === 'SPAN') {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'Markdown简历') {
        el.textContent = '简历';
      }
      return;
    }

    // 菜单项「Markdown模式」
    if (tag === 'LI' || el.getAttribute('role') === 'menuitem' ||
      (typeof el.className === 'string' && el.className.indexOf('MuiMenuItem-root') > -1)) {
      if ((el.textContent || '').trim() === 'Markdown模式') hide(el);
    }
  }

  /* 范围扫描：只在初始化、或新增了整棵子树时使用 */
  function sweep(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('button').forEach(patchEl);
    root.querySelectorAll('span').forEach(patchEl);
    root.querySelectorAll('li,[role=menuitem],.MuiMenuItem-root').forEach(patchEl);
  }

  function onMutations(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'characterData') {
        patchEl(m.target.parentElement);
        continue;
      }
      var added = m.addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) {
          if (n.nodeType === 3) patchEl(n.parentElement); // 文本节点变动（改标题文字走这里）
          continue;
        }
        patchEl(n);
        if (n.childElementCount > 0) sweep(n); // 新增了一棵子树，才做一次范围扫描
      }
    }
  }

  function start() {
    // 首屏做一次全量扫描兜底
    sweep(document.body);
    // 之后只处理增量
    new MutationObserver(onMutations).observe(document.body, {
      childList: true, subtree: true, characterData: true,
    });
    // React 首次挂载可能晚于本脚本，补两次定点扫描
    setTimeout(function () { sweep(document.body); }, 600);
    setTimeout(function () { sweep(document.body); }, 2000);
  }

  // 1) 锁死普通模式：若曾处于 Markdown 模式，改回普通并刷新一次
  try {
    if (localStorage.getItem('markdownMode') === 'true') {
      localStorage.setItem('markdownMode', 'false');
      location.reload();
      return;
    }
  } catch (e) { /* 忽略 */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
