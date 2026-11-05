/* 系列卡片：照片根目录下的文件夹 = 一个系列。
   根视图列出照片根下所有系列；某个系列里还有子文件夹时可继续下钻，没有则直接看图。
   白色大圆角卡版式（大图 / 名字+徽章 / 描述 / 统计 / 进入按钮），手机端两卡并列。
   封面固定取该系列按目录顺序找到的第一张图片（服务端 /api/series 的 cover）。
   卡片不随鼠标倾斜，也没有任何跟随鼠标的光效。 */
// 产品名来自 config.json 的 appName（/api/meta），标题跟随，便于分发时改名
fetch('/api/meta').then(r => r.json()).then(m => { if (m && m.name) document.title = m.name; }).catch(() => {});
const $ = s => document.querySelector(s);
const gridEl = $('#grid');
const crumbsEl = $('#crumbs');
const qEl = $('#q');
const metaL = $('#metaLeft');
const metaR = $('#metaRight');
const emptyEl = $('#empty');
const footEl = $('#foot');

/* 瀑布流模式：和看图页共用 masonry.js，每个顶层文件夹一个分区 */
const flow = Masonry({
  grid: gridEl,
  empty: emptyEl,
  onNotice: msg => { metaR.textContent = msg; },
  onOpen: idx => {
    const p = flow.loadedItems()[idx];
    if (p) window.open('/img?p=' + encodeURIComponent(p.p), '_blank', 'noopener');
  },
});

/* 目录按钮 + 抽屉：和看图页共用 nav.js。点目录 → 去看图页看这个目录的照片 */
const dirMenu = DirMenu({
  buttonHost: document.querySelector('.top-inner'),
  onPick: (g, path) => {
    if (!g) { location.href = '/view'; return; }
    const q = new URLSearchParams({ g: g.key, fg: g.key });
    if (path) q.set('sub', path);
    location.href = '/view#' + q.toString();
  },
  active: () => ({ g: state.groupKey, sub: state.parent || '' }),
});

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// root=根视图（列出照片根下所有系列）；否则是在某个系列内部下钻
let state = { root: true, groupKey: '', groupName: '', rootLabel: '照片', parent: '', items: [], scanMs: 0 };

/* "LS Studios Collection - LS Land 01-08" → 主标题 */
function splitName(name) {
  const i = name.indexOf(' - ');
  if (i > 0) return { main: name.slice(i + 3).trim() || name };
  return { main: name };
}

function cardHTML(it, i) {
  const { main } = splitName(it.name);
  const cover = it.cover ? '/thumb?p=' + encodeURIComponent(it.cover) : '';
  const dirs = Number(it.dirs) || 0;
  const no = String(i + 1).padStart(2, '0');
  const total = String(state.items.length).padStart(2, '0');
  // 描述里放全名、子文件夹数、序号 —— 不统计照片数量，但把可读信息给足
  const desc = dirs ? `${dirs} 个子文件夹` : '直接看图';
  return `<article class="pc${cover ? '' : ' no-cover'}" style="--i:${i}" data-i="${i}"
    tabindex="0" role="link" aria-label="${esc(it.name)}">
    <div class="pc-card">
      <div class="pc-media">
        ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="pc-fallback" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>
        <div class="pc-glass" aria-hidden="true"></div>
      </div>
      <div class="pc-body">
        <div class="pc-title-row">
          <h2 class="pc-name">${esc(main)}</h2>
          <span class="pc-verified" title="已收录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span>
        </div>
        <p class="pc-desc">${esc(desc)}</p>
        <div class="pc-foot">
          <div class="pc-stats">
            <span class="pc-stat" title="子文件夹数"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><b>${dirs}</b></span>
            <span class="pc-stat" title="系列序号 / 总数"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 17l5-5 3.5 3.5L16 12l4 5"/></svg><b>${no}/${total}</b></span>
          </div>
          <button class="pc-follow" type="button">
            <svg class="fb-arrow fb-arrow-left" viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            <span class="fb-text">查看</span>
            <span class="fb-circle" aria-hidden="true"></span>
            <svg class="fb-arrow fb-arrow-right" viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>
      </div>
    </div>
  </article>`;
}

let segThumbState = null;

function renderCrumbs() {
  const items = [];
  if (state.root) {
    items.push({ label: '全部系列', current: true });
  } else {
    const segs = state.parent ? state.parent.split('/') : [];
    const chain = [state.groupName, ...segs];
    chain.forEach((label, idx) => {
      const parent = idx === 0 ? '' : segs.slice(0, idx).join('/');
      const current = idx === chain.length - 1;
      items.push({
        label,
        current,
        onClick: current ? null : () => load(state.groupKey, parent),
      });
    });
  }

  segThumbState = SegNav.render(crumbsEl, {
    home: {
      label: state.rootLabel || '照片',
      dot: true,
      title: state.root ? '已经在第一层了' : '回到第一层',
      disabled: state.root,
      onClick: state.root ? null : () => load('', ''),
    },
    items,
  }, segThumbState);
}

function render() {
  if (PW.prefs.get('view') === 'flow') return renderFlow();
  return renderCards();
}

/* 瀑布流：按顶层文件夹分区，滚到哪加载哪 */
function renderFlow() {
  gridEl.classList.add('is-flow');
  emptyEl.classList.add('hidden');
  const filter = document.querySelector('.filter');
  if (filter) filter.hidden = true;      // 瀑布流是分区铺图，筛选系列名在这里没意义
  metaL.textContent = '全部照片';
  metaR.textContent = '';
  footEl.textContent = '';
  flow.setSpecs((dirMenu.groups || []).filter(g => g.kind === 'folder').map(g => ({
    key: 'g:' + g.key,
    title: g.name,
    g: g.key,
    sub: '',
  })));
}

function renderCards() {
  const wasFlow = gridEl.classList.contains('is-flow');
  gridEl.classList.remove('is-flow');
  const filter = document.querySelector('.filter');
  if (filter) filter.hidden = false;
  if (wasFlow) window.scrollTo({ top: 0, behavior: 'smooth' });
  const kw = qEl.value.trim().toLowerCase();
  const list = state.items.filter(x => !kw || x.name.toLowerCase().includes(kw));
  gridEl.innerHTML = list.map((it, i) => cardHTML(it, i)).join('');

  const here = state.root ? state.rootLabel : (state.parent ? state.parent.split('/').pop() : state.groupName);
  metaL.textContent = `${here} · ${state.items.length} 个系列`;
  metaR.textContent = kw ? `匹配 ${list.length} / ${state.items.length}` : '';

  if (!list.length) {
    emptyEl.classList.remove('hidden');
    let btn = '';
    if (kw) btn = '<button class="back" id="emptyBack" type="button">清除筛选</button>';
    else if (!state.root) btn = state.parent
      ? '<button class="back" id="emptyBack" type="button">返回上一层</button>'
      : '<button class="back" id="emptyBack" type="button">浏览这个系列的照片</button>';
    emptyEl.innerHTML = `<span class="empty-icon" aria-hidden="true">◇</span>
      <p>${kw ? '没有匹配的系列' : (state.root ? '还没有系列文件夹：把照片按文件夹分好，放进照片目录里' : '这一层没有子文件夹，照片就在当前目录里')}</p>${btn}`;
    const b = $('#emptyBack');
    if (b) b.onclick = () => {
      if (kw) { qEl.value = ''; render(); }
      else if (!state.root && state.parent) load(state.groupKey, state.parent.split('/').slice(0, -1).join('/'));
      else if (!state.root) goPhotos(state.groupKey, '');
    };
  } else emptyEl.classList.add('hidden');

  footEl.textContent = '';
}

function goPhotos(key, sub) {
  const q = new URLSearchParams();
  if (key) q.set('g', key);
  if (sub) q.set('sub', sub);
  // 带上「从哪一级卡片页点进来的」，看图页点「返回系列」时原路回到这一层，
  // 而不是掉回卡片首页或误触发整个照片库加载。
  if (state.groupKey) q.set('fg', state.groupKey);
  if (state.parent) q.set('fp', state.parent);
  location.href = '/view#' + q.toString();
}

async function load(groupKey, parent, keepFilter = false) {
  metaL.textContent = '正在读取目录…';
  try {
    const q = new URLSearchParams();
    if (groupKey) q.set('g', groupKey);
    if (parent) q.set('parent', parent);
    const r = await fetch('/api/series?' + q.toString());
    if (r.status === 401) { location.replace('/login'); return; }
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    state = {
      root: !!d.root,
      groupKey: d.root ? '' : (d.group ? d.group.key : ''),
      groupName: d.root ? '' : (d.group ? d.group.name : ''),
      rootLabel: d.rootLabel || '照片',
      parent: d.parent || '',
      items: d.items || [],
      scanMs: d.scanMs || 0,
    };
    if (!keepFilter) qEl.value = '';
    renderCrumbs();
    render();
    const url = '/' + (groupKey ? '?g=' + encodeURIComponent(groupKey) + (parent ? '&parent=' + encodeURIComponent(parent) : '') : '');
    try { history.replaceState(null, '', url); } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    gridEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = `<span class="empty-icon" aria-hidden="true">◇</span><p>读取失败：${esc(e.message)}</p>`;
  }
}

/* 封面加载失败时退成渐变占位 */
gridEl.addEventListener('error', e => {
  if (e.target && e.target.tagName === 'IMG') {
    const card = e.target.closest('.pc');
    if (card) card.classList.add('no-cover');
  }
}, true);

gridEl.addEventListener('click', e => {
  const card = e.target.closest('.pc');
  if (!card) return;
  const it = state.items[Number(card.dataset.i)];
  if (!it) return;
  if (it.hasChildren) load(it.key || state.groupKey, it.sub || '');
  else goPhotos(it.key || state.groupKey, it.sub || '');
});
gridEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const card = e.target.closest('.pc');
    if (card) { e.preventDefault(); card.click(); }
  }
});
qEl.addEventListener('input', render);

PW.prefs.onChange(k => { if (k === 'view') render(); });

(async () => {
  await dirMenu.ready;                 // 瀑布流模式要用目录列表
  const sp = new URLSearchParams(location.search);
  load(sp.get('g') || '', sp.get('parent') || '');
})();
