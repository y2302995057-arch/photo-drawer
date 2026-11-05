import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import sharp from 'sharp';

// ===== 配置（外置到 config.json；首次启动没有配置时进入引导页）=====
// 照片根目录优先级：命令行参数 > 环境变量 PHOTO_ROOTS > config.json > 程序自带的「我的照片」文件夹
const EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const SERVER_DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1'));
const CACHE_DIR = path.join(SERVER_DIR, '.thumbcache');
const CONFIG_FILE = path.join(SERVER_DIR, 'config.json');
const SESSION_FILE = path.join(SERVER_DIR, '.sessions.json');
const DEFAULT_PHOTO_DIR = path.join(SERVER_DIR, '我的照片'); // 小白推荐：把照片拖进这个文件夹即可
const THUMB_W = 480; // 缩略图宽度（覆盖手机 2x 屏的 240px 列宽）
const CACHE_MAX_BYTES = 300 * 1024 * 1024; // 缓存总大小上限 300MB
const CACHE_MAX_FILES = 5000;              // 缓存文件数上限

// 顶部/下拉里的「目录」顺序：
//   1) 先按 TAB_ORDER 里写死的名字排序（留空 = 完全按资源管理器顺序）；
//   2) 其余按 Windows 资源管理器的显示顺序（自然排序：新建文件夹 → 新建文件夹 (2) → 新建文件夹 (10)）。
const TAB_ORDER = [];

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch { return {}; } }
function saveConfig(c) { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch (e) { console.error('保存设置失败：', e.message); } }

const fileCfg = loadConfig();
const CLI_DIRS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const ENV_DIRS = (process.env.PHOTO_ROOTS || '').split(';').map(s => s.trim()).filter(Boolean);

function configDirs() {
  if (CLI_DIRS.length) return CLI_DIRS;
  if (ENV_DIRS.length) return ENV_DIRS;
  if (Array.isArray(fileCfg.photoDirs) && fileCfg.photoDirs.length) return fileCfg.photoDirs;
  if (fileCfg.photoDir) return [fileCfg.photoDir];
  return [DEFAULT_PHOTO_DIR];
}
let ROOTS = configDirs().map(r => path.resolve(r));

const APP_NAME = process.env.APP_NAME || fileCfg.appName || '抽屉';
const BASE_PORT = Number(process.env.PORT) || Number(fileCfg.port) || 3210;
const HOST = process.env.LISTEN || fileCfg.host || '0.0.0.0'; // 0.0.0.0 = 允许同一 WiFi 的手机访问
const OPEN_BROWSER = !process.argv.includes('--no-open') && process.env.NO_OPEN !== '1';

// 密码：环境变量 PHOTO_PASS 直接覆盖（自己用方便）；否则用 config.json 里的加盐哈希；
// 两个都没有 = 还没配置，进入首次引导。密码绝不保存明文。
const ENV_PASS = process.env.PHOTO_PASS || '';
let PASS_SALT = fileCfg.passSalt || '';
let PASS_HASH = fileCfg.passHash || '';
let needSetup = !ENV_PASS && !PASS_HASH;

const HIDDEN = name => name.startsWith('.') || name.startsWith('$'); // .DS_Store / $RECYCLE.BIN 之类
const normRel = s => s.split(path.sep).join('/');
const extOk = name => EXT.has(path.extname(name).toLowerCase());

// 与资源管理器一致的显示顺序：英文字母在前、中文按拼音、数字按数值（文件夹 (2) 在 (10) 之前）
const zhCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const isAsciiStart = s => /^[\x00-\x7f]/.test(s);
const dirCompare = (a, b) => {
  const aa = isAsciiStart(a), ba = isAsciiStart(b);
  if (aa !== ba) return aa ? -1 : 1;
  return zhCollator.compare(a, b);
};

// ===== 目录索引 =====
// 这里不做「统计文件数量」。之前启动时会把整个照片库递归走一遍、数出每个目录有几张图，
// 实测 4074 个目录 / 33.9 万张要 3.8 秒，首屏得等这一趟扫完才有目录可用，就是卡在这里。
// 现在只读根目录一层就返回目录列表；某个目录的子目录树，等你真正点开它时才扫，扫完缓存住。
// 照片列表仍然按页现读，所以 100 万张也不会把内存撑爆。
// 一个根目录下的每个「顶层文件夹」= 一个目录；它内部所有子文件夹 = 该目录下的子目录树。
const TREE_TTL = 60000;        // 目录列表缓存 60s
const SUB_TTL = 5 * 60 * 1000; // 单个目录的子目录树缓存 5 分钟
const PAGE_MAX = 240;          // 单页最多返回多少张
const SORT_CAP = Number(process.env.SORT_CAP) || 40000; // 按时间/名称/大小排序时最多读这么多条（超了退回目录顺序）
const SEARCH_CAP = 200000;     // 搜索最多扫这么多条目录项

let treeCache = null;
const subCache = new Map();    // groupKey -> { tree, own, at, ms }

const groupBase = g => (g.kind === 'folder' ? path.join(g.root, g.name) : g.root);

function orderTop(dirs) {
  const names = dirs.slice().sort(dirCompare);
  if (!TAB_ORDER.length) return names;
  return names.slice().sort((a, b) => {
    const ia = TAB_ORDER.indexOf(a), ib = TAB_ORDER.indexOf(b);
    const va = ia === -1 ? Infinity : ia, vb = ib === -1 ? Infinity : ib;
    return va !== vb ? va - vb : dirCompare(a, b);
  });
}

// 顶层文件夹值不值得显示：只看一层（很便宜，不递归）。
// 里面一个子目录、或者一张图都没有的目录（例如只放了说明文档）直接跳过，免得列表里全是空壳。
function looksLikePhotoDir(dirAbs) {
  try {
    return fs.readdirSync(dirAbs, { withFileTypes: true })
      .some(e => !HIDDEN(e.name) && (e.isDirectory() || extOk(e.name)));
  } catch { return false; }
}

// 只列「根目录 → 顶层文件夹」，不递归、不数文件数
function scanTree() {
  const groups = [];

  ROOTS.forEach((root, ri) => {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }

    const multi = ROOTS.length > 1;
    const rootTag = multi ? '（' + (path.basename(root) || '根目录 ' + (ri + 1)) + '）' : '';

    // ① 顶层文件夹 = 目录
    for (const d of orderTop(entries.filter(e => e.isDirectory() && !HIDDEN(e.name)).map(e => e.name))) {
      if (!looksLikePhotoDir(path.join(root, d))) continue;
      groups.push({ key: 'r' + ri + '/' + d, name: d, root, rootIndex: ri, kind: 'folder' });
    }

    // ② 根目录下直接放的散图（单独成组，放最后）
    let own = 0;
    for (const e of entries) {
      if (HIDDEN(e.name) || e.isDirectory() || !extOk(e.name)) continue;
      own++;
    }
    if (own) {
      groups.push({ key: 'r' + ri, name: '根目录' + rootTag, root, rootIndex: ri, kind: 'root' });
    }
  });

  return { roots: ROOTS, groups };
}

function getTree(force = false) {
  const now = Date.now();
  if (!force && treeCache && now - treeCache.at < TREE_TTL) return treeCache;
  if (force) subCache.clear();
  const t0 = Date.now();
  const data = scanTree();
  treeCache = { ...data, at: Date.now(), ms: Date.now() - t0 };
  return treeCache;
}

// 走一棵子树：返回子目录结构（整棵子树里一张图都没有的目录会被丢掉）与本层图片数 own。
// 只有真正打开某个目录时才会调用，不是启动时全量扫。
function scanSub(absDir) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return { own: 0, children: [] }; }
  let own = 0;
  const children = [];
  for (const e of entries) {
    if (HIDDEN(e.name)) continue;
    if (e.isDirectory()) {
      const r = scanSub(path.join(absDir, e.name));
      if (r.own || r.children.length) children.push({ name: e.name, children: r.children });
    } else if (extOk(e.name)) {
      own++;
    }
  }
  children.sort((a, b) => dirCompare(a.name, b.name));
  return { own, children };
}

// 给前端的树：只有 name / path / children，不带数量
function toTree(nodes, prefix) {
  return nodes.map(c => {
    const p = prefix ? prefix + '/' + c.name : c.name;
    return { name: c.name, path: p, children: toTree(c.children, p) };
  });
}

function getSubtree(g, force = false) {
  const hit = subCache.get(g.key);
  if (!force && hit && Date.now() - hit.at < SUB_TTL) return hit;
  const t0 = Date.now();

  let tree = [];
  let own = 0;
  if (g.kind === 'root') {
    // 「根目录」分组只放直接摊在根目录下的散图，没有子目录可展开
    try {
      own = fs.readdirSync(groupBase(g), { withFileTypes: true })
        .filter(e => !e.isDirectory() && !HIDDEN(e.name) && extOk(e.name)).length;
    } catch {}
  } else {
    const scanned = scanSub(groupBase(g));
    tree = toTree(scanned.children, '');
    own = scanned.own;
  }

  const data = { tree, own, at: Date.now(), ms: Date.now() - t0 };
  subCache.set(g.key, data);
  return data;
}

// ===== 系列卡片 =====
// 一个子文件夹 = 一个系列。只读「父目录这一层」和每个系列自己的一层，
// 不递归、不数照片数量（那正是当年首屏 3.8 秒的来源）。封面用 BFS 找到的第一张图。
function firstCover(g, absDir, firstEntries) {
  const prefix = ROOTS.length > 1 ? '@' + g.rootIndex + '/' : '';
  const queue = [{ abs: absDir, ents: firstEntries }];
  let reads = 0;
  while (queue.length && reads < 24) {
    const { abs, ents } = queue.shift();
    reads++;
    let list = ents;
    if (!list) { try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { list = []; } }
    const imgs = list.filter(e => e.isFile() && !HIDDEN(e.name) && extOk(e.name)).map(e => e.name).sort(dirCompare);
    if (imgs.length) return prefix + normRel(path.relative(g.root, path.join(abs, imgs[0])));
    for (const e of list) if (e.isDirectory() && !HIDDEN(e.name)) queue.push({ abs: path.join(abs, e.name), ents: null });
  }
  return '';
}

function seriesAt(g, parent) {
  const base = parent ? path.join(groupBase(g), parent) : groupBase(g);
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  const names = orderTop(entries.filter(e => e.isDirectory() && !HIDDEN(e.name)).map(e => e.name));
  return names.map(name => {
    const abs = path.join(base, name);
    let ents = [];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch {}
    const dirs = ents.filter(e => e.isDirectory() && !HIDDEN(e.name)).length;
    return {
      name,
      sub: parent ? parent + '/' + name : name,
      dirs,                       // 直接子目录数（不是照片数，只读了一层）
      hasChildren: dirs > 0,
      cover: firstCover(g, abs, ents),
    };
  });
}

// ===== 取页 =====
// scope → 一串有序目录 [{ abs }]（先本目录，再按资源管理器顺序进子目录）
function dirsOfScope(g, subPath) {
  const base = groupBase(g);
  // 「根目录」分组只有本层散图，不往下走（否则会和顶层文件夹分组重复）
  if (g.kind === 'root') return [{ abs: base }];

  const { tree } = getSubtree(g);   // 第一次用这个目录时才扫，之后走缓存
  const out = [];

  const walk = (absDir, nodes) => {
    out.push({ abs: absDir });
    for (const c of nodes || []) walk(path.join(absDir, c.name), c.children);
  };

  if (!subPath) {
    walk(base, tree);
    return out;
  }

  // 定位子目录节点，只走它这一棵
  let nodes = tree;
  let node = null;
  for (const part of subPath.split('/')) {
    node = nodes.find(x => x.name === part);
    if (!node) return out;
    nodes = node.children || [];
  }
  walk(path.join(base, subPath), node.children);
  return out;
}

function scopesOf(groupKey, subPath, loose) {
  const tree = getTree();
  if (groupKey) {
    const g = tree.groups.find(x => x.key === groupKey);
    if (!g) return [];
    // loose=1：只看直接放在该目录里的照片（不递归子目录）
    if (loose) return [{ g, dirs: [{ abs: groupBase(g) }] }];
    return [{ g, dirs: dirsOfScope(g, subPath || '') }];
  }
  return tree.groups.map(g => ({ g, dirs: dirsOfScope(g, '') }));
}

async function listImages(absDir) {
  let names;
  try { names = await fs.promises.readdir(absDir); } catch { return []; }
  return names.filter(n => !HIDDEN(n) && extOk(n)).sort(dirCompare);
}

function makeItem(g, dirAbs, fileName, st) {
  const base = g.kind === 'folder' ? path.join(g.root, g.name) : g.root;
  const relToRoot = normRel(path.relative(g.root, path.join(dirAbs, fileName)));
  const subPath = normRel(path.relative(base, dirAbs));
  const prefix = ROOTS.length > 1 ? '@' + g.rootIndex + '/' : '';
  return {
    p: prefix + relToRoot,
    name: fileName.replace(/\.[^.]+$/, ''),
    file: fileName,
    g: g.key,
    folder: [g.name, subPath].filter(Boolean).join(' / '),
    sub: subPath,
    size: st.size,
    mtime: st.mtimeMs,
  };
}

async function statItem(g, dirAbs, fileName) {
  const abs = path.join(dirAbs, fileName);
  try {
    const st = await fs.promises.stat(abs);
    if (!st.isFile()) return null;
    return makeItem(g, dirAbs, fileName, st);
  } catch { return null; }
}

// 目录顺序分页：只读需要的目录，内存与页大小成正比。
// 不再预先知道每个目录有几张，所以跳页靠 readdir 拿到的真实条数逐目录累加（不数文件、只读名字）。
async function pageBySeq(scopes, offset, limit, q) {
  const items = [];
  const kw = (q || '').toLowerCase();
  let skipped = 0;
  let scanned = 0;

  for (const sc of scopes) {
    for (const d of sc.dirs) {
      if (items.length >= limit) break;
      if (kw && scanned > SEARCH_CAP) break;
      const names = await listImages(d.abs);
      scanned += names.length;

      let startAt = 0;
      if (!kw) {
        // 无搜索：用真实条数跳页，前面整目录都不用 stat
        if (skipped + names.length <= offset) { skipped += names.length; continue; }
        startAt = Math.max(0, offset - skipped);
        skipped += names.length;
      }

      for (let i = startAt; i < names.length; i++) {
        if (kw && !names[i].toLowerCase().includes(kw)) continue;
        if (items.length >= limit) break;
        const item = await statItem(sc.g, d.abs, names[i]);
        if (item) items.push(item);
      }
    }
  }

  return { items, total: null, hasMore: items.length >= limit, scanned: kw ? scanned : undefined };
}

// 需要全局排序（时间/名称/大小）时：一边收一边判上限，超了退回目录顺序
async function pageSorted(scopes, offset, limit, sort) {
  const all = [];
  for (const sc of scopes) {
    for (const d of sc.dirs) {
      const names = await listImages(d.abs);
      for (const n of names) {
        const item = await statItem(sc.g, d.abs, n);
        if (item) all.push(item);
        if (all.length > SORT_CAP) return null; // 调用方负责回退
      }
    }
  }

  if (sort === 'time-desc') all.sort((a, b) => b.mtime - a.mtime);
  else if (sort === 'time-asc') all.sort((a, b) => a.mtime - b.mtime);
  else if (sort === 'name-asc') all.sort((a, b) => dirCompare(a.name, b.name));
  else if (sort === 'size-desc') all.sort((a, b) => b.size - a.size);

  // 全局排序时总数是现成的，顺手带上（这不是扫描统计，只是这一页排完序的结果）
  return { items: all.slice(offset, offset + limit), total: all.length, hasMore: offset + limit < all.length, sortUsed: sort };
}

async function pagePhotos({ groupKey, sub, offset, limit, sort, q, loose }) {
  const scopes = scopesOf(groupKey, sub, loose);
  if (!scopes.length) return { items: [], total: 0, hasMore: false, sortUsed: 'seq' };

  if (sort && sort !== 'seq') {
    const sorted = await pageSorted(scopes, offset, limit, sort);
    if (sorted) return sorted;
    // 范围太大，退回目录顺序（前端会提示）
    const r = await pageBySeq(scopes, offset, limit, q);
    return { ...r, sortUsed: 'seq', sortFallback: true };
  }
  const r = await pageBySeq(scopes, offset, limit, q);
  return { ...r, sortUsed: 'seq' };
}

// ===== 静态文件 =====
const PUB = path.join(SERVER_DIR, 'public');
function serveStatic(res, file, type) {
  fs.readFile(path.join(PUB, file), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// 统一返回 JSON（接口都用这个，省得每次重写响应头）
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

// ===== 安全路径校验（多根目录）=====
// 支持 "@根序号/相对路径" 前缀；单根目录时也兼容不带前缀的路径。
function safePath(rel) {
  if (!rel) return null;
  for (let ri = 0; ri < ROOTS.length; ri++) {
    const root = ROOTS[ri];
    let sub = rel;
    if (rel.startsWith('@')) {
      const m = /^@(\d+)\/([\s\S]*)$/.exec(rel);
      if (m) {
        if (Number(m[1]) !== ri) continue;
        sub = m[2];
      } else continue;
    }
    const full = path.resolve(root, sub);
    if (full === root || !full.startsWith(root + path.sep)) continue; // 防目录穿越
    try {
      const st = fs.statSync(full);
      if (st.isFile() && extOk(full)) return full;
    } catch {}
  }
  return null;
}

// ===== 缓存协商（ETag → 304）=====
function tryNotModified(req, res, etag) {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }
  return false;
}

// ===== 缩略图缓存：内存优先，内存紧张才落盘 =====
// 缓存键 = 源文件绝对路径 + 修改时间（秒）。
// 内存宽裕：缩略图只放内存（LRU，有硬上限），命中零磁盘 IO，新图也不写硬盘；
// 内存紧张（系统可用内存不足，或本进程 RSS 过大）：一律改走硬盘缓存，已在内存里的全部让位。
const MEM_MAX_BYTES = Number(process.env.MEM_CACHE_MAX) || 128 * 1024 * 1024; // 内存缓存上限 128MB
const MEM_MAX_ITEMS = 2000;                                                     // 内存缓存条数上限
const MEM_MIN_FREE  = Number(process.env.MEM_MIN_FREE) || 1024 * 1024 * 1024;  // 可用内存 < 1GB 视为紧张
const MEM_MIN_RATIO = 0.10;                                                     // 或可用内存 < 总量的 10%
const MEM_MAX_RSS   = Number(process.env.MEM_MAX_RSS)  || 1536 * 1024 * 1024;  // 本进程 RSS > 1.5GB 视为紧张

const memCache = new Map(); // key → webp Buffer；Map 的迭代顺序就是 LRU 顺序（越靠前越久没用）
let memBytes = 0;

function thumbKey(full, mtimeMs) {
  return crypto.createHash('md5').update(full + '|' + Math.floor(mtimeMs / 1000)).digest('hex');
}
const thumbPathOf = key => path.join(CACHE_DIR, key + '.webp');

function memOK() {
  const free = os.freemem(), total = os.totalmem();
  return free > MEM_MIN_FREE && free > total * MEM_MIN_RATIO && process.memoryUsage().rss < MEM_MAX_RSS;
}

function memGet(key) {
  const buf = memCache.get(key);
  if (!buf) return null;
  memCache.delete(key); memCache.set(key, buf); // 提到「最近使用」
  return buf;
}

function memPut(key, buf) {
  if (!memOK()) return; // 内存紧张：一张都不进内存
  if (memCache.has(key)) { memBytes -= memCache.get(key).length; memCache.delete(key); }
  memCache.set(key, buf);
  memBytes += buf.length;
  // 超上限就丢最久未用的，绝不把机器撑爆
  while (memCache.size && (memBytes > MEM_MAX_BYTES || memCache.size > MEM_MAX_ITEMS)) {
    const [k, b] = memCache.entries().next().value;
    memCache.delete(k); memBytes -= b.length;
  }
}

function memDropAll(reason) {
  if (!memCache.size) return;
  console.log(`内存缓存让位（${reason}）：释放 ${(memBytes / 1048576).toFixed(1)}MB / ${memCache.size} 张`);
  memCache.clear(); memBytes = 0;
}

const thumbPipeline = full => sharp(full, { failOn: 'none' })
  .rotate() // 按 EXIF 方向自动转正
  .resize({ width: THUMB_W, withoutEnlargement: true })
  .webp({ quality: 72 });

function makeThumbBuf(full) {
  return thumbPipeline(full).toBuffer(); // 内存宽裕时：只进内存，不写硬盘
}

function makeThumb(full, tPath) {
  return thumbPipeline(full).toFile(tPath); // 内存紧张时：直接落盘
}

// ===== 缓存 LRU 清理 =====
// 注意：这一趟是同步 IO（readdir + 逐个 stat 几千个缓存文件），跑起来会把整个服务卡住。
// 首屏一口气要生成 200+ 张缩略图时，如果每 50 张清一次，就会卡出好几秒（点目录也要等）。
// 所以加了时间间隔：两次清理至少隔 15 秒，且要求自上次清理后新生成够 300 张。
let genCount = 0;
let lastClean = 0;
const CLEAN_MIN_MS = 15000;
function cleanCache(force = false) {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    genCount++;
    if (!force) {
      if (Date.now() - lastClean < CLEAN_MIN_MS) return;
      if (genCount < 300) return;
    }
    lastClean = Date.now();
    genCount = 0;
    const files = [];
    let total = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      try {
        const st = fs.statSync(path.join(CACHE_DIR, f));
        files.push({ fp: path.join(CACHE_DIR, f), mtime: st.mtimeMs, size: st.size });
        total += st.size;
      } catch {}
    }
    if (files.length <= CACHE_MAX_FILES && total <= CACHE_MAX_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime);
    let n = files.length, t = total, removed = 0;
    for (const x of files) {
      if (n <= CACHE_MAX_FILES && t <= CACHE_MAX_BYTES) break;
      try { fs.unlinkSync(x.fp); } catch {}
      n--; t -= x.size; removed++;
    }
    console.log(`缩略图缓存清理：删除 ${removed} 个，剩 ${n} 个 / ${(t / 1048576).toFixed(1)}MB`);
  } catch {}
}

function streamFile(res, file, type, cache, etag, req) {
  const st = fs.statSync(file);
  if (etag && tryNotModified(req, res, etag)) return;
  const headers = { 'Content-Type': type, 'Content-Length': st.size };
  if (cache) headers['Cache-Control'] = 'public, max-age=604800';
  if (etag) headers['ETag'] = etag;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

// ===== 登录授权 =====
// 打开页面先登录，没登录的设备只能看到登录页，主站内容（页面/接口/图）一律不放行。
// 密码不明文保存：config.json 里只存加盐哈希。登录成功的设备发一个长效随机令牌（HttpOnly Cookie），会话落盘，重启不丢。
const SESSION_DAYS = 180; // 设备保持登录 180 天

function hashPass(pass, salt) { return crypto.createHash('sha256').update(salt + ':' + String(pass)).digest('hex'); }
function passOk(pass) {
  if (typeof pass !== 'string' || !pass) return false;
  if (ENV_PASS) return pass === ENV_PASS;               // 环境变量覆盖（自己用）
  if (PASS_HASH) return hashPass(pass, PASS_SALT) === PASS_HASH; // 首次引导设置的密码
  return false;
}

let sessions = {}; // token -> { at, agent }
try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) || {}; } catch {}

function saveSessions() {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions)); } catch {}
}

const cookieOf = (req, name) => {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(req.headers.cookie || '');
  return m ? m[1] : null;
};

function isAuthed(req) {
  const t = cookieOf(req, 'pw_s');
  const s = t && sessions[t];
  return !!(s && Date.now() - s.at < SESSION_DAYS * 86400e3);
}

// 登录限流：连错 5 次锁 30 秒，防止局域网内暴力试密码
let loginFails = 0;
let loginLockUntil = 0;

function readBody(req) {
  return new Promise(resolve => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 4096) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', () => resolve(''));
  });
}

async function handleLogin(req, res) {
  const no = (code, msg) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: msg }));
  };
  if (Date.now() < loginLockUntil) return no(429, '尝试次数太多，请 30 秒后再试');

  let pass = '';
  try { pass = (JSON.parse(await readBody(req)) || {}).pass || ''; } catch {}
  if (!passOk(pass)) {
    if (++loginFails >= 5) { loginLockUntil = Date.now() + 30000; loginFails = 0; }
    return no(401, '密码不对，再试试');
  }

  loginFails = 0;
  const token = crypto.randomBytes(24).toString('base64url');
  sessions[token] = { at: Date.now(), agent: String(req.headers['user-agent'] || '').slice(0, 120) };

  // 顺手清掉过期会话
  const cut = Date.now() - SESSION_DAYS * 86400e3;
  for (const k of Object.keys(sessions)) if (sessions[k].at < cut) delete sessions[k];
  saveSessions();

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `pw_s=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax`,
  });
  res.end('{"ok":true}');
}

// ===== 首次引导：选照片文件夹 + 设密码 =====
async function handleSetup(req, res) {
  let body = {};
  try { body = JSON.parse(await readBody(req)) || {}; } catch {}
  const pass = String(body.pass || '');
  if (!pass) return json(res, 400, { error: '请先设置一个密码' });
  if (pass.length > 128) return json(res, 400, { error: '密码太长了' });

  let dir = String(body.photoDir || '').trim() || DEFAULT_PHOTO_DIR;
  try { dir = path.resolve(dir); } catch { return json(res, 400, { error: '照片文件夹的路径不对' }); }
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return json(res, 400, { error: '创建照片文件夹失败：' + e.message }); }
  if (!fs.existsSync(dir)) return json(res, 400, { error: '找不到这个照片文件夹' });

  let hasPhoto = false;
  try { hasPhoto = fs.readdirSync(dir, { withFileTypes: true }).some(e => !HIDDEN(e.name) && (e.isDirectory() || extOk(e.name))); } catch {}

  PASS_SALT = crypto.randomBytes(12).toString('base64url');
  PASS_HASH = hashPass(pass, PASS_SALT);
  Object.assign(fileCfg, {
    appName: fileCfg.appName || APP_NAME,
    photoDir: dir,
    photoDirs: [dir],
    passSalt: PASS_SALT,
    passHash: PASS_HASH,
  });
  saveConfig(fileCfg);
  ROOTS = [dir];
  needSetup = false;
  getTree(true); // 立刻按新目录刷新缓存

  // 设置完顺手登录，直接进首页，不用马上再输一次密码
  const token = crypto.randomBytes(24).toString('base64url');
  sessions[token] = { at: Date.now(), agent: String(req.headers['user-agent'] || '').slice(0, 120) };
  saveSessions();
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `pw_s=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax`,
  });
  res.end(JSON.stringify({ ok: true, hasPhoto, photoDir: dir }));
}

// 弹系统「选择文件夹」对话框（本机双击可用；远程/无桌面环境调不出来，前端降级为手动输入路径）
function handlePickFolder(req, res) {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '选择你的照片文件夹'",
    '$d.ShowNewFolderButton = $true',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
  ].join('\n');
  const b64 = Buffer.from(ps, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -STA -EncodedCommand ${b64}`, { timeout: 120000 }, (err, stdout) => {
    if (err) return json(res, 500, { error: '调不出系统选择框，请改用「手动输入路径」' });
    const p = String(stdout || '').trim();
    if (!p) return json(res, 200, { cancelled: true });
    json(res, 200, { path: p });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // 探测接口（供「重复启动直接开浏览器」用）和产品名，对所有人开放
  if (u.pathname === '/api/ping') return json(res, 200, { ok: true, app: 'photo-wall', name: APP_NAME });
  if (u.pathname === '/api/meta') return json(res, 200, { name: APP_NAME, needSetup, defaultDir: DEFAULT_PHOTO_DIR });

  // ===== 首次引导：还没设密码/照片文件夹时，所有页面都先去引导 =====
  // 设密码和登录共用同一个动画页 /auth：页内先设密码、确认，再选照片文件夹
  if (needSetup) {
    if (u.pathname === '/setup' || u.pathname === '/login' || u.pathname === '/auth') {
      return serveStatic(res, 'auth.html', 'text/html');
    }
    if (u.pathname === '/auth.css') return serveStatic(res, 'auth.css', 'text/css');
    if (u.pathname === '/auth.js') return serveStatic(res, 'auth.js', 'text/javascript');
    if (u.pathname === '/api/setup' && req.method === 'POST') return handleSetup(req, res);
    if (u.pathname === '/api/pick-folder' && req.method === 'POST') return handlePickFolder(req, res);
    res.writeHead(302, { Location: '/setup' });
    return res.end();
  }

  // 登录接口对谁都开放：已登录的再登一次直接回 ok（不然会掉到 404）
  if (u.pathname === '/api/login' && req.method === 'POST') {
    if (isAuthed(req)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end('{"ok":true}');
    }
    return handleLogin(req, res);
  }

  // ===== 登录门槛：没有有效会话的设备，只能看到登录页 =====
  if (!isAuthed(req)) {
    if (u.pathname === '/login' || u.pathname === '/auth') return serveStatic(res, 'auth.html', 'text/html');
    // 登录页自己的样式和脚本必须放行，否则会一起被 302 到登录页，页面没样式
    if (u.pathname === '/auth.css') return serveStatic(res, 'auth.css', 'text/css');
    if (u.pathname === '/auth.js') return serveStatic(res, 'auth.js', 'text/javascript');
    if (u.pathname.startsWith('/api/') || u.pathname === '/img' || u.pathname === '/thumb') {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '未登录', needLogin: true }));
    }
    res.writeHead(302, { Location: '/login' });
    return res.end();
  }
  if (u.pathname === '/login' || u.pathname === '/auth') { res.writeHead(302, { Location: '/' }); return res.end(); }

  // 首页就是系列卡片；/series 只作为老链接的别名，统一回到 /
  if (u.pathname === '/') return serveStatic(res, 'series.html', 'text/html');
  if (u.pathname === '/series') { res.writeHead(302, { Location: '/' }); return res.end(); }
  if (u.pathname === '/series.css') return serveStatic(res, 'series.css', 'text/css');
  if (u.pathname === '/series.js') return serveStatic(res, 'series.js', 'text/javascript');
  // 看图页：只从卡片「进入系列」进来，不再是独立首页
  if (u.pathname === '/view') return serveStatic(res, 'view.html', 'text/html');
  if (u.pathname === '/view.js') return serveStatic(res, 'view.js', 'text/javascript');
  if (u.pathname === '/view.css') return serveStatic(res, 'view.css', 'text/css');
  if (u.pathname === '/nav.css') return serveStatic(res, 'nav.css', 'text/css');
  if (u.pathname === '/nav.js') return serveStatic(res, 'nav.js', 'text/javascript');
  if (u.pathname === '/theme.css') return serveStatic(res, 'theme.css', 'text/css');
  if (u.pathname === '/masonry.css') return serveStatic(res, 'masonry.css', 'text/css');
  if (u.pathname === '/settings.css') return serveStatic(res, 'settings.css', 'text/css');
  if (u.pathname === '/prefs.js') return serveStatic(res, 'prefs.js', 'text/javascript');
  if (u.pathname === '/masonry.js') return serveStatic(res, 'masonry.js', 'text/javascript');
  if (u.pathname === '/settings.js') return serveStatic(res, 'settings.js', 'text/javascript');
  if (u.pathname === '/auth.css') return serveStatic(res, 'auth.css', 'text/css');
  if (u.pathname === '/auth.js') return serveStatic(res, 'auth.js', 'text/javascript');
  if (u.pathname === '/soft-bg.css') return serveStatic(res, 'soft-bg.css', 'text/css');

  // 目录列表：只有「根目录 → 顶层文件夹」，不递归、不数文件数，一次 readdir 就回来
  if (u.pathname === '/api/tree') {
    try {
      const t = getTree(u.searchParams.get('refresh') === '1');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ roots: t.roots, groups: t.groups, scanMs: t.ms }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }

  // 某个目录的子目录树：点开目录时才扫这一棵（只读名字，不数数），结果缓存 5 分钟
  if (u.pathname === '/api/subtree') {
    try {
      const key = u.searchParams.get('g') || '';
      const g = getTree().groups.find(x => x.key === key);
      if (!g) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'no such group' }));
        return;
      }
      const s = getSubtree(g, u.searchParams.get('refresh') === '1');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ tree: s.tree, own: s.own, scanMs: s.ms }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }

  // 系列卡片：不带 g 时列出照片根目录下的所有顶层文件夹（一个文件夹 = 一个系列）；
  // 带 g 时列出该系列内部某一层的子文件夹（逐层下钻）。两层「根→系列」、三层「根→合集→系列」都适用。
  if (u.pathname === '/api/series') {
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(obj));
    };
    try {
      const t = getTree();
      const key = u.searchParams.get('g') || '';

      // 根视图：照片根目录的直接子文件夹 = 系列
      if (!key) {
        const root0 = ROOTS[0];
        const t0 = Date.now();
        const items = t.groups.filter(g => g.kind === 'folder').map(g => {
          const abs = groupBase(g);
          let ents = [];
          try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch {}
          const dirs = ents.filter(e => e.isDirectory() && !HIDDEN(e.name)).length;
          return { name: g.name, key: g.key, sub: '', dirs, hasChildren: dirs > 0, cover: firstCover(g, abs, ents) };
        });
        return json(200, { root: true, rootLabel: path.basename(root0) || '照片', parent: '', crumbs: [], items, scanMs: Date.now() - t0 });
      }

      // 下钻：某个系列内部的子文件夹
      const g = t.groups.find(x => x.key === key);
      if (!g) return json(404, { error: '没有可用目录' });

      // 只接受安全的相对层级：出现 .. 一律回落到系列层，挡住目录穿越
      const rawParts = (u.searchParams.get('parent') || '').split('/');
      const parent = rawParts.some(p => p === '..')
        ? ''
        : rawParts.filter(p => p && p !== '.').join('/');
      const rootAbs = path.resolve(groupBase(g));
      const baseAbs = path.resolve(path.join(rootAbs, parent));
      if (baseAbs !== rootAbs && !baseAbs.startsWith(rootAbs + path.sep)) return json(400, { error: 'bad parent' });

      const t0 = Date.now();
      const items = seriesAt(g, parent).map(it => ({ ...it, key: g.key }));
      json(200, {
        root: false,
        group: { key: g.key, name: g.name },
        rootLabel: path.basename(g.root) || '照片',
        parent,
        crumbs: parent ? parent.split('/') : [],
        items,
        scanMs: Date.now() - t0,
      });
    } catch (e) {
      json(500, { error: String(e && e.message || e) });
    }
    return;
  }

  // 照片：按 scope + offset/limit 分页，只有这一页会进内存
  if (u.pathname === '/api/photos') {
    const limit = Math.max(1, Math.min(Number(u.searchParams.get('limit')) || 120, PAGE_MAX));
    const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0);
    const groupKey = u.searchParams.get('g') || '';
    const sub = u.searchParams.get('sub') || '';
    const sort = u.searchParams.get('sort') || 'seq';
    const q = (u.searchParams.get('q') || '').trim();
    const loose = u.searchParams.get('loose') === '1';
    try {
      const data = await pagePhotos({ groupKey, sub, offset, limit, sort, q, loose });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ ...data, offset, limit }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }

  if (u.pathname === '/img' || u.pathname === '/thumb') {
    const rel = u.searchParams.get('p') || '';
    const full = safePath(rel);
    if (!full) { res.writeHead(404); res.end('Not Found'); return; }
    let st;
    try { st = fs.statSync(full); } catch { res.writeHead(404); res.end('Not Found'); return; }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs / 1000).toString(16) + '"';

    if (u.pathname === '/img') {
      try { return streamFile(res, full, type, true, etag, req); }
      catch { res.writeHead(404); res.end('Not Found'); return; }
    }

    // /thumb：缩略图（webp）。内存优先，内存紧张才落盘。响应头 X-Thumb-Cache 标明这次图从哪来。
    const key = thumbKey(full, st.mtimeMs);
    const tetag = '"t' + key + '"'; // 键里已含源文件修改时间，源文件一变 ETag 就变
    if (tryNotModified(req, res, tetag)) return;

    try {
      if (!memOK()) memDropAll('系统内存紧张');

      // ① 内存命中：零磁盘 IO
      const memBuf = memGet(key);
      if (memBuf) {
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': memBuf.length, 'Cache-Control': 'public, max-age=604800', 'ETag': tetag, 'X-Thumb-Cache': 'mem' });
        res.end(memBuf);
        return;
      }

      const tPath = thumbPathOf(key);

      // ② 内存紧张：只走硬盘，读出来的也不进内存
      if (!memOK()) {
        if (fs.existsSync(tPath)) {
          const now = new Date();
          try { fs.utimesSync(tPath, now, now); } catch {} // 更新 LRU 最近使用时间
        } else {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
          await makeThumb(full, tPath);
          cleanCache();
        }
        const tst = fs.statSync(tPath);
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': tst.size, 'Cache-Control': 'public, max-age=604800', 'ETag': tetag, 'X-Thumb-Cache': 'disk' });
        fs.createReadStream(tPath).pipe(res);
        return;
      }

      // ③ 内存宽裕：硬盘里已有的读一次升进内存；没有的现生成、只进内存不写盘
      let buf;
      if (fs.existsSync(tPath)) {
        buf = await fs.promises.readFile(tPath);
      } else {
        buf = await makeThumbBuf(full);
      }
      memPut(key, buf);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=604800', 'ETag': tetag, 'X-Thumb-Cache': 'mem' });
      res.end(buf);
    } catch {
      // 生成失败（如损坏图片）→ 回退原图
      try { return streamFile(res, full, type, true, etag, req); }
      catch { res.writeHead(404); res.end('Not Found'); }
    }
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

// ===== 启动：防重复 + 端口被占自动换下一个 =====
function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const onErr = e => { server.off('listening', onOk); reject(e); };
    const onOk = () => {
      server.off('error', onErr);
      server.on('error', e => console.error('服务出错：', (e && e.message) || e)); // 启动成功后才挂的兜底
      resolve();
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, HOST);
  });
}

// 启动前探一下：这个端口上是不是已经有一个本程序在跑（重复双击就别再起了）
function probeRunning(port) {
  return new Promise(resolve => {
    const rq = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, rs => {
      let b = '';
      rs.on('data', c => b += c);
      rs.on('end', () => { try { resolve(JSON.parse(b).app === 'photo-wall'); } catch { resolve(false); } });
    });
    rq.on('error', () => resolve(false));
    rq.on('timeout', () => { rq.destroy(); resolve(false); });
  });
}

function onReady(port) {
  const local = `http://127.0.0.1:${port}`;
  console.log('');
  console.log(`  已启动：${local}`);
  console.log(`  手机/平板（连同一个 WiFi）打开：http://${lanIp() || '<本机IP>'}:${port}`);
  console.log(`  照片文件夹：${ROOTS.join('  |  ')}`);
  for (const r of ROOTS) if (!fs.existsSync(r)) console.warn(`  [提醒] 这个文件夹不存在，暂时扫不到照片：${r}`);
  if (needSetup) console.log('  第一次使用：浏览器会打开设置页，选一下照片文件夹、设个密码就能用了。');
  console.log(`  登录密码：${ENV_PASS ? '（来自环境变量 PHOTO_PASS）' : '（你在首次设置时填的那个）'}`);
  console.log('  想停止：直接关掉这个黑窗口即可。');
  console.log('');
  cleanCache(true);
  if (OPEN_BROWSER) openBrowser(local);
}

async function start() {
  if (await probeRunning(BASE_PORT)) {
    const url = `http://127.0.0.1:${BASE_PORT}`;
    console.log(`照片墙已经在运行了：${url}（不用重复启动）`);
    if (OPEN_BROWSER) openBrowser(url);
    return;
  }
  let port = BASE_PORT;
  for (let i = 0; i < 20; i++) {
    try { await listenOnce(port); onReady(port); return; }
    catch (e) {
      if (e && e.code === 'EADDRINUSE') { port++; continue; }
      console.error('启动失败：', (e && e.message) || e);
      process.exit(1);
    }
  }
  console.error(`从 ${BASE_PORT} 开始的 20 个端口都被占用了。请关掉占用端口的程序后，再双击启动。`);
  process.exit(1);
}

start();

// 取一个可用于局域网的 IPv4：优先 192.168 / 10. / 172.16-31（真内网），
// 跳过 169.254（没连上的网卡）、198.18-19（FlClash 之类的 TUN/VPN 虚拟网卡）
function lanIp() {
  const score = ip => {
    if (ip.startsWith('169.254.')) return -1;
    if (/^198\.1[89]\./.test(ip)) return -1;   // 网络基准测试段，常见于 TUN 虚拟网卡
    if (ip.startsWith('127.') || ip.startsWith('0.')) return -1;
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
    return 0;
  };
  let best = '', bestScore = -1;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const s = score(ni.address);
      if (s > bestScore) { bestScore = s; best = ni.address; }
    }
  }
  return bestScore > -1 ? best : '';
}

// --open：启动后自动用默认浏览器打开
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log(`自动打开浏览器失败，请手动访问 ${url}`); });
}
