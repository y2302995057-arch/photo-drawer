/* =========================================================
   分区瀑布流（首页的「瀑布流」模式和看图页共用）
   - 每个分区独立分页，进入视口附近才加载
   - 自动加载有上限，超过后只保留「继续加载」
   - 只负责渲染和取数；点图、灯箱、排序控件由调用方给
   ========================================================= */
(function () {
  'use strict';

  const GAP = 12, COL_W = 240, STAGGER = 0.05, PAGE = 120;
  const SKELETON_H = 520;      // 没加载前的占位高度，避免所有分区挤进视口
  const AUTO_LOAD_MAX = 2500;  // 单个视图自动加载上限

  window.Masonry = function createMasonry(opts) {
    const o = opts || {};
    const gridEl = o.grid;
    const emptyEl = o.empty || null;
    const countEl = o.count || null;
    const getSort = o.getSort || (() => 'seq');
    const onNotice = o.onNotice || (() => {});
    const onOpen = o.onOpen || (() => {});

    let sections = [];
    let openSeq = 0;
    let tileObserver = null;
    let moreObserver = null;

    /* ---------------- 分区 ---------------- */
    function setSpecs(specs) {
      stopObservers();
      gridEl.innerHTML = '';
      sections = [];
      if (emptyEl) emptyEl.classList.add('hidden');

      if (!specs.length) {
        updateCount();
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      for (const spec of specs) sections.push(createSection(spec));
      updateCount();
      observeSections();
    }

    function createSection(spec) {
      const sec = {
        key: spec.key, title: spec.title, g: spec.g, sub: spec.sub || '', q: spec.q || '',
        loose: !!spec.loose, total: spec.total, items: [], offset: 0,
        loading: false, done: false, hasMore: true, cols: [], heights: [], colCount: 0,
      };

      const el = document.createElement('section');
      el.className = 'section';

      const head = document.createElement('div');
      head.className = 'section-head';
      const h = document.createElement('h2');
      h.textContent = spec.title;
      head.appendChild(h);
      const cnt = document.createElement('span');
      cnt.className = 'section-count';
      head.appendChild(cnt);
      el.appendChild(head);

      const masonry = document.createElement('div');
      masonry.className = 'masonry';
      el.appendChild(masonry);

      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'load-more';
      more.textContent = '加载中…';
      more.addEventListener('click', () => loadSection(sec));
      el.appendChild(more);

      sec.el = el; sec.headEl = head; sec.countEl = cnt;
      sec.masonryEl = masonry; sec.moreEl = more;
      el.style.minHeight = SKELETON_H + 'px';

      gridEl.appendChild(el);
      updateSectionHead(sec);
      return sec;
    }

    function updateSectionHead(sec) {
      const loaded = sec.items.length;
      if (sec.total == null) sec.countEl.textContent = loaded ? `已加载 ${loaded} 张` : '—';
      else sec.countEl.textContent = loaded >= sec.total ? `${sec.total} 张` : `已加载 ${loaded} / ${sec.total} 张`;

      if (sec.done) {
        sec.moreEl.textContent = sec.total != null ? `已全部加载（${sec.total} 张）` : `已全部加载（${loaded} 张）`;
        sec.moreEl.disabled = true;
        sec.moreEl.classList.add('done');
      } else if (sec.loading) {
        sec.moreEl.textContent = '加载中…';
        sec.moreEl.disabled = true;
        sec.moreEl.classList.remove('done');
      } else {
        sec.moreEl.textContent = sec.items.length ? '加载更多' : '加载';
        sec.moreEl.disabled = false;
        sec.moreEl.classList.remove('done');
      }
    }

    function updateCount() {
      if (!countEl) return;
      const loaded = sections.reduce((n, s) => n + s.items.length, 0);
      const known = sections.length > 0 && sections.every(s => s.total != null);
      const total = known ? sections.reduce((n, s) => n + s.total, 0) : null;
      countEl.textContent = total == null ? `${loaded} 张` : (loaded >= total ? `${total} 张` : `${loaded} / ${total} 张`);
    }

    /* ---------------- 分页取数 ---------------- */
    async function loadSection(sec) {
      if (sec.loading || sec.done || !sec.el.isConnected) return;
      sec.loading = true;
      updateSectionHead(sec);

      const myOpen = openSeq;
      const params = new URLSearchParams({
        g: sec.g, sub: sec.sub, offset: String(sec.offset), limit: String(PAGE),
        sort: getSort(), q: sec.q,
      });
      if (sec.loose) params.set('loose', '1');

      try {
        const res = await fetch('/api/photos?' + params.toString());
        if (res.status === 401) return location.replace('/login');
        const data = await res.json();
        if (myOpen !== openSeq || !sec.el.isConnected) return;   // 视图已切换，丢弃
        if (data.error) { sec.loading = false; sec.done = true; updateSectionHead(sec); return; }

        if (data.sortFallback && getSort() !== 'seq') {
          onNotice('该范围照片太多，已自动改回「顺序 · 按文件夹」排序（按时间/大小排序需要全部读入内存）');
        }
        if (typeof data.total === 'number') sec.total = data.total;
        sec.loading = false;
        appendItems(sec, data.items || []);
        sec.offset += (data.items || []).length;
        sec.hasMore = !!data.hasMore;
        if (!sec.hasMore) sec.done = true;
        if (sec.items.length) sec.el.style.minHeight = '';
        updateSectionHead(sec);
        updateCount();
        if (!sec.done) sec.moreEl.textContent = '加载更多';
      } catch {
        if (myOpen === openSeq) { sec.loading = false; sec.moreEl.textContent = '加载失败，点击重试'; }
      }
    }

    function appendItems(sec, items) {
      if (!items.length) return;
      if (!sec.cols.length) buildColumns(sec);
      const tiles = [];
      for (const p of items) {
        const i = sec.items.length;
        sec.items.push(p);
        const tile = makeTile(sec, p, i);
        const min = sec.heights.indexOf(Math.min(...sec.heights));
        sec.cols[min].appendChild(tile);
        sec.heights[min] += COL_W * 1.2 + GAP;
        tiles.push(tile);
      }
      observeTiles(tiles);
    }

    function buildColumns(sec) {
      const w = sec.masonryEl.clientWidth || gridEl.clientWidth || 1200;
      const n = Math.max(1, Math.floor((w + GAP) / (COL_W + GAP)));
      sec.masonryEl.innerHTML = '';
      sec.cols = [];
      sec.heights = new Array(n).fill(0);
      sec.colCount = n;
      for (let i = 0; i < n; i++) {
        const c = document.createElement('div');
        c.className = 'col';
        sec.masonryEl.appendChild(c);
        sec.cols.push(c);
      }
    }

    function makeTile(sec, p, i) {
      const fig = document.createElement('figure');
      fig.className = 'tile';
      fig.style.setProperty('--d', Math.min((i % Math.max(1, sec.colCount)) * STAGGER, 0.6) + 's');

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = p.name;
      img.src = '/thumb?p=' + encodeURIComponent(p.p);
      fig.appendChild(img);

      const cap = document.createElement('figcaption');
      cap.textContent = p.sub ? `${p.name} · ${p.sub}` : p.name;
      fig.appendChild(cap);

      fig.addEventListener('click', () => onOpen(flatIndex(sec, i)));
      return fig;
    }

    /* ---------------- 供灯箱使用 ---------------- */
    function loadedItems() {
      const out = [];
      for (const s of sections) out.push(...s.items);
      return out;
    }

    function flatIndex(sec, i) {
      let base = 0;
      for (const s of sections) {
        if (s === sec) return base + i;
        base += s.items.length;
      }
      return 0;
    }

    /* ---------------- 懒加载 ---------------- */
    function stopObservers() {
      if (tileObserver) tileObserver.disconnect();
      if (moreObserver) moreObserver.disconnect();
      tileObserver = null;
      moreObserver = null;
    }

    function observeTiles(els) {
      if (!tileObserver) {
        tileObserver = new IntersectionObserver(entries => {
          for (const e of entries) {
            if (e.isIntersecting) { e.target.classList.add('in'); tileObserver.unobserve(e.target); }
          }
        }, { rootMargin: '80px 0px' });
      }
      for (const el of els) tileObserver.observe(el);
    }

    function observeSections() {
      moreObserver = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const sec = sections.find(s => s.moreEl === e.target);
          if (!sec || sec.loading || sec.done) continue;
          const loaded = sections.reduce((n, s) => n + s.items.length, 0);
          if (loaded >= AUTO_LOAD_MAX) { markManual(sec); continue; }
          loadSection(sec);
        }
      }, { rootMargin: '300px 0px' });
      for (const s of sections) moreObserver.observe(s.moreEl);
    }

    function markManual(sec) {
      if (sec.loading || sec.done) return;
      sec.moreEl.textContent = '继续加载（已自动加载较多，点击继续）';
    }

    /* ---------------- 重新布局 ---------------- */
    function relayout() {
      for (const sec of sections) {
        if (!sec.items.length) continue;
        buildColumns(sec);
        for (let i = 0; i < sec.items.length; i++) {
          const tile = makeTile(sec, sec.items[i], i);
          const min = sec.heights.indexOf(Math.min(...sec.heights));
          sec.cols[min].appendChild(tile);
          sec.heights[min] += COL_W * 1.2 + GAP;
        }
        observeTiles([...sec.masonryEl.querySelectorAll('.tile')]);
      }
    }

    /* ---------------- 排序变化：全部从第一页重取 ---------------- */
    function refresh() {
      openSeq++;
      for (const sec of sections) {
        sec.items = []; sec.offset = 0; sec.done = false; sec.hasMore = true; sec.loading = false;
        sec.masonryEl.innerHTML = '';
        sec.cols = []; sec.heights = [];
        updateSectionHead(sec);
      }
      updateCount();
      for (const sec of sections) loadSection(sec);
    }

    function destroy() {
      stopObservers();
      openSeq++;
      sections = [];
      gridEl.innerHTML = '';
    }

    return {
      setSpecs,
      refresh,
      relayout,
      destroy,
      loadedItems,
      get sections() { return sections; },
    };
  };
})();
