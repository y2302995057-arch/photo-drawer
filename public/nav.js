/* =========================================================
   全局目录菜单：左上角「+ 目录」按钮 + 抽屉目录树
   首页（系列卡片）和看图页共用这一份，行为和样式都只有一套。

   用法：
     const menu = DirMenu({
       buttonHost: document.querySelector('.toolbar-inner'), // 按钮插到哪
       homeLabel: '返回系列卡片',   // 可选，抽屉第一项
       onHome: () => {},            // 可选
       onPick: (g, path) => {},     // 点某个目录：g 可能为 null（全部照片）
       active: () => ({ g, sub }),  // 当前高亮
       onToggle: open => {},        // 开合后（看图页用来重排瀑布流）
     });
     await menu.ready;              // groups 加载完
   ========================================================= */
(function () {
  'use strict';

  const EASE = 'cubic-bezier(.22,1,.36,1)';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* =========================================================
     路径分段：蓝色返回胶囊 + 橡皮筋分段（首页 / 看图页共用）
     render(host, cfg, prev) 返回新的选中块位置，下次传回来就
     会做「先拉长到起点∪终点、再弹回」的动画。
     ========================================================= */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function layoutThumb(seg, thumb, target, prev) {
    const to = { left: target.offsetLeft, width: target.offsetWidth };
    thumb.style.left = to.left + 'px';
    thumb.style.width = to.width + 'px';
    if (!prev || Math.abs(prev.left - to.left) < 1) return to;

    const maxW = Math.max(seg.offsetWidth, 40);
    const from = {
      left: clamp(prev.left, 0, Math.max(0, maxW - 24)),
      width: clamp(prev.width, 24, maxW),
    };
    if (Math.abs(from.left - to.left) < 1) return to;

    const a = Math.min(from.left, to.left);
    const b = Math.max(from.left + from.width, to.left + to.width);

    thumb.style.left = from.left + 'px';
    thumb.style.width = from.width + 'px';

    requestAnimationFrame(() => {
      thumb.animate([
        { left: from.left + 'px', width: from.width + 'px' },
        { left: a + 'px', width: (b - a) + 'px', offset: 0.45 },
        { left: to.left + 'px', width: to.width + 'px' },
      ], { duration: 430, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      thumb.style.left = to.left + 'px';
      thumb.style.width = to.width + 'px';
    });
    return to;
  }

  window.SegNav = {
    render(host, cfg, prev) {
      host.innerHTML = '';

      const home = document.createElement('button');
      home.type = 'button';
      home.className = 'crumb-home' + (cfg.home.dot ? ' has-dot' : '');
      if (cfg.home.dot) home.innerHTML = '<span class="crumb-dot" aria-hidden="true"></span>';
      home.appendChild(document.createTextNode(cfg.home.label));
      if (cfg.home.title) home.title = cfg.home.title;
      if (cfg.home.disabled) {
        home.disabled = true;
        home.classList.add('is-root');
      } else if (cfg.home.onClick) {
        home.addEventListener('click', cfg.home.onClick);
      }
      host.appendChild(home);

      const seg = document.createElement('div');
      seg.className = 'seg';
      const thumb = document.createElement('div');
      thumb.className = 'seg-thumb';
      seg.appendChild(thumb);

      const items = [];
      for (const it of cfg.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-item' + (it.current ? ' is-current' : '');
        b.textContent = it.label;
        if (!it.current && it.onClick) b.addEventListener('click', it.onClick);
        seg.appendChild(b);
        items.push(b);
      }
      host.appendChild(seg);

      const cur = items[items.length - 1];
      const state = layoutThumb(seg, thumb, cur, prev);

      requestAnimationFrame(() => {
        const box = host.getBoundingClientRect();
        const r = cur.getBoundingClientRect();
        if (r.right > box.right - 14) host.scrollLeft += r.right - box.right + 16;
        else if (r.left < box.left + 14) host.scrollLeft -= box.left - r.left + 16;
      });

      return state;
    },

    sync(host) {
      const seg = host.querySelector('.seg');
      const thumb = host.querySelector('.seg-thumb');
      const cur = host.querySelector('.seg-item.is-current');
      if (!seg || !thumb || !cur) return null;
      const to = { left: cur.offsetLeft, width: cur.offsetWidth };
      thumb.style.left = to.left + 'px';
      thumb.style.width = to.width + 'px';
      return to;
    },
  };

  window.DirMenu = function createDirMenu(opts) {    const o = opts || {};
    const showAll = o.showAll !== false;

    let groups = [];
    let roots = [];
    const openSections = new Set();
    const openNodes = new Set();
    let open = false;

    let readyResolve;
    const ready = new Promise(r => { readyResolve = r; });

    /* ---------------- 按钮 ---------------- */
    const btn = el('button', 'menu-toggle',
      '<span class="mt-icon" aria-hidden="true">' +
        '<span class="mt-icon-line"></span><span class="mt-icon-line mt-icon-line-v"></span>' +
      '</span>' +
      '<span class="mt-textWrap" aria-hidden="true"><span class="mt-textInner" id="mtText">' +
        '<span class="mt-line">目录</span><span class="mt-line">收起</span>' +
      '</span></span>');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'dirPanel');
    btn.setAttribute('aria-label', '打开目录菜单');
    if (o.buttonHost) o.buttonHost.insertBefore(btn, o.buttonHost.firstChild);

    const iconEl = btn.querySelector('.mt-icon');
    const textEl = btn.querySelector('.mt-textInner');

    /* ---------------- 抽屉 ---------------- */
    const prelayers = el('div', 'menu-prelayers',
      '<div class="menu-prelayer"></div><div class="menu-prelayer"></div>');
    prelayers.setAttribute('aria-hidden', 'true');

    const scrim = el('div', 'menu-scrim');
    scrim.setAttribute('aria-hidden', 'true');

    const panel = el('aside', 'menu-panel',
      '<div class="menu-panel-inner">' +
        '<div class="menu-panel-head">' +
          '<span class="mph-title">照片目录</span><span class="mph-meta"></span>' +
        '</div>' +
        '<nav class="tree"></nav>' +
        '<div class="menu-panel-foot"></div>' +
      '</div>');
    panel.id = 'dirPanel';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', '照片目录');

    document.body.appendChild(prelayers);
    document.body.appendChild(scrim);
    document.body.appendChild(panel);

    const treeEl = panel.querySelector('.tree');
    const metaEl = panel.querySelector('.mph-meta');
    const footEl = panel.querySelector('.menu-panel-foot');

    panel.style.transform = 'translateX(-101%)';
    panel.style.opacity = '0';
    [].forEach.call(prelayers.children, n => { n.style.transform = 'translateX(-100%)'; n.style.opacity = '0'; });

    /* ---------------- 数据 ---------------- */
    function ensureSubtree(g) {
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

    async function loadTree() {
      try {
        const r = await fetch('/api/tree');
        if (r.status === 401) { location.replace('/login'); return; }
        const d = await r.json();
        groups = d.groups || [];
        roots = d.roots || [];
      } catch {
        groups = [];
        roots = [];
      }
      metaEl.textContent = groups.length + ' 个目录';
      footEl.innerHTML = '<span class="mf-dot"></span>来自 ' + esc(roots.join('  |  '));
      readyResolve(groups);
    }

    function activeState() {
      const a = typeof o.active === 'function' ? o.active() : null;
      return { g: (a && a.g) || '', sub: (a && a.sub) || '' };
    }

    /* ---------------- 渲染 ---------------- */
    function buildMenu() {
      const scrollTop = treeEl.scrollTop;
      treeEl.innerHTML = '';
      const act = activeState();

      let idx = 0;

      if (o.homeLabel && o.onHome) {
        const home = el('button', 'tree-home',
          '<span class="th-arrow" aria-hidden="true">←</span><span class="ta-label">' + esc(o.homeLabel) + '</span>');
        home.type = 'button';
        home.style.setProperty('--i', idx++);
        home.title = '回到系列卡片页（看图页的上一级）';
        home.addEventListener('click', () => { close(); o.onHome(); });
        treeEl.appendChild(home);
      }

      if (showAll) {
        const all = el('button', 'tree-all',
          '<span class="ta-label">全部照片</span><span class="ta-count">整个照片库</span>');
        all.type = 'button';
        all.style.setProperty('--i', idx++);
        all.dataset.active = !act.g ? '' : undefined;
        all.title = '浏览所有目录的照片，目录多时加载会比较久';
        all.addEventListener('click', () => pick(null, ''));
        treeEl.appendChild(all);
      }

      if (act.g) openSections.add(act.g);
      if (act.sub) {
        let acc = '';
        for (const p of act.sub.split('/')) {
          acc = acc ? acc + '/' + p : p;
          openNodes.add(act.g + '|' + acc);
        }
      }

      const counter = { value: idx };
      for (const g of groups) {
        const sec = el('div', 'tree-section');
        sec.dataset.key = g.key;
        const isOpen = openSections.has(g.key);
        if (isOpen) sec.dataset.open = '';
        if (act.g === g.key) sec.dataset.hasActive = '';

        const head = el('button', 'tree-head',
          '<span class="th-chev" aria-hidden="true"></span><span class="th-name"></span>');
        head.type = 'button';
        head.style.setProperty('--i', counter.value++);
        head.setAttribute('aria-expanded', String(isOpen));
        head.querySelector('.th-name').textContent = g.name;

        head.addEventListener('click', e => {
          const onChev = !!e.target.closest('.th-chev');
          const willOpen = !openSections.has(g.key);
          if (willOpen) openSections.add(g.key); else openSections.delete(g.key);
          sec.toggleAttribute('data-open', willOpen);
          head.setAttribute('aria-expanded', String(willOpen));
          if (!onChev) { pick(g, ''); return; }
          if (willOpen && !g._loaded) ensureSubtree(g).then(() => { if (openSections.has(g.key)) buildMenu(); });
        });

        sec.appendChild(head);

        const body = el('div', 'tree-body');
        const fold = el('div', 'tree-fold');
        const kids = el('div', 'tree-kids');
        kids.appendChild(renderNodes(g, g.tree || [], 0, counter, act));
        fold.appendChild(kids);
        body.appendChild(fold);
        sec.appendChild(body);
        treeEl.appendChild(sec);
      }

      treeEl.scrollTop = scrollTop;
      primeTreeRows();
    }

    function renderNodes(g, nodes, depth, counter, act) {
      const wrap = document.createDocumentFragment();
      for (const n of nodes) {
        const nodeKey = g.key + '|' + n.path;
        const hasKids = n.children && n.children.length > 0;
        const row = el('div', 'tree-item' + (hasKids ? ' has-kids' : ''));
        row.dataset.path = n.path;
        row.style.setProperty('--depth', depth);
        if (act.g === g.key && act.sub === n.path) row.dataset.active = '';

        const b = el('button', 'tree-node',
          (hasKids
            ? '<span class="tn-chev' + (openNodes.has(nodeKey) ? ' on' : '') + '" aria-hidden="true"></span>'
            : '<span class="tn-dot" aria-hidden="true"></span>') +
          '<span class="tn-name"></span>');
        b.type = 'button';
        b.style.setProperty('--i', counter.value++);
        b.querySelector('.tn-name').textContent = n.name;

        b.addEventListener('click', e => {
          const onChev = !!e.target.closest('.tn-chev');
          if (hasKids && (onChev || act.sub === n.path)) {
            const willOpen = !openNodes.has(nodeKey);
            if (willOpen) openNodes.add(nodeKey); else openNodes.delete(nodeKey);
            const chev = b.querySelector('.tn-chev');
            if (chev) chev.classList.toggle('on', willOpen);
            row.toggleAttribute('data-open', hasKids && willOpen);
            const box = row.querySelector(':scope > .tree-kids');
            if (box) box.style.display = hasKids && willOpen ? '' : 'none';
            return;
          }
          pick(g, n.path);
        });

        row.appendChild(b);

        if (hasKids) {
          const kids = el('div', 'tree-kids nested');
          kids.style.display = openNodes.has(nodeKey) ? '' : 'none';
          row.toggleAttribute('data-open', openNodes.has(nodeKey));
          kids.appendChild(renderNodes(g, n.children, depth + 1, counter, act));
          row.appendChild(kids);
        }
        wrap.appendChild(row);
      }
      return wrap;
    }

    function pick(g, path) {
      close();
      if (o.onPick) o.onPick(g, path || '');
    }

    /* ---------------- 抽屉动效 ---------------- */
    function measureToolbar() {
      const tb = document.querySelector('.toolbar') || document.querySelector('.top');
      if (tb) document.documentElement.style.setProperty('--tb-h', Math.round(tb.getBoundingClientRect().height) + 'px');
    }

    function primeTreeRows() {
      const rows = treeEl.querySelectorAll('.tree-home, .tree-head, .tree-all');
      rows.forEach((node, idx) => {
        const i = Number(node.style.getPropertyValue('--i') || idx);
        node.style.transition = 'none';
        if (open) { node.style.transform = 'none'; node.style.opacity = '1'; }
        else { node.style.transform = 'translateY(120%) rotate(6deg)'; node.style.opacity = '0'; }
        node.style.transitionDelay = '0s';
        void i;
      });
    }

    function animateTreeRows(show) {
      const rows = treeEl.querySelectorAll('.tree-home, .tree-head, .tree-all');
      rows.forEach((node, idx) => {
        const i = Number(node.style.getPropertyValue('--i') || idx);
        const delay = show ? 0.2 + i * 0.035 : 0;
        node.style.transition = 'transform .7s ' + EASE + ' ' + delay + 's, opacity .5s ease ' + delay + 's';
        node.style.transform = show ? 'none' : 'translateY(120%) rotate(6deg)';
        node.style.opacity = show ? '1' : '0';
      });
    }

    function cycleLabel(target) {
      if (!textEl) return;
      const cur = textEl.dataset.label || '目录';
      if (cur === target && textEl.children.length) return;
      const seq = [cur];
      let last = cur;
      for (let i = 0; i < 3; i++) { last = last === '目录' ? '收起' : '目录'; seq.push(last); }
      if (last !== target) seq.push(target);
      seq.push(target);

      textEl.dataset.label = target;
      textEl.innerHTML = seq.map(t => '<span class="mt-line">' + t + '</span>').join('');
      const n = seq.length;
      textEl.style.transition = 'none';
      textEl.style.transform = 'translateY(0)';
      void textEl.offsetHeight;
      textEl.style.transition = 'transform ' + (0.42 + n * 0.06) + 's ' + EASE;
      textEl.style.transform = 'translateY(-' + ((n - 1) / n) * 100 + '%)';
    }

    function setMenu(show) {
      if (show === open) return;
      open = show;
      measureToolbar();
      if (show) buildMenu();

      const layers = [...prelayers.children];
      layers.forEach((n, i) => {
        n.style.transition = 'transform .55s ' + EASE + ' ' + (show ? i * 0.07 : 0) + 's, opacity .3s ease ' + (show ? i * 0.07 : 0) + 's';
        n.style.transform = show ? 'translateX(0)' : 'translateX(-100%)';
        n.style.opacity = show ? '1' : '0';
      });

      panel.style.transition = 'transform .62s ' + EASE + ' ' + (show ? 0.16 : 0) + 's, opacity .3s ease ' + (show ? 0.16 : 0) + 's';
      panel.style.transform = show ? 'translateX(0)' : 'translateX(-101%)';
      panel.style.opacity = show ? '1' : '0';

      document.body.classList.toggle('menu-open', show);
      btn.setAttribute('aria-expanded', String(show));
      btn.setAttribute('aria-label', show ? '关闭目录菜单' : '打开目录菜单');
      panel.setAttribute('aria-hidden', String(!show));
      scrim.style.opacity = show ? '1' : '0';

      iconEl.style.transition = 'transform .8s ' + EASE;
      iconEl.style.transform = show ? 'rotate(225deg)' : 'rotate(0deg)';
      cycleLabel(show ? '收起' : '目录');

      animateTreeRows(show);

      if (o.onToggle) o.onToggle(show);
    }

    function close() { if (open) setMenu(false); }

    btn.addEventListener('click', () => setMenu(!open));
    scrim.addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const lb = document.getElementById('lightbox');
      if (lb && !lb.classList.contains('hidden')) return;   // 灯箱打开时先关灯箱
      if (open) setMenu(false);
    });

    loadTree();

    return {
      btn,
      panel,
      treeEl,
      ready,
      get groups() { return groups; },
      get isOpen() { return open; },
      toggle: () => setMenu(!open),
      open: () => setMenu(true),
      close,
      refresh: () => buildMenu(),
      measureToolbar,
      findGroup: key => groups.find(g => g.key === key),
    };
  };
})();
