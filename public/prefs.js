/* =========================================================
   用户偏好：浏览方式 / 背景色 / 卡片风格
   存在 localStorage，必须在 <head> 里同步加载，
   否则页面会先按默认主题画一帧再跳变（闪一下）。
   ========================================================= */
(function () {
  'use strict';

  const KEY = 'pw.prefs';
  const DEFAULTS = { view: 'card', bg: 'blue', card: 'solid' };
  const listeners = new Set();

  let data = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') data = { ...DEFAULTS, ...obj };
    }
  } catch {}

  function apply() {
    const h = document.documentElement;
    h.dataset.bg = data.bg;
    h.dataset.card = data.card;
  }

  window.PW = window.PW || {};
  window.PW.prefs = {
    defaults: DEFAULTS,
    all: () => ({ ...data }),
    get: k => data[k],
    set(k, v) {
      if (data[k] === v) return;
      data[k] = v;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
      apply();
      listeners.forEach(fn => { try { fn(k, v, data); } catch {} });
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  apply();
})();
