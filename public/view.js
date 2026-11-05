/* 看图页 /view — 折叠目录菜单（Staggered Menu 动效）+ 分支目录树 + 瀑布流（分区懒加载）
   只从系列卡片「进入」进来，不再是站点首页；深链写在 /view#g=...&sub=... */
const GAP = 12, COL_W = 240, STAGGER = 0.05, DUR = 0.6, PAGE = 120;
// 先占位、再按需加载：没有内容的分区给一个占位高度，避免「所有分区的加载按钮都挤在视口里」一次性全加载
const SKELETON_H = 520;
// 单个视图自动滚动加载的上限（超过后只保留手动「继续加载」，防止无限滚到底把 DOM 撑爆）
const AUTO_LOAD_MAX = 2500;

const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const sortEl = document.getElementById('sort');
const footerEl = document.getElementById('footer');
const crumbsEl = document.getElementById('crumbs');

/* 目录按钮 + 抽屉 + 目录树由 nav.js 提供，两页共用一套 */
let menuRelayoutT = 0;
const menu = DirMenu({
  buttonHost: document.querySelector('.toolbar-inner'),
  homeLabel: '返回系列卡片',
  onHome: () => goCards(),
  onPick: (g, path) => select(g ? g.key : '', path),
  active: () => ({ g: activeGroup, sub: activeSub }),
  onToggle: on => {
    if (!on || window.innerWidth <= 900) return;
    clearTimeout(menuRelayoutT);
    menuRelayoutT = setTimeout(() => { masonry.relayout(); menu.measureToolbar(); }, 380);
  },
});

let groups = [];

let activeGroup = '';
let activeSub = '';
let query = '';
let sections = [];        // 当前视图的分区（每个分区各自分页）
let openSeq = 0;          // 防止过期请求回填
// 进入看图页时所在的卡片页层级，见 cardsURL()
const origin = { fg: '', fp: '', g: '', sub: '', _init: false };

const EASE = 'cubic-bezier(.22,1,.36,1)';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================= 数据 ================= */
async function load() {
  groups = await menu.ready;          // 目录数据由 nav.js 拉好，这里直接拿

  applyHash();
  const backSeries = document.getElementById('backSeries');
  if (backSeries) backSeries.href = cardsURL();   // 顶部「← 返回系列」也原路回去

  footerEl.textContent = `${groups.length} 个目录`;

  const g = findGroup(activeGroup);
  if (g) await ensureSubtree(g);

  menu.refresh();
  buildView();
}

/* 子目录树：第一次用到这个目录时才去扫（只读名字），之后缓存在前端 */
async function ensureSubtree(g) {
  if (!g || g._loaded) return g;
  if (g._pending) return g._pending;
  g._pending = (async () => {
    try {
      const r = await fetch('/api/subtree?g=' + encodeURIComponent(g.key));
      const d = await r.json();
      g.tree = d.tree || [];
      g.loose = d.own || 0;
      g._loaded = true;
    } catch {
      g.tree = g.tree || [];
    } finally {
      g._pending = null;
    }
  })();
  return g._pending;
}

/* ================= 路由（深链）=================
   fg / fp = 从哪一级「系列卡片页」进来的（卡片页的 g 与 parent）。
   看图页的「上一级」终点是卡片页，不是「全部照片」；记住来源才能原路返回。*/
function applyHash() {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const g = q.get('g') || '';
  const s = q.get('sub') || '';
  if (groups.some(x => x.key === g)) { activeGroup = g; activeSub = s; }
  else { activeGroup = ''; activeSub = ''; }

  // 来源只认第一次进页面时带的那一份；页内切目录不该改掉「回去的地方」
  if (!origin._init) {
    origin.fg = q.get('fg') || '';
    origin.fp = q.get('fp') || '';
    origin.g = g;
    origin.sub = s;
    origin._init = true;
  }
}

/* 返回系列卡片页：优先用卡片页显式传来的来源；老深链按入口目录反推 */
function cardsURL() {
  if (origin.fg) {
    const p = new URLSearchParams();
    p.set('g', origin.fg);
    if (origin.fp) p.set('parent', origin.fp);
    return '/?' + p.toString();
  }
  if (!origin.g || !origin.sub) return '/';
  const parent = origin.sub.split('/').slice(0, -1).join('/');
  const p = new URLSearchParams();
  p.set('g', origin.g);
  if (parent) p.set('parent', parent);
  return '/?' + p.toString();
}
function goCards() { location.href = cardsURL(); }

function writeHash() {
  const q = new URLSearchParams();
  if (activeGroup) q.set('g', activeGroup);
  if (activeSub) q.set('sub', activeSub);
  // 来源要一直带着，刷新页面后仍然能原路返回卡片页
  if (origin.fg) q.set('fg', origin.fg);
  if (origin.fp) q.set('fp', origin.fp);
  const h = q.toString();
  try { history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : '')); } catch {}
}
window.addEventListener('hashchange', async () => {
  applyHash();
  const g = findGroup(activeGroup);
  if (g) await ensureSubtree(g);
  menu.refresh();
  buildView();
});

/* ================= 目录树（分支动效）================= */
function findGroup(key) { return groups.find(g => g.key === key); }

async function select(group, sub) {
  activeGroup = group;
  activeSub = sub || '';
  query = '';
  searchEl.value = '';
  writeHash();

  const g = findGroup(group);
  if (g) {
    menu.refresh();            // 先把选中态改过来，别等网络
    await ensureSubtree(g);    // 子目录结构（第一次才扫盘）
  }
  menu.refresh();
  buildView();
  if (window.innerWidth < 900) menu.close();
}

/* 分区瀑布流的渲染和取数都在 masonry.js，这里只负责生成分区 */
const masonry = Masonry({
  grid: gridEl,
  empty: emptyEl,
  count: countEl,
  getSort: () => sortEl.value,
  onNotice: msg => { footerEl.textContent = msg; },
  onOpen: idx => openLightbox(idx),
});

function sectionSpecs() {
  if (query) return [{ key: 'q', title: `搜索「${query}」`, g: '', sub: '', q: query }];

  if (activeSub) {
    return [{ key: 'sub', title: activeSub.split('/').pop(), g: activeGroup, sub: activeSub }];
  }

  if (activeGroup) {
    const g = findGroup(activeGroup);
    if (!g) return [];
    const subs = g.tree || [];
    if (subs.length > 1) {
      const specs = subs.map(n => ({ key: 's:' + n.path, title: n.name, g: g.key, sub: n.path }));
      if (g.loose) specs.push({ key: 's:', title: g.name + '（根目录）', g: g.key, sub: '', loose: true });
      return specs;
    }
    return [{ key: 'g', title: g.name, g: g.key, sub: '' }];
  }

  return groups.map(g => ({ key: 'g:' + g.key, title: g.name, g: g.key, sub: '' }));
}

function buildView() {
  renderCrumbs();
  masonry.setSpecs(sectionSpecs());
}

/* 灯箱翻页用：已加载的照片按分区顺序拼成一条 */
function allLoaded() { return masonry.loadedItems(); }

/* ================= 导航栏：返回 + 橡皮筋分段 =================
   卡片页才是导航顶点：左边固定「← 系列卡片」，点了一定回卡片页，而且永远显示。
   右边的路径分段交给 nav.js 的 SegNav（两页共用，含橡皮筋动画）。*/

let segThumbState = null;   // 上一次选中块的位置，跨重绘做拉伸动画用

function renderCrumbs() {
  const segs = [];
  if (!activeGroup) {
    segs.push({ label: '全部照片', current: true });
  } else {
    const g = findGroup(activeGroup);
    const name = g ? g.name : '';
    if (!activeSub) {
      segs.push({ label: name, current: true });
    } else {
      // 组名 = 一个系列，属于卡片页；点它直接回卡片页，
      // 不再 select(g,'') 把该组所有子目录的照片一起拉起来。
      segs.push({ label: name, onClick: goCards });
      const parts = activeSub.split('/');
      let acc = '';
      parts.forEach((p, i) => {
        acc = acc ? acc + '/' + p : p;
        const cur = acc;   // 固定住当前层级，别让闭包拿到循环结束后的完整路径
        segs.push({ label: p, current: i === parts.length - 1, onClick: () => select(activeGroup, cur) });
      });
    }
  }

  crumbsEl.classList.remove('is-empty');
  segThumbState = SegNav.render(crumbsEl, {
    home: { label: '← 系列卡片', title: '回到系列卡片页（看图页的上一级）', onClick: goCards },
    items: segs,
  }, segThumbState);
}

/* 窗口尺寸 / 字体变化后重新对齐（只对位置，不做动画） */
function syncCrumbsThumb() {
  const st = SegNav.sync(crumbsEl);
  if (st) segThumbState = st;
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => syncCrumbsThumb()).catch(() => {});
}

/* ================= 灯箱 ================= */
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lbImg');
const lbCap = document.getElementById('lbCap');
let lbIdx = 0;

function openLightbox(idx) {
  lbIdx = idx;
  renderLightbox();
  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function renderLightbox() {
  const items = allLoaded();
  const p = items[lbIdx];
  if (!p) return;
  const kb = p.size > 1024 * 1024 ? (p.size / 1048576).toFixed(1) + ' MB' : Math.round(p.size / 1024) + ' KB';
  lbImg.src = '/img?p=' + encodeURIComponent(p.p);
  lbImg.alt = p.name;
  lbCap.textContent = `${p.name}（${kb}）　·　${p.folder || ''}　·　${lbIdx + 1} / ${items.length}`;
}
function closeLightbox() {
  lightbox.classList.add('hidden');
  document.body.style.overflow = '';
}
function step(d) {
  const n = allLoaded().length;
  if (!n) return;
  lbIdx = (lbIdx + d + n) % n;
  renderLightbox();
}

document.getElementById('lbClose').addEventListener('click', closeLightbox);
document.getElementById('lbPrev').addEventListener('click', () => step(-1));
document.getElementById('lbNext').addEventListener('click', () => step(1));
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => {
  if (lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});

/* ================= 事件 ================= */
let debounceT;
window.addEventListener('resize', () => {
  clearTimeout(debounceT);
  debounceT = setTimeout(() => { masonry.relayout(); menu.measureToolbar(); syncCrumbsThumb(); }, 150);
});

let searchT;
searchEl.addEventListener('input', () => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    query = searchEl.value.trim();
    buildView();
  }, 260);
});

sortEl.addEventListener('change', () => masonry.refresh());

load();
