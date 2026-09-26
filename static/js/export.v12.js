/*!
 * 自定义导出模块（PDF / 图片）
 * 覆盖原站 window.print 为 PDF 导出，并新增导出图片能力
 * 依赖：html2canvas + jspdf（本地 static/js）
 */
(function () {
  'use strict';

  var PDF_EXPORTING = false;

  /* 索隐式颜色同步开关（详见 cleanClone 内的说明）。默认关闭：它按文档顺序索引配对源/克隆元素，
     html2canvas 的克隆树常多出包装元素导致索引错位，会把颜色写到别的元素上。 */
  var RF_INDEX_COLOR_SYNC = false;

  /* ---------- 导出依赖懒加载（首屏性能优化） ----------
     html2canvas + jspdf 合计约 550KB，仅导出时用到；原先在 index.html 内同步加载，
     与首屏渲染抢带宽、占用解析/执行时间。现在：
       1) index.html 已移除这两个 <script>，首屏不再下载/解析这 550KB；
       2) 导出时按需动态加载（ensureLibs），首次导出自动等待就绪；
       3) 页面空闲时后台预取（prefetchLibs），让首次导出依然迅速。 */
  var LIB_SRC = {
    html2canvas: './static/js/html2canvas.min.js',
    jspdf: './static/js/jspdf.umd.min.js'
  };
  var scriptCache = {};
  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { scriptCache[src] = null; reject(new Error('依赖加载失败：' + src)); };
      document.body.appendChild(s);
    });
    return scriptCache[src];
  }
  var libsPromise = null;
  function ensureLibs() {
    if (libsPromise) return libsPromise;
    libsPromise = Promise.all([
      window.html2canvas ? Promise.resolve() : loadScript(LIB_SRC.html2canvas),
      (window.jspdf && window.jspdf.jsPDF) ? Promise.resolve() : loadScript(LIB_SRC.jspdf)
    ]).catch(function (err) { libsPromise = null; throw err; });
    return libsPromise;
  }
  function prefetchLibs() {
    var run = function () { ensureLibs().catch(function () { /* 预取失败静默，导出时仍会重试 */ }); };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 2000);
  }

  /* 轻提示：统一走 rf-common.js，未加载时本地兜底（避免逻辑两份、行为不一致） */
  function toast(msg) {
    if (window.__rf && window.__rf.toast) return window.__rf.toast(msg);
    var old = document.querySelector('.rf-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'rf-toast';
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'background:#1976d2;color:#fff;padding:10px 22px;border-radius:4px;' +
      'font-size:14px;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.25);' +
      'font-family:Times New Roman,sans-serif;transition:opacity .3s';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 200);
  }

  /* 获取简历画布：优先 main 纸张容器（含 padding，内容完整），打印模式下清掉边框阴影 */
  function getResumeEl() {
    var main = document.querySelector('main');
    if (main) return main;
    var el = document.querySelector('.react-grid-layout');
    if (!el) throw new Error('未找到简历画布');
    return el;
  }

  /* html2canvas 克隆清理：去除选中框 / 编辑态网格灰底 + 颜色修复 */
  function cleanClone(cloned) {
    // 清理 main 纸张容器的编辑态样式（对应原站打印模式），并撑开固定高度以完整渲染超长内容
    var mains = cloned.querySelectorAll('main');
    for (var mi = 0; mi < mains.length; mi++) {
      mains[mi].style.border = 'none';
      mains[mi].style.boxShadow = 'none';
      mains[mi].style.margin = '0';
      // 仅当内容确实超过一页（A4 内容区约 998px）时才撑开纸张高度，避免正常一页简历
      // 把上下 padding 也撑进画布导致导出比例偏离 A4；超长内容由此可完整多页导出
      var innerLayout = mains[mi].querySelector('.react-grid-layout');
      if (innerLayout && innerLayout.offsetHeight > 990) {
        mains[mi].style.height = 'auto';
        mains[mi].style.overflow = 'visible';
      }
    }
    var items = cloned.querySelectorAll('.react-grid-item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      it.style.outline = 'none';
      it.style.boxShadow = 'none';
      it.style.background = 'transparent';
      it.style.border = 'none';
    }
    var chosen = cloned.querySelectorAll('.choosen');
    for (var j = 0; j < chosen.length; j++) {
      chosen[j].className = chosen[j].className.replace(/choosen/g, '');
    }
    // 修复：克隆文档样式表顺序/内容与原文档不一致，且 JSS 主题色规则通过 CSSOM insertRule
    // 动态注入（style.textContent 读不到），导致克隆后板块标题、名字等元素颜色不对，
    // 改主题色时导出也无法跟随。这里把原文档所有 stylesheet 的 cssRules 完整复制到克隆：
    // 先清空克隆自带 style，再按原文档顺序逐 sheet insertRule，克隆样式与原文档完全一致。
    try {
      cloned.querySelectorAll('style').forEach(function (s) {
        if (s.parentNode) s.parentNode.removeChild(s);
      });
      var sheets = document.styleSheets;
      for (var si = 0; si < sheets.length; si++) {
        var copy = cloned.createElement('style');
        (cloned.head || cloned.body).appendChild(copy);
        try {
          var rules = sheets[si].cssRules;
          for (var ri = 0; ri < rules.length; ri++) {
            try { copy.sheet.insertRule(rules[ri].cssText, copy.sheet.cssRules.length); } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error('样式表复制异常:', e);
    }

    // 颜色修复：把原文档每个元素的计算颜色同步到克隆文档（覆盖 html2canvas 克隆样式丢失）
    // ⚠️ 该实现按「文档顺序索引」配对源/克隆元素，而 html2canvas 的克隆树常比原树多出包装元素，
    //    索引会整体错位，把颜色写到别的元素上（实测 7 个板块标题里 6 个被染成 #aeaeae 灰色）。
    //    默认关闭，改由「按节点身份精确同步」处理（见下方 syncColorsByIdentity）。
    if (RF_INDEX_COLOR_SYNC) try {
      var srcEls = document.querySelectorAll('.react-grid-layout *');
      var dstEls = cloned.querySelectorAll('.react-grid-layout *');
      var n = Math.min(srcEls.length, dstEls.length);
      var cwin = cloned.defaultView;
      var sides = ['Top', 'Right', 'Bottom', 'Left'];
      for (var k = 0; k < n; k++) {
        var s = srcEls[k], d = dstEls[k];
        if (s.nodeType !== 1) continue;
        var scs = getComputedStyle(s);
        var dcs = cwin.getComputedStyle(d);
        var color = scs.color;
        if (color && color !== 'rgb(0, 0, 0)' && color !== 'rgba(0, 0, 0, 0)' && dcs.color !== color) {
          d.style.color = color;
        }
        var bg = scs.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && dcs.backgroundColor !== bg) {
          d.style.backgroundColor = bg;
        }
        var bgImg = scs.backgroundImage;
        if (bgImg && bgImg !== 'none' && dcs.backgroundImage !== bgImg) {
          d.style.backgroundImage = bgImg;
        }
        // 补充：同步可见边框（板块分割线等 border 类装饰在克隆里可能丢失）
        for (var bi = 0; bi < sides.length; bi++) {
          var side = sides[bi];
          var bw = scs['border' + side + 'Width'];
          if (bw && bw !== '0px' && scs['border' + side + 'Style'] !== 'none') {
            d.style['border' + side + 'Width'] = bw;
            d.style['border' + side + 'Style'] = scs['border' + side + 'Style'];
            d.style['border' + side + 'Color'] = scs['border' + side + 'Color'];
          }
        }
      }
    } catch (e) {
      console.error('颜色修复异常:', e);
    }

    // 分割线 hr 背景专项同步：上面按 '.react-grid-layout *' 全量索引同步颜色时，
    // html2canvas 克隆出的元素数可能多于原文档（包装元素），造成索引错位，
    // 使黑色横线/竖线 hr 的背景被错误覆盖成透明（带 code 的主题色线因有 CSS 规则兜底才正常）。
    // hr 在原文档与克隆中数量、顺序完全一致，这里按文档顺序逐一校正背景色，
    // 只改 hr 背景，不动其它元素与尺寸。
    try {
      var srcHrs = document.querySelectorAll('.react-grid-layout hr');
      var dstHrs = cloned.querySelectorAll('.react-grid-layout hr');
      for (var hi = 0; hi < Math.min(srcHrs.length, dstHrs.length); hi++) {
        var hbg = getComputedStyle(srcHrs[hi]).backgroundColor;
        if (hbg && hbg !== 'rgba(0, 0, 0, 0)' && hbg !== 'transparent') {
          dstHrs[hi].style.backgroundColor = hbg;
        }
      }
    } catch (e) {
      console.error('分割线hr颜色修复异常:', e);
    }

    // 分割线格子包裹层背景校正：上面按 '.react-grid-layout *' 全量索引同步颜色时，
    // html2canvas 克隆出的元素数可能多于原文档，索引错位会把黑色背景错误写到分割线
    // 格子的 section 包裹层上（该层被格子高度拉伸），导出就形成一个黑色方块。
    // 分割线的颜色只体现在 hr 上，其 section/ins/strong/code/mark 包裹层本应全透明，
    // 这里统一校正为透明（hr 背景已在上方按文档顺序单独同步，不受影响）。只作用于分割线格子。
    try {
      var lineItems = cloned.querySelectorAll('.react-grid-item');
      for (var li = 0; li < lineItems.length; li++) {
        if (!lineItems[li].querySelector('hr')) continue;
        var wraps = lineItems[li].querySelectorAll('section, ins, strong, code, mark');
        for (var wi = 0; wi < wraps.length; wi++) {
          wraps[wi].style.backgroundColor = 'transparent';
          wraps[wi].style.backgroundImage = 'none';
        }
      }
    } catch (e) {
      console.error('分割线包裹层背景校正异常:', e);
    }

    // 板块分割线修复：
    // 原线是 blockquote::before（position:absolute; top:22px; width:690px; 1px 灰线），
    // 相对上层 .react-grid-item（position:absolute）定位。html2canvas 对部分动态替换过的
    // blockquote 伪元素不渲染（专业技能丢线）。这里统一：隐藏所有 ::before，在每个标题所在
    // grid item 内插入一个几何完全一致的绝对定位真实 div。绝对定位不占文档流，不破坏 grid 排版。
    try {
      var hideBf = cloned.createElement('style');
      hideBf.textContent = '.react-grid-layout blockquote::before { content: none !important; }';
      (cloned.head || cloned.body).appendChild(hideBf);

      var bqs = cloned.querySelectorAll('.react-grid-layout blockquote');
      for (var bi = 0; bi < bqs.length; bi++) {
        var bq = bqs[bi];
        // 读原文档对应伪元素的颜色/宽度/高度（克隆里读也可），默认值与模板一致
        var bfColor = 'rgb(73, 73, 73)', bfW = '690px', bfH = '1px', bfTop = '22px', bfLeft = '0px';
        var item = bq;
        while (item && !item.classList.contains('react-grid-item')) item = item.parentElement;
        if (!item) continue;
        // 若原 blockquote 没有 ::before 线则跳过（content:none）
        var origBq = null;
        try {
          var allOrig = document.querySelectorAll('.react-grid-layout blockquote');
          // 按文本匹配原文档对应 blockquote
          for (var oi = 0; oi < allOrig.length; oi++) {
            if (allOrig[oi].textContent.trim() === bq.textContent.trim()) { origBq = allOrig[oi]; break; }
          }
        } catch (e) {}
        if (origBq) {
          var obf = getComputedStyle(origBq, '::before');
          if (obf.content === 'none' || obf.height === 'auto') continue;
          bfColor = obf.backgroundColor; bfW = obf.width; bfH = obf.height; bfTop = obf.top; bfLeft = obf.left;
        }
        var line = cloned.createElement('div');
        line.setAttribute('data-rf-line', '1');
        line.style.cssText =
          'position:absolute;top:' + bfTop + ';left:' + bfLeft + ';width:' + bfW +
          ';height:' + bfH + ';background:' + bfColor +
          ';pointer-events:none;z-index:1;';
        item.appendChild(line);
      }
    } catch (e) {
      console.error('分割线修复异常:', e);
    }
  }

  /* A4 纸设计宽度（210mm @96dpi ≈ 794 CSS px）。简历网格按此宽度排版（满宽格 690px）。
     当浏览器窗口较窄时纸张会被压缩、而网格仍是设计宽度，导致右侧内容溢出被截图裁掉。
     截图前临时把纸张固定为 A4 宽度并等待网格重排，截图后恢复，保证任何窗口下导出都完整。 */
  var A4_OUTER_W = 794;

  function prepareA4(el) {
    var layout = el.querySelector ? el.querySelector('.react-grid-layout') : null;
    if (!layout) return Promise.resolve(null);
    var cs = getComputedStyle(el);
    var pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var contentW = cs.boxSizing === 'border-box' ? A4_OUTER_W : A4_OUTER_W - pad;
    var prev = { width: el.style.width, minWidth: el.style.minWidth };
    el.style.width = contentW + 'px';
    el.style.minWidth = contentW + 'px';
    return new Promise(function (resolve) {
      var n = 0;
      function tick() {
        window.dispatchEvent(new Event('resize'));
        n++;
        var er = el.getBoundingClientRect();
        var maxRight = -1e9, maxW = 0;
        var items = el.querySelectorAll('.react-grid-item');
        for (var i = 0; i < items.length; i++) {
          var r = items[i].getBoundingClientRect();
          if (r.right > maxRight) maxRight = r.right;
          if (r.width > maxW) maxW = r.width;
        }
        // 就绪：内容区达到设计宽度（>=700）、满宽格回到 ~690、且无右侧溢出
        var ready = layout.offsetWidth >= 700 && maxW >= 685 && maxW <= 696 && maxRight <= er.right + 1;
        if (ready || n >= 30) resolve(prev);
        else setTimeout(tick, 60);
      }
      tick();
    });
  }

  function restoreA4(el, prev) {
    if (!prev) return;
    el.style.width = prev.width;
    el.style.minWidth = prev.minWidth;
    window.dispatchEvent(new Event('resize'));
  }

  /* 裁掉 canvas 底部纯空白（纸张 main 自带较大的下 padding，分页时会被切到下一页形成空白尾页，
     长图/PNG 末尾也会留下一条大白边）。只裁底部，顶部天头与左右设计留白保持不动。
     底部保留约 8mm 呼吸量。返回（可能新建的）canvas。 */
  function trimBottom(canvas, scale) {
    try {
      var w = canvas.width, h = canvas.height;
      var ctx = canvas.getContext('2d');
      var data = ctx.getImageData(0, 0, w, h).data;
      function rowHasInk(y) {
        for (var x = 0; x < w; x += 2) {
          var i = (y * w + x) * 4;
          if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return true;
        }
        return false;
      }
      var last = h - 1;
      while (last > 0 && !rowHasInk(last)) last--;
      var keep = Math.round((scale || 2) * 30); // ≈8mm
      var effH = Math.min(h, last + 1 + keep);
      if (effH >= h - 2) return canvas;
      var c = document.createElement('canvas');
      c.width = w; c.height = effH;
      c.getContext('2d').drawImage(canvas, 0, 0, w, effH, 0, 0, w, effH);
      return c;
    } catch (e) { return canvas; }
  }

  function renderCanvas(opts) {
    var el = getResumeEl();
    var scale = opts && opts.scale ? opts.scale : 2;
    // 先取消选中，避免焦点框残留
    if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch (e) {}
    }
    var conf = {
      scale: scale,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      allowTaint: true,
      onclone: cleanClone,
      imageTimeout: 0
    };
    // 等字体就绪再截图：html2canvas 自己量文字宽度，若用了回退字体就会出现字宽/字形偏差
    var fontsReady = (document.fonts && document.fonts.ready)
      ? document.fonts.ready.catch(function () {}) : Promise.resolve();
    return fontsReady.then(function () { return prepareA4(el); }).then(function (prev) {
      return html2canvas(el, conf).then(
        function (canvas) { var c2 = trimBottom(canvas, scale); restoreA4(el, prev); return c2; },
        function (err) { restoreA4(el, prev); throw err; }
      );
    });
  }

  /* ---------- 导出方式选择弹窗：分页（打印用，每页 A4）/ 长图（线上用，连续一页） ---------- */
  function showExportModeDialog() {
    return new Promise(function (resolve) {
      var old = document.querySelector('.rf-export-mode-dialog');
      if (old) old.remove();
      var overlay = document.createElement('div');
      overlay.className = 'rf-export-mode-dialog';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;' +
        'display:flex;align-items:center;justify-content:center;font-family:Times New Roman,sans-serif;';
      var box = document.createElement('div');
      box.style.cssText =
        'background:#fff;border-radius:8px;padding:22px 26px;width:400px;max-width:90vw;' +
        'box-shadow:0 10px 36px rgba(0,0,0,.32);';
      var title = document.createElement('div');
      title.textContent = '导出 PDF';
      title.style.cssText = 'font-size:18px;font-weight:bold;color:#222;margin-bottom:4px;';
      var sub = document.createElement('div');
      sub.textContent = '请选择导出方式';
      sub.style.cssText = 'font-size:13px;color:#888;margin-bottom:16px;';
      box.appendChild(title);
      box.appendChild(sub);

      function makeBtn(label, desc, primary) {
        var b = document.createElement('button');
        b.style.cssText =
          'display:block;width:100%;box-sizing:border-box;text-align:left;padding:11px 14px;margin-bottom:10px;' +
          'border-radius:6px;cursor:pointer;font-family:inherit;font-size:14px;' +
          'border:1px solid ' + (primary ? '#1976d2' : '#d9d9d9') + ';' +
          'background:' + (primary ? '#eaf4fd' : '#fff') + ';';
        var l = document.createElement('div');
        l.textContent = label;
        l.style.cssText = 'font-weight:bold;color:' + (primary ? '#1976d2' : '#333');
        var d = document.createElement('div');
        d.textContent = desc;
        d.style.cssText = 'font-size:12px;color:#888;margin-top:3px;line-height:1.5;';
        b.appendChild(l);
        b.appendChild(d);
        return b;
      }

      function close(choice) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(choice);
      }
      var bVec = makeBtn('矢量 PDF（最清晰 · 推荐打印 / 存档）',
        '调用浏览器打印，生成真正的「文字版」PDF：字体、颜色与编辑区完全一致，可选中可搜索，放大不模糊，文件也更小。' +
        '在弹出的打印窗口里把「目标打印机」选为「另存为 PDF」，再点保存即可。', true);
      var bPage = makeBtn('图片 PDF（一键下载 · 分页 A4）',
        '点击即下载，不需要任何设置。每页为标准 A4 纸，按内容自然分页；文字为高清位图（约 288 dpi）', false);
      var bLong = makeBtn('图片 PDF（一键下载 · 长图连续）',
        '点击即下载。整张简历连续一页，高度随内容变化，适合屏幕查看与文件传阅', false);
      bVec.onclick = function () { close('vector'); };
      bPage.onclick = function () { close('paginated'); };
      bLong.onclick = function () { close('long'); };
      box.appendChild(bVec);
      box.appendChild(bPage);
      box.appendChild(bLong);
      overlay.appendChild(box);
      overlay.onclick = function (e) { if (e.target === overlay) close(null); };
      document.body.appendChild(overlay);
    });
  }

  /* ---------- 矢量 PDF：走浏览器原生打印，产出真正的「文字版」PDF ----------
     位图导出（html2canvas）本质是把网页拍成一张图，字体形状、清晰度、颜色都必然有损；
     只有浏览器自带的打印排版才能输出矢量文字。打印版式由 static/js/print-css.js 提供。
     代价：浏览器不允许静默生成 PDF，需要用户在打印窗口里选「另存为 PDF」再保存。 */
  function exportVectorPDF() {
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* 忽略 */ }
    toast('已打开打印窗口：请把「目标打印机」选为「另存为 PDF」后保存');
    setTimeout(function () {
      try {
        (origPrint || window.print).call(window);
      } catch (e) {
        toast('打开打印窗口失败：' + (e && e.message ? e.message : e));
      }
    }, 350);
  }

  /* ---------- 导出 PDF（覆盖原站 window.print） ---------- */
  function exportPDF() {
    if (PDF_EXPORTING) return;
    showExportModeDialog().then(function (mode) {
      if (!mode) return; // 用户取消
      if (mode === 'vector') { exportVectorPDF(); return; }
      if (PDF_EXPORTING) return;
      PDF_EXPORTING = true;
      toast('正在准备导出组件…');
      ensureLibs()
        // scale 3：A4 宽 210mm 下约 288dpi，达到印刷常用精度
        .then(function () { toast('正在导出 PDF…'); return renderCanvas({ scale: 3 }); })
        .then(function (canvas) {
          var jsPDF = window.jspdf && window.jspdf.jsPDF;
          if (!jsPDF) throw new Error('jsPDF 未加载');
          var imgW = 188; // 内容宽 mm
          var imgH = canvas.height * imgW / canvas.width; // 完整内容高 mm

          if (mode === 'long') {
            // 长图：单页连续，页面尺寸 = 内容实际尺寸（188mm 宽，高度随内容），线上查看
            var pdfLong = new jsPDF({ unit: 'mm', format: [imgW, imgH], orientation: 'portrait', compress: true });
            // 用 PNG 而非 JPEG：文字是细笔画，JPEG 的色度二次采样会让蓝色标题/标签去饱和、边缘发暗，
            // 实测换成 PNG 体积几乎不变（1167KB vs 1150KB），却完全没有压缩伪影。
            pdfLong.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, imgH);
            pdfLong.save('resume.pdf');
          } else {
            // 分页：标准 A4（210x297mm）。内容横向铺满纸宽——简历纸张 main 自身左右
            // padding（约11mm）即边缘留白，与长图导出一致，不再额外叠加左右白边导致显空；
            // 仅上下保留小边距，避免跨页处内容贴着纸边被打印机裁切。
            var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
            var pageW = 210, pageH = 297;
            var mx = 0, my = 8;
            var pW = pageW - mx * 2;                    // 内容铺满 A4 宽
            var pH = canvas.height * pW / canvas.width; // 完整内容高(mm)
            var ratio = pW / canvas.width;              // px -> mm
            var pos = 0, first = true;
            while (pos < pH - 0.5) {
              var sliceH, yOff;
              if (first) { sliceH = Math.min(pageH - my, pH - pos); yOff = 0; } // 首页顶部靠纸张自身天头留白
              else { sliceH = Math.min(pageH - my * 2, pH - pos); yOff = my; }
              if (!first) pdf.addPage();
              var srcY = Math.round(pos / ratio);
              var srcH = Math.round(sliceH / ratio);
              if (srcY + srcH > canvas.height) srcH = canvas.height - srcY;
              var slice = document.createElement('canvas');
              slice.width = canvas.width;
              slice.height = srcH;
              slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
              pdf.addImage(slice.toDataURL('image/png'), 'PNG', mx, yOff, pW, sliceH);
              pos += sliceH;
              first = false;
            }
            pdf.save('resume.pdf');
          }
          PDF_EXPORTING = false;
          toast('PDF 导出成功');
        })
        .catch(function (err) {
          PDF_EXPORTING = false;
          console.error('PDF 导出失败:', err);
          toast('PDF 导出失败：' + (err && err.message ? err.message : err));
        });
    });
  }

  /* ---------- 导出图片 PNG ---------- */
  function exportImage() {
    toast('正在准备导出组件…');
    ensureLibs()
      // scale 4：A4 宽下约 383dpi，屏幕放大查看也不发虚
      .then(function () { toast('正在导出图片…'); return renderCanvas({ scale: 4 }); })
      .then(function (canvas) {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('图片生成失败'));
          }, 'image/png');
        });
      })
      .then(function (blob) {
        download(blob, 'resume.png');
        toast('图片导出成功');
      })
      .catch(function (err) {
        console.error('图片导出失败:', err);
        toast('图片导出失败：' + (err && err.message ? err.message : err));
      });
  }

  /* 覆盖原站 window.print：点击“导出PDF”后原站会调用它 */
  var origPrint = window.print;
  window.print = function () {
    exportPDF();
  };

  window.__exportPdf = exportPDF;
  window.__exportImage = exportImage;

  /* 空闲后台预取导出依赖：兼顾首屏速度与首次导出体验 */
  prefetchLibs();
})();
