/*!
 * 自定义本地上传照片模块
 * 原站工具栏"图片"按钮把照片上传到 cors-anywhere + sm.ms 在线图床（公共代理与旧 API
 * 均已失效，故无法上传）。本模块在事件捕获阶段拦截 #uploadImage 的 change 事件，
 * 改为纯本地处理：FileReader 读取 -> Canvas 等比压缩（并按 EXIF 自动纠正方向）
 * -> 以 data URL 写入当前选中格子（与模板自带头像的数据格式完全一致），
 * 随后同步 mobx store 与 localStorage，页面显示、刷新、导出 PDF/图片均正常。
 * 照片不会上传到任何服务器，完全离线可用。
 */
(function () {
  'use strict';

  var MAX_WIDTH = 600;   // 压缩后最大宽度（px），头像显示约 107px，600px 足够高清导出
  var JPEG_QUALITY = 0.9;
  var LAYOUT_KEY = 'layout';

  /* 轻提示：统一走 rf-common.js，未加载时本地兜底（原来与 export.v12.js 各写一份） */
  function toast(msg, isError) {
    if (window.__rf && window.__rf.toast) return window.__rf.toast(msg, isError);
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
  }

  /* 查找 mobx store：统一走 rf-common.js（原来与 theme-sync.js 各写一份）
     needLayout=true 保持本模块原有语义：必须找到带 layout 的 store */
  function findStores() {
    if (window.__rf && window.__rf.findStores) return window.__rf.findStores(true);
    return null;
  }

  function findChosenKey(stores) {
    if (stores && stores.resume && stores.resume.choosenKey) return stores.resume.choosenKey;
    var ae = document.activeElement;
    if (ae && ae.id && ae.classList && ae.classList.contains('react-grid-item')) return ae.id;
    return '';
  }

  /* Canvas 绘制（含白底，避免透明 PNG 转 JPEG 发黑） */
  function drawToDataUrl(source, naturalW, naturalH) {
    var scale = Math.min(1, MAX_WIDTH / naturalW);
    var tw = Math.max(1, Math.round(naturalW * scale));
    var th = Math.max(1, Math.round(naturalH * scale));
    var cv = document.createElement('canvas');
    cv.width = tw;
    cv.height = th;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(source, 0, 0, tw, th);
    return cv.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  /* 读取本地图片并压缩为 data URL；优先 createImageBitmap 自动纠正 EXIF 方向 */
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (window.createImageBitmap) {
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then(function (bmp) {
            try {
              resolve(drawToDataUrl(bmp, bmp.width, bmp.height));
              if (bmp.close) bmp.close();
            } catch (err) { reject(err); }
          })
          .catch(function () { decodeViaImage(file, resolve, reject); });
      } else {
        decodeViaImage(file, resolve, reject);
      }
    });
  }

  function decodeViaImage(file, resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        try { resolve(drawToDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height)); }
        catch (err) { reject(err); }
      };
      img.onerror = function () { reject(new Error('图片解码失败')); };
      img.src = fr.result;
    };
    fr.onerror = function () { reject(new Error('文件读取失败')); };
    fr.readAsDataURL(file);
  }

  function persist(stores, key, isMarkdownMode, md, html) {
    var layout = stores && stores.resume && stores.resume.layout;
    if (layout) {
      var item = null;
      for (var i = 0; i < layout.length; i++) {
        if (layout[i].i === key) { item = layout[i]; break; }
      }
      if (item) {
        item.value = md;
        if (!isMarkdownMode) item.origin = html;
      }
      // Markdown 模式交给原站方法完成 marked 转换（origin）与持久化
      if (isMarkdownMode && typeof stores.resume.updateResume === 'function') {
        try { stores.resume.updateResume(); } catch (e) { /* 失败则下方手动写 localStorage */ }
      }
      try {
        window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch (e) {
        // 一般是体积超限
        throw new Error('照片保存失败（本地存储空间可能不足）');
      }
    }
  }

  function handleUpload(file, input) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件', true); input.value = ''; return; }

    var stores = findStores();
    var key = findChosenKey(stores);
    if (!key) {
      toast('请先点击选中要放置照片的格子', true);
      input.value = '';
      return;
    }
    var cell = document.getElementById(key);
    if (!cell || !cell.childNodes.length) {
      toast('未找到选中的格子', true);
      input.value = '';
      return;
    }
    var isMarkdownMode = stores && stores.navbar && stores.navbar.isMarkdownMode;

    toast('正在处理照片…');
    fileToDataUrl(file)
      .then(function (dataUrl) {
        var md = '![avatar](' + dataUrl + ')';
        var html = '<section><p><img src="' + dataUrl + '" alt="avatar"></p></section>';
        if (isMarkdownMode) {
          cell.childNodes[0].innerText = md;
          cell.setAttribute('data-markdown', md);
        } else {
          cell.childNodes[0].innerHTML = html;
          cell.setAttribute('data-origin', html);
        }
        persist(stores, key, isMarkdownMode, md, html);
        toast('照片上传成功');
      })
      .catch(function (err) {
        console.error('照片上传失败:', err);
        toast('照片上传失败：' + (err && err.message ? err.message : err), true);
      })
      .then(function () { input.value = ''; }); // 允许再次选择同一文件
  }

  /* 捕获阶段拦截原站的文件选择 change 事件（React 16 在 document 冒泡阶段委托，可被阻止） */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.id !== 'uploadImage') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var file = t.files && t.files[0];
    handleUpload(file, t);
  }, true);

  window.__localAvatarUpload = { version: '1.0' };
})();
