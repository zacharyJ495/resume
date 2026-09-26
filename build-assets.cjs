/* 生成预压缩副本(.gz/.br) 与 Service Worker
 *
 * 用法:
 *   node build-assets.cjs <项目根目录>                 生成 .gz/.br + 刷新 sw.js 预缓存清单
 *   node build-assets.cjs <项目根目录> --no-compress   只刷新 sw.js（不生成 .gz/.br）
 *
 * 说明：若站点托管在 GitHub Pages / Netlify / Vercel 等会自动压缩的平台，
 *       站点本身不需要 .gz/.br，请加 --no-compress。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.argv[2];
const NO_COMPRESS = process.argv.includes('--no-compress');   // 只刷新 sw.js 清单，不生成 .gz/.br
/* 需要预压缩的扩展名（文本类） */
const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);
/* 需要进 Service Worker 预缓存清单的扩展名（文本 + 图片/字体，保证断网也不缺图） */
const PRECACHE_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest', '.jpg', '.jpeg', '.png', '.ico', '.webp', '.woff', '.woff2']);
const SKIP_DIRS = new Set(['.workbuddy', 'node_modules']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p, out); continue; }
    out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let rawTotal = 0, gzTotal = 0, brTotal = 0;
const rows = [];
const precache = [];

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const ext = path.extname(abs).toLowerCase();
  if (rel.endsWith('.gz') || rel.endsWith('.br')) continue;
  if (rel === 'sw.js') continue;                      // SW 自身不进预缓存
  if (rel === 'build-assets.cjs' || rel === '部署说明.md') continue;

  // 进预缓存清单（含图片/字体）
  if (PRECACHE_EXT.has(ext)) precache.push('./' + rel);

  // 仅文本类才做预压缩（--no-compress 时跳过，适用于自带压缩的托管平台）
  if (!TEXT_EXT.has(ext)) continue;
  if (NO_COMPRESS) continue;
  const buf = fs.readFileSync(abs);
  const gz = zlib.gzipSync(buf, { level: 9 });
  const br = zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  fs.writeFileSync(abs + '.gz', gz);
  fs.writeFileSync(abs + '.br', br);
  rawTotal += buf.length; gzTotal += gz.length; brTotal += br.length;
  rows.push({ rel, raw: buf.length, gz: gz.length, br: br.length });
}
precache.sort();

/* ---------- 生成 Service Worker ---------- */
const SW_VERSION = 'v1';
const sw = `/*!
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
var VERSION = 'rf-${SW_VERSION}';
var CACHE = 'rf-cache-' + VERSION;

var PRECACHE = ${JSON.stringify(precache, null, 2)};

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
`;
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw, 'utf8');

/* ---------- 报告 ---------- */
const kb = (n) => (n / 1024).toFixed(1);
if (NO_COMPRESS) {
  console.log('（--no-compress：已跳过预压缩，仅刷新 sw.js 预缓存清单）');
} else {
  rows.sort((a, b) => b.raw - a.raw);
  console.log('文件'.padEnd(42), '原始'.padStart(10), 'gzip'.padStart(10), 'brotli'.padStart(10));
  for (const r of rows) {
    console.log(r.rel.padEnd(42), (kb(r.raw) + 'K').padStart(10), (kb(r.gz) + 'K').padStart(10), (kb(r.br) + 'K').padStart(10));
  }
  console.log('-'.repeat(76));
  console.log('合计'.padEnd(42), (kb(rawTotal) + 'K').padStart(10), (kb(gzTotal) + 'K').padStart(10), (kb(brTotal) + 'K').padStart(10));
  console.log('');
  console.log('gzip 可省:   ' + (100 - gzTotal / rawTotal * 100).toFixed(1) + '%  (省 ' + kb(rawTotal - gzTotal) + 'K)');
  console.log('brotli 可省: ' + (100 - brTotal / rawTotal * 100).toFixed(1) + '%  (省 ' + kb(rawTotal - brTotal) + 'K)');
}
console.log('已生成 sw.js，预缓存条目 ' + precache.length + ' 个');
