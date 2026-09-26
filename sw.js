/*!
 * Service Worker —— 离线可用
 *
 * 策略：**网络优先，缓存兜底**。联网时永远拿最新文件，断网时用缓存打开。
 *       这样既保证「离线也能打开和编辑简历」，又绝不会出现「改了文件却还看到旧版本」。
 *       （若你更想要「二次访问秒开」，可把 fetch 里的 networkFirst 换成 staleWhileRevalidate，
 *        代价是部署后第一访问可能仍是旧版本。）
 *
 * 缓存清单在安装时一次性写入，因此首次访问后即可完全离线使用。
 * 改完文件后：把下面的 VERSION 改一个值（如 v2、v3），旧的缓存会在激活时自动清除。
 */
var VERSION = 'rf-v1';
var CACHE = 'rf-cache-' + VERSION;

var PRECACHE = [
  "./favicon.ico",
  "./index.html",
  "./manifest.json",
  "./static/js/2.8990afd6.chunk.js",
  "./static/js/default-template.js",
  "./static/js/divider2.js",
  "./static/js/export.v12.js",
  "./static/js/help-edit.js",
  "./static/js/hide-github.js",
  "./static/js/html2canvas.min.js",
  "./static/js/jspdf.umd.min.js",
  "./static/js/main.v2.js",
  "./static/js/mode-switch.js",
  "./static/js/print-css.js",
  "./static/js/rf-common.js",
  "./static/js/sw-register.js",
  "./static/js/theme-sync.js",
  "./static/js/upload.js",
  "./static/media/add.5d97b571.svg",
  "./static/media/align.ec00f38c.svg",
  "./static/media/bold.7ad9e5c5.svg",
  "./static/media/bucket.f2e7a5b6.svg",
  "./static/media/color.4dfed4f1.svg",
  "./static/media/corner.2f310e1e.svg",
  "./static/media/frame.5ad6d917.svg",
  "./static/media/github.6cd12b48.svg",
  "./static/media/help.c6c8017e.svg",
  "./static/media/icon-192.png",
  "./static/media/icon-512.png",
  "./static/media/line.666ab8eb.svg",
  "./static/media/link.019206e2.svg",
  "./static/media/list.a8742963.svg",
  "./static/media/picture.567bb06c.svg",
  "./static/media/remove.c4086e65.svg",
  "./static/media/resume-avatar-1.jpg",
  "./static/media/resume.cf2d8803.svg",
  "./static/media/screen.e73085a4.svg",
  "./static/media/underline.b04b69d5.svg",
  "./static/media/word.80036ad0.svg"
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 逐个添加：单个文件失败不影响整体安装
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function cachePut(req, res) {
  if (!res || !res.ok || res.type !== 'basic') return;
  try {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
  } catch (e) { /* 导航请求无法写入 Cache，忽略即可 */ }
}

/* 网络优先，缓存兜底。
   ⚠️ 关键点：导航请求（request.mode === 'navigate'）**不能**直接交给 Cache API 匹配或写入，
   因为 Cache.match()/put() 遇到 mode 为 navigate 的 Request 会抛 TypeError
   （"Cannot construct a Request with a Request object that has a mode of 'navigate'"），
   这会让整次导航以网络错误告终——即断网时页面直接打不开。
   所以导航一律回退到预缓存好的 index.html。 */
function networkFirst(req, fallbackUrl) {
  return fetch(req).then(function (res) {
    cachePut(req, res);
    return res;
  }).catch(function () {
    if (fallbackUrl) {
      return caches.match(fallbackUrl).then(function (hit) { return hit || Response.error(); });
    }
    return caches.match(req).catch(function () { return undefined; }).then(function (hit) {
      return hit || Response.error();
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // 跨域不管

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './index.html'));
    return;
  }
  e.respondWith(networkFirst(req));
});
