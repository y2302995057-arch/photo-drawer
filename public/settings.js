/* =========================================================
   右上角「设置」：浏览方式 / 背景色 / 卡片风格
   自动挂到 .top-actions（首页）或 .controls（看图页）末尾，
   两页共用一份；偏好由 prefs.js 存 localStorage。
   ========================================================= */
(function () {
  'use strict';

  const GEAR =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>' +
    '</svg>';

  function init() {
    const prefs = window.PW && window.PW.prefs;
    if (!prefs) return;

    const host = document.querySelector('.top-actions') || document.querySelector('.controls');
    if (!host || document.querySelector('.set-btn')) return;

    /* ---------- 按钮 ---------- */
    const btn = document.createElement('button');
    btn.className = 'set-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', '设置');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = '设置';
    btn.innerHTML = GEAR;
    host.appendChild(btn);

    /* ---------- 面板 ---------- */
    const panel = document.createElement('div');
    panel.className = 'set-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '设置');
    panel.innerHTML = `
      <div class="set-head">
        <span>设置</span>
        <button class="set-close" type="button" aria-label="关闭">✕</button>
      </div>

      <div class="set-group">
        <div class="set-label">浏览方式</div>
        <div class="set-options" data-key="view">
          <button type="button" data-val="card">卡片</button>
          <button type="button" data-val="flow">瀑布流</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">卡片</div>
        <div class="set-options" data-key="card">
          <button type="button" data-val="solid">纯白</button>
          <button type="button" data-val="glass">玻璃</button>
          <button type="button" data-val="line">描边</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-label">背景色</div>
        <div class="set-swatches" data-key="bg">
          <button type="button" data-val="blue" title="淡青"><i style="background:linear-gradient(135deg,#dcf0f7,#eef9fa)"></i></button>
          <button type="button" data-val="warm" title="暖砂"><i style="background:linear-gradient(135deg,#f8e8d2,#fdf6ea)"></i></button>
          <button type="button" data-val="gray" title="雾灰"><i style="background:linear-gradient(135deg,#e8ecf2,#f3f5f8)"></i></button>
          <button type="button" data-val="rose" title="薄暮"><i style="background:linear-gradient(135deg,#f7e3e8,#fdf2f5)"></i></button>
          <button type="button" data-val="white" title="纯白"><i style="background:linear-gradient(135deg,#ffffff,#eef0f3)"></i></button>
          <button type="button" data-val="night" title="夜间"><i style="background:linear-gradient(135deg,#2f343d,#14161b)"></i></button>
        </div>
      </div>

    `;
    document.body.appendChild(panel);

    /* ---------- 选中态 ---------- */
    function sync() {
      panel.querySelectorAll('[data-key]').forEach(group => {
        const key = group.dataset.key;
        const cur = prefs.get(key);
        group.querySelectorAll('button[data-val]').forEach(b => {
          b.classList.toggle('is-on', b.dataset.val === cur);
          b.setAttribute('aria-pressed', String(b.dataset.val === cur));
        });
      });
    }

    /* ---------- 开合 ---------- */
    function place() {
      const r = btn.getBoundingClientRect();
      panel.style.top = Math.round(r.bottom + 8) + 'px';
      panel.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    }

    function open() {
      sync();
      place();
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-open');
      requestAnimationFrame(() => panel.classList.add('is-in'));
    }

    function close() {
      panel.classList.remove('is-in');
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-open');
      setTimeout(() => { panel.hidden = true; }, 160);
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });

    panel.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      const key = b.closest('[data-key]').dataset.key;
      prefs.set(key, b.dataset.val);
      sync();

      /* 在看图页选「卡片」→ 回首页；其它组合留在原地由各页自己响应 */
      if (key === 'view' && b.dataset.val === 'card' && location.pathname === '/view') {
        setTimeout(() => location.href = '/', 120);
      }
    });

    panel.querySelector('.set-close').addEventListener('click', close);

    document.addEventListener('click', () => { if (!panel.hidden) close(); });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); close(); }
    }, true);
    window.addEventListener('resize', () => { if (!panel.hidden) place(); });

    prefs.onChange(() => sync());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
