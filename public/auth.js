/* =========================================================
   进入页 / 首次设置页
   1) 角色引擎：四个角色跟随鼠标、输入时害羞/偷看、失败摇头、成功咧嘴
      造型与动作参考 Keduoli03/animatedlogin-react（MIT），原生 JS 复刻
   2) 表单：首次「设密码 → 确认 → 选照片文件夹」，之后「输密码登录」
   ========================================================= */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ?stay=1：登录成功后不跳走，停在动画态，方便截图 / 演示
  const STAY = new URLSearchParams(location.search).get('stay') === '1';

  /* =========================================================
     一、角色引擎
     ========================================================= */
  function createCharacters(scene) {
    if (!scene) return { set() {}, fail() {}, success() {}, fit() {}, render() {} };

    const CFG = {
      purple: { bg: '#6C3FF5', z: 1, left: 110, w: 150, h: 400, hLong: 440, r: '10px 10px 0 0', eyes: { size: 18, pupil: 7, gap: 32 }, mouth: { kind: 'div', cls: 'purple', drop: 32 } },
      black:  { bg: '#2D2D2D', z: 2, left: 240, w: 120, h: 310, hLong: 310, r: '8px 8px 0 0',  eyes: { size: 16, pupil: 6, gap: 24 }, mouth: null },
      orange: { bg: '#FF9B6B', z: 3, left: 0,   w: 240, h: 200, hLong: 200, r: '120px 120px 0 0', eyes: { size: 12, pupil: 12, gap: 32, pupilOnly: true }, mouth: { kind: 'div', cls: 'orange', drop: 32 } },
      yellow: { bg: '#E8D754', z: 4, left: 310, w: 140, h: 230, hLong: 230, r: '70px 70px 0 0', eyes: { size: 12, pupil: 12, gap: 24, pupilOnly: true }, mouth: { kind: 'line', drop: 40 } },
    };

    const chars = {};

    for (const [name, c] of Object.entries(CFG)) {
      const box = document.createElement('div');
      box.className = 'ac-char ac-char--' + name;
      box.style.position = 'absolute';
      box.style.background = c.bg;
      box.style.zIndex = String(c.z);
      box.style.left = c.left + 'px';
      box.style.width = c.w + 'px';
      box.style.height = c.h + 'px';
      box.style.borderRadius = c.r;
      box.style.bottom = '-2px';
      box.style.borderBottom = '4px solid ' + c.bg;
      box.style.transformOrigin = 'bottom center';
      box.style.willChange = 'transform';
      box.style.backfaceVisibility = 'hidden';
      box.style.webkitBackfaceVisibility = 'hidden';
      box.style.transition = 'transform .1s ease-out, height .6s ease-in-out';

      const eyes = document.createElement('div');
      eyes.className = 'ac-eyes ac-eyes--' + (name === 'purple' || name === 'black' ? 'slow' : 'fast');
      eyes.style.gap = c.eyes.gap + 'px';

      const pupils = [];
      for (let i = 0; i < 2; i++) {
        let eyeEl, pupilEl;
        if (c.eyes.pupilOnly) {
          pupilEl = document.createElement('div');
          pupilEl.className = 'ac-pupil';
          pupilEl.style.width = c.eyes.size + 'px';
          pupilEl.style.height = c.eyes.size + 'px';
          pupilEl.style.background = '#2D2D2D';
          eyeEl = pupilEl;
        } else {
          eyeEl = document.createElement('div');
          eyeEl.className = 'ac-eyeball';
          eyeEl.style.width = c.eyes.size + 'px';
          eyeEl.style.height = c.eyes.size + 'px';
          eyeEl.style.background = '#fff';
          pupilEl = document.createElement('div');
          pupilEl.className = 'ac-pupil';
          pupilEl.style.width = c.eyes.pupil + 'px';
          pupilEl.style.height = c.eyes.pupil + 'px';
          pupilEl.style.background = '#2D2D2D';
          eyeEl.appendChild(pupilEl);
        }
        eyes.appendChild(eyeEl);
        pupils.push({ eyeEl, pupilEl, side: i });
      }
      box.appendChild(eyes);

      let mouthEl = null, mouthPath = null;
      if (c.mouth && c.mouth.kind === 'div') {
        mouthEl = document.createElement('div');
        mouthEl.className = 'ac-mouth ac-mouth--' + c.mouth.cls;
        box.appendChild(mouthEl);
      } else if (c.mouth && c.mouth.kind === 'line') {
        mouthEl = document.createElement('div');
        mouthEl.className = 'ac-mouth-line';
        mouthEl.innerHTML =
          '<svg width="80" height="20" viewBox="0 0 80 20" aria-hidden="true">' +
          '<path class="ac-mouth-line__path" stroke="#2D2D2D" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
        mouthPath = mouthEl.querySelector('path');
        box.appendChild(mouthEl);
      }

      scene.appendChild(box);
      chars[name] = { ...c, name, box, eyes, pupils, mouthEl, mouthPath, pos: { faceX: 0, faceY: 0, bodySkew: 0 } };
    }

    const state = {
      isTyping: false,
      isPasswordFocused: false,
      showPassword: false,
      passwordLength: 0,
      loginFailed: false,
      loginSuccess: false,
    };

    let mouse = { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
    let raf = null;
    let lookingAtEachOther = false;
    let purplePeeking = false;
    let blackPeeking = false;
    let shakeSlot = 0;
    let purpleBlink = false;
    let blackBlink = false;

    /* ---------- 几何 ---------- */
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function lookAt(el, max) {
      const r = el.getBoundingClientRect();
      const dx = mouse.x - (r.left + r.width / 2);
      const dy = mouse.y - (r.top + r.height / 2);
      const dist = Math.min(Math.hypot(dx, dy), max);
      const ang = Math.atan2(dy, dx);
      return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
    }

    /* 身体朝向：脸取高度的 1/3（脸在上半部分，用几何中心视线会偏低） */
    function bodyPose(el) {
      if (!el) return { faceX: 0, faceY: 0, bodySkew: 0 };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 3;
      const dx = mouse.x - cx;
      const dy = mouse.y - cy;
      return {
        faceX: clamp(dx / 20, -15, 15),
        faceY: clamp(dy / 30, -10, 10),
        bodySkew: clamp(-dx / 120, -6, 6),
      };
    }

    /* 嘴跟着眼睛走：水平居中对齐眼睛那一块，垂直往下挪固定距离 */
    function faceLayout(eyeX, eyeY, eyesWidth, mouthWidth, drop) {
      return {
        eyeX, eyeY,
        mouthX: eyeX + (eyesWidth - mouthWidth) / 2,
        mouthY: eyeY + drop,
      };
    }

    /* ---------- 姿态判定 ---------- */
    function poses() {
      const hiding = state.passwordLength > 0 && !state.showPassword;
      return {
        isPeeping: state.passwordLength > 0 && state.showPassword,
        isLookingAway: state.isPasswordFocused && !state.showPassword,
        isHidingPassword: hiding,
        isLookingAtEachOther: lookingAtEachOther,
      };
    }

    /* ---------- 渲染 ---------- */
    function render() {
      const p = poses();
      const slow = state.isPasswordFocused || state.isTyping ? '.6s' : '.1s';

      for (const c of Object.values(chars)) c.pos = bodyPose(c.box);

      const purple = chars.purple, black = chars.black, orange = chars.orange, yellow = chars.yellow;

      /* --- 紫色：最后层主角色 --- */
      purple.box.style.transition = `transform ${slow} ease-out, height .6s ease-in-out`;
      purple.box.style.height = (p.isLookingAway || state.isTyping || p.isHidingPassword ? purple.hLong : purple.h) + 'px';
      purple.box.style.transform =
        p.isPeeping ? 'skewX(0deg) translateZ(0)'
        : p.isLookingAway ? 'skewX(-14deg) translateX(-20px) translateZ(0)'
        : (state.isTyping || p.isHidingPassword) ? `skewX(${purple.pos.bodySkew - 12}deg) translateX(40px) translateZ(0)`
        : `skewX(${purple.pos.bodySkew}deg) translateZ(0)`;

      const pf = p.isLookingAway ? faceLayout(20, 25, 68, 24, 32)
        : p.isPeeping ? faceLayout(20, 35, 68, 24, 32)
        : p.isLookingAtEachOther ? faceLayout(55, 65, 68, 24, 32)
        : faceLayout(30 + purple.pos.faceX, 40 + purple.pos.faceY, 68, 24, 32);

      purple.eyes.style.left = pf.eyeX + 'px';
      purple.eyes.style.top = pf.eyeY + 'px';
      purple.pupils.forEach(({ eyeEl, pupilEl }) => {
        eyeEl.style.height = purpleBlink ? '2px' : '18px';
        pupilEl.style.display = purpleBlink ? 'none' : '';
        if (!purpleBlink) applyPupil(pupilEl, p, 'purple', 5, 5);
      });
      if (purple.mouthEl) {
        purple.mouthEl.style.left = pf.mouthX + 'px';
        purple.mouthEl.style.top = pf.mouthY + 'px';
        purple.mouthEl.style.setProperty(
          '--counter-skew',
          (state.isTyping || p.isHidingPassword) ? `skewX(${-(purple.pos.bodySkew - 12)}deg)` : 'skewX(0deg)'
        );
      }

      /* --- 黑色：中层，全靠眼睛演 --- */
      black.box.style.transition = `transform ${slow} ease-out, height .6s ease-in-out`;
      black.box.style.transform =
        p.isPeeping ? 'skewX(0deg) translateZ(0)'
        : p.isLookingAway ? 'skewX(12deg) translateX(-10px) translateZ(0)'
        : p.isLookingAtEachOther ? `skewX(${black.pos.bodySkew * 1.5 + 10}deg) translateX(20px) translateZ(0)`
        : `skewX(${black.pos.bodySkew * 1.5}deg) translateZ(0)`;

      black.eyes.style.left = (p.isLookingAway ? 10 : p.isPeeping ? 10 : p.isLookingAtEachOther ? 32 : 26 + black.pos.faceX) + 'px';
      black.eyes.style.top = (p.isLookingAway ? 20 : p.isPeeping ? 28 : p.isLookingAtEachOther ? 12 : 32 + black.pos.faceY) + 'px';
      black.pupils.forEach(({ eyeEl, pupilEl, side }) => {
        const sad = state.loginFailed;
        eyeEl.style.height = blackBlink ? '2px' : sad ? '8px' : '16px';
        eyeEl.style.borderRadius = sad ? '0 0 16px 16px' : '50%';
        eyeEl.style.transform = sad ? `rotate(${side === 0 ? -20 : 20}deg)` : 'rotate(0deg)';
        pupilEl.style.display = blackBlink ? 'none' : '';
        if (!blackBlink) applyPupil(pupilEl, p, 'black', 5, 5, sad);
      });

      /* --- 橙色：左前半圆 --- */
      const oT = p.isPeeping ? 'skewX(0deg) translateZ(0)' : `skewX(${orange.pos.bodySkew}deg) translateZ(0)`;
      orange.box.style.transition = `transform ${slow} ease-out, height .6s ease-in-out`;
      orange.box.style.transform = oT;
      const of = p.isLookingAway ? faceLayout(50, 75, 56, 26, 32)
        : p.isPeeping ? faceLayout(50, 85, 56, 26, 32)
        : faceLayout(82 + orange.pos.faceX, 90 + orange.pos.faceY, 56, 26, 32);
      orange.eyes.style.left = of.eyeX + 'px';
      orange.eyes.style.top = of.eyeY + 'px';
      orange.pupils.forEach(({ pupilEl }) => applyPupil(pupilEl, p, 'orange', 5, 5));
      if (orange.mouthEl) {
        orange.mouthEl.style.left = of.mouthX + 'px';
        orange.mouthEl.style.top = of.mouthY + 'px';
      }

      /* --- 黄色：右前圆顶 --- */
      const yT = p.isPeeping ? 'skewX(0deg) translateZ(0)' : `skewX(${yellow.pos.bodySkew}deg) translateZ(0)`;
      yellow.box.style.transition = `transform ${slow} ease-out, height .6s ease-in-out`;
      yellow.box.style.transform = yT;
      yellow.eyes.style.left = (p.isLookingAway ? 20 : p.isPeeping ? 20 : 52 + yellow.pos.faceX) + 'px';
      yellow.eyes.style.top = (p.isLookingAway ? 30 : p.isPeeping ? 35 : 40 + yellow.pos.faceY) + 'px';
      yellow.pupils.forEach(({ pupilEl }) => applyPupil(pupilEl, p, 'yellow', 5, 5));
      if (yellow.mouthEl) {
        yellow.mouthEl.style.left = (p.isLookingAway ? 15 : p.isPeeping ? 10 : 40 + yellow.pos.faceX) + 'px';
        yellow.mouthEl.style.top = (p.isLookingAway ? 70 : p.isPeeping ? 80 : 80 + yellow.pos.faceY) + 'px';
      }

      /* --- 嘴的表情 --- */
      const mouthClass = [
        state.loginFailed ? 'is-sad' : '',
        state.loginSuccess && !state.loginFailed ? 'is-happy' : '',
        (state.isTyping || p.isHidingPassword) && !state.loginFailed && !state.loginSuccess ? 'is-typing' : '',
      ].filter(Boolean).join(' ');

      for (const c of [purple, orange]) {
        if (!c.mouthEl) continue;
        c.mouthEl.classList.toggle('is-sad', mouthClass.includes('is-sad'));
        c.mouthEl.classList.toggle('is-happy', mouthClass.includes('is-happy'));
        c.mouthEl.classList.toggle('is-typing', mouthClass.includes('is-typing'));
      }
      if (yellow.mouthPath) {
        yellow.mouthPath.classList.toggle('ac-mouth-line__path--wavy', state.loginFailed);
        yellow.mouthPath.classList.toggle('ac-mouth-line__path--happy', state.loginSuccess && !state.loginFailed);
      }

      applyShake();
    }

    /* 瞳孔方向：force 优先，否则朝鼠标 */
    function applyPupil(el, p, who, max, forceDist, sad) {
      let fx, fy;
      if (who === 'purple') {
        if (p.isLookingAway) { fx = -5; fy = -5; }
        else if (p.isPeeping) { fx = purplePeeking ? 4 : -4; fy = purplePeeking ? 5 : -4; }
        else if (p.isLookingAtEachOther) { fx = 3; fy = 4; }
      } else if (who === 'black') {
        if (p.isLookingAway) { fx = blackPeeking ? 5 : -4; fy = blackPeeking ? 0 : -5; }
        else if (p.isPeeping) { fx = -4; fy = -4; }
        else if (p.isLookingAtEachOther) { fx = 0; fy = -4; }
      } else {
        if (p.isLookingAway) { fx = -5; fy = -5; }
        else if (p.isPeeping) { fx = -4; fy = -4; }
      }

      let x, y;
      if (fx !== undefined) { x = fx; y = fy; }
      else if (REDUCE) { x = 0; y = 0; }
      else { const r = lookAt(el, max); x = r.x; y = r.y; }

      el.style.transform = `translate(${x}px, ${y}px)`;
    }

    /* 摇头：两个动画名交替，连续失败也能重播 */
    function applyShake() {
      const cls = shakeSlot === 1 ? 'ac-shake-a' : shakeSlot === 2 ? 'ac-shake-b' : '';
      for (const c of Object.values(chars)) {
        c.eyes.classList.toggle('ac-shake-a', shakeSlot === 1);
        c.eyes.classList.toggle('ac-shake-b', shakeSlot === 2);
        if (c.mouthEl && c.mouthEl.classList.contains('ac-mouth-line')) {
          c.mouthEl.classList.toggle('ac-shake-a', shakeSlot === 1);
          c.mouthEl.classList.toggle('ac-shake-b', shakeSlot === 2);
        }
      }
      void cls;
    }

    /* ---------- 定时器 ---------- */
    let peekTimer = null, peekBackTimer = null, blackPeekTimer = null, blackPeekBack = null;
    let lookTimer = null, shakeTimer = null, blinkTimerA = null, blinkTimerB = null;
    let purpleBlinkOff = null, blackBlinkOff = null;

    function stopPeek() {
      clearTimeout(peekTimer); clearTimeout(peekBackTimer);
      clearTimeout(blackPeekTimer); clearTimeout(blackPeekBack);
      purplePeeking = false; blackPeeking = false;
    }

    function syncPeek() {
      const p = poses();
      stopPeek();

      if (p.isPeeping && !REDUCE) {
        peekTimer = setTimeout(() => {
          purplePeeking = true; render();
          peekBackTimer = setTimeout(() => { purplePeeking = false; render(); }, 800);
        }, Math.random() * 3000 + 2000);
      }
      if (p.isLookingAway && !REDUCE) {
        const schedule = () => {
          blackPeekTimer = setTimeout(() => {
            blackPeeking = true; render();
            blackPeekBack = setTimeout(() => { blackPeeking = false; render(); schedule(); }, 900);
          }, Math.random() * 3000 + 2000);
        };
        schedule();
      }
    }

    function syncLook() {
      clearTimeout(lookTimer);
      lookingAtEachOther = state.isTyping;
      if (state.isTyping) lookTimer = setTimeout(() => { lookingAtEachOther = false; render(); }, 800);
    }

    function scheduleBlinkA() {
      clearTimeout(blinkTimerA);
      blinkTimerA = setTimeout(() => {
        purpleBlink = true; render();
        clearTimeout(purpleBlinkOff);
        purpleBlinkOff = setTimeout(() => { purpleBlink = false; render(); }, 150);
        scheduleBlinkA();
      }, Math.random() * 4000 + 3000);
    }
    function scheduleBlinkB() {
      clearTimeout(blinkTimerB);
      blinkTimerB = setTimeout(() => {
        blackBlink = true; render();
        clearTimeout(blackBlinkOff);
        blackBlinkOff = setTimeout(() => { blackBlink = false; render(); }, 150);
        scheduleBlinkB();
      }, Math.random() * 4000 + 3000);
    }

    /* ---------- 对外 ---------- */
    function set(patch) {
      let changed = false;
      for (const k of Object.keys(patch)) {
        if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
      }
      if (!changed) return;
      if ('isTyping' in patch) syncLook();
      if ('isPasswordFocused' in patch || 'showPassword' in patch || 'passwordLength' in patch) syncPeek();
      render();
    }

    function fail() {
      set({ loginFailed: true, loginSuccess: false });
      clearTimeout(shakeTimer);
      shakeSlot = shakeSlot === 1 ? 2 : 1;
      render();
      shakeTimer = setTimeout(() => { shakeSlot = 0; set({ loginFailed: false }); }, 2000);
    }

    function success() {
      set({ loginSuccess: true, loginFailed: false });
      setTimeout(() => set({ loginSuccess: false }), 1600);
    }

    /* ---------- 鼠标 / 尺寸 ---------- */
    let ticking = false;
    function onMove(e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; render(); });
    }

    function fit() {
      const wrap = scene.parentElement;
      if (!wrap) return;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      // 窄屏多留 50px 余量：输入密码时紫色会从 400 长到 440，不留就被顶部裁掉
      const tight = window.innerWidth < 900;
      const s = Math.min(w / 460, h / (tight ? 500 : 450), 1);
      scene.style.transform = `scale(${s})`;
      scene.style.transformOrigin = 'bottom center';
    }

    if (!REDUCE) window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('resize', () => { fit(); render(); });

    scheduleBlinkA();
    scheduleBlinkB();
    fit();
    render();

    return { set, fail, success, fit, render };
  }

  const AC = createCharacters($('#acScene'));

  /* =========================================================
     二、表单
     ========================================================= */
  const el = {
    form: $('#authForm'),
    stepPass: $('#stepPass'),
    stepDir: $('#stepDir'),
    stepLogin: $('#stepLogin'),
    p1: $('#p1'), p2: $('#p2'), p0: $('#p0'),
    manualDir: $('#manualDir'),
    err: $('#errMsg'), ok: $('#okMsg'),
    btn: $('#submitBtn'), btnText: $('#btnText'), btnText2: $('#btnText2'),
    stepBar: $('#stepBar'), back: $('#backStep'),
    title: $('#formTitle'),
    dirOptions: $('#dirOptions'),
    defaultDirText: $('#defaultDirText'),
    pickedDirText: $('#pickedDirText'),
  };

  const S = {
    needSetup: false,
    step: 'login',
    pass: '',
    dirMode: 'default',
    pickedDir: '',
    busy: false,
    doneEmpty: false,
    defaultDir: '',
  };

  /* ---------- 提示 ---------- */
  function clearMsg() {
    el.err.classList.remove('show');
    el.ok.classList.remove('show');
    el.form.querySelectorAll('input').forEach(i => {
      i.classList.remove('error');
      const lb = el.form.querySelector(`label[for="${i.id}"]`);
      if (lb) lb.classList.remove('error-label');
    });
  }
  function showErr(msg, field) {
    el.ok.classList.remove('show');
    el.err.textContent = msg;
    el.err.classList.add('show');
    if (field) {
      field.classList.add('error');
      const lb = el.form.querySelector(`label[for="${field.id}"]`);
      if (lb) lb.classList.add('error-label');
    }
  }
  function showOk(msg) {
    el.err.classList.remove('show');
    el.ok.textContent = msg;
    el.ok.classList.add('show');
  }

  /* ---------- 步骤 ---------- */
  const COPY = {
    pass: { title: '先设一个密码', sub: '', btn: '确认密码' },
    dir: { title: '照片放在哪？', sub: '', btn: '开始使用' },
    login: { title: '欢迎回来', sub: '', btn: '进入' },
  };

  function setStep(step) {
    S.step = step;
    clearMsg();
    AC.set({ isTyping: false, isPasswordFocused: false, showPassword: false, passwordLength: 0 });

    el.stepPass.hidden = !(S.needSetup && step === 'pass');
    el.stepDir.hidden = !(S.needSetup && step === 'dir');
    el.stepLogin.hidden = S.needSetup;

    const c = COPY[step] || COPY.login;
    el.title.textContent = c.title;
    setBtn(c.btn);

    el.stepBar.hidden = !S.needSetup;
    el.stepBar.querySelectorAll('.sb-item').forEach(n => {
      n.classList.toggle('is-on', n.dataset.step === (step === 'dir' ? '1' : '0'));
    });
    el.back.hidden = !(S.needSetup && step === 'dir');

    // 不自动聚焦：首屏先让角色站直、眼睛跟着鼠标转；
    // 用户点输入框时才触发「对视 / 害羞转头」，动起来才有惊喜。
  }

  function setBtn(label) {
    el.btnText.textContent = label;
    el.btnText2.textContent = label;
  }

  function setBusy(on) {
    S.busy = on;
    el.btn.disabled = on;
    el.btn.classList.toggle('is-busy', on);
    if (on) setBtn('请稍候…');
    else setBtn(COPY[S.step].btn);
  }

  /* ---------- 密码框 ---------- */
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.eye);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-shown', show);
      btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      AC.set({ showPassword: show, passwordLength: input.value.length });
      input.focus({ preventScroll: true });
      const pos = input.value.length;
      try { input.setSelectionRange(pos, pos); } catch {}
    });
  });

  const bindFocus = (input, kind) => {
    input.addEventListener('focus', () => {
      AC.set(kind === 'typing'
        ? { isTyping: true, isPasswordFocused: false, passwordLength: input.value.length }
        : { isPasswordFocused: true, isTyping: false, passwordLength: input.value.length });
    });
    input.addEventListener('blur', () => {
      AC.set(kind === 'typing' ? { isTyping: false } : { isPasswordFocused: false });
    });
    input.addEventListener('input', () => {
      clearMsg();
      AC.set({ passwordLength: input.value.length });
    });
  };
  bindFocus(el.p1, 'typing');
  bindFocus(el.p2, 'secret');
  bindFocus(el.p0, 'secret');

  /* ---------- 选文件夹 ---------- */
  function setDirMode(mode, opts = {}) {
    S.dirMode = mode;
    el.dirOptions.querySelectorAll('.dir-opt').forEach(n => {
      n.classList.toggle('is-on', n.dataset.mode === mode);
    });
    if (mode === 'manual' && !opts.silent) {
      setTimeout(() => { try { el.manualDir.focus({ preventScroll: true }); } catch {} }, 40);
    }
  }

  async function pickFolder() {
    const old = el.pickedDirText.textContent;
    el.pickedDirText.textContent = '正在等待你在系统窗口里选择…';
    el.pickedDirText.classList.remove('is-picked');
    try {
      const r = await fetch('/api/pick-folder', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (d.path) {
        S.pickedDir = d.path;
        el.pickedDirText.textContent = d.path;
        el.pickedDirText.title = d.path;
        el.pickedDirText.classList.add('is-picked');
        return d.path;
      }
      el.pickedDirText.textContent = old;
      if (d.error) showErr(d.error);
      return '';
    } catch {
      el.pickedDirText.textContent = old;
      showErr('调不出系统选择框，请改用「手动输入路径」');
      return '';
    }
  }

  el.dirOptions.addEventListener('click', async e => {
    if (e.target === el.manualDir) return;
    const opt = e.target.closest('.dir-opt');
    if (!opt) return;
    const mode = opt.dataset.mode;
    if (mode === 'pick') {
      setDirMode('pick');
      await pickFolder();
      return;
    }
    setDirMode(mode);
  });

  el.dirOptions.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const opt = e.target.closest('.dir-opt');
    if (!opt || e.target === el.manualDir) return;
    e.preventDefault();
    opt.click();
  });

  el.manualDir.addEventListener('click', () => setDirMode('manual', { silent: true }));
  el.manualDir.addEventListener('input', () => { clearMsg(); setDirMode('manual', { silent: true }); });

  function currentDir() {
    if (S.dirMode === 'pick') return S.pickedDir;
    if (S.dirMode === 'manual') return el.manualDir.value.trim();
    return '';
  }

  /* ---------- 返回上一步 ---------- */
  el.back.addEventListener('click', () => {
    if (S.doneEmpty) { location.replace('/'); return; }
    setStep('pass');
    el.p1.value = S.pass;
    el.p2.value = S.pass;
  });

  /* ---------- 提交 ---------- */
  el.form.addEventListener('submit', async e => {
    e.preventDefault();
    if (S.busy) return;

    /* 第 1 步：设密码 */
    if (S.needSetup && S.step === 'pass') {
      const v1 = el.p1.value;
      const v2 = el.p2.value;
      if (!v1) return showErr('请先设置一个密码', el.p1);
      if (v1.length < 4) return showErr('密码至少 4 位，好记又不容易被猜到', el.p1);
      if (v1 !== v2) return showErr('两次输入的密码不一样，再检查一下', el.p2);
      S.pass = v1;
      AC.success();
      setStep('dir');
      return;
    }

    /* 第 2 步：选文件夹 */
    if (S.needSetup && S.step === 'dir') {
      if (S.doneEmpty) { location.replace('/'); return; }

      const dir = currentDir();
      if (S.dirMode === 'pick' && !dir) return showErr('还没有选文件夹，点一下「选电脑里已有的文件夹」');
      if (S.dirMode === 'manual' && !dir) return showErr('请输入照片文件夹的路径', el.manualDir);

      setBusy(true);
      try {
        const r = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pass: S.pass, photoDir: dir }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          if (d.hasPhoto) {
            AC.success();
            setTimeout(() => location.replace('/'), 420);
            return;
          }
          /* 空目录：不报错，告诉他照片该放哪，然后可以先打开看看 */
          S.doneEmpty = true;
          setBusy(false);
          setBtn('先打开看看');
          showOk('设置好了。这个文件夹里还没有照片：把照片放进去，刷新页面就能看到。\n' + (d.photoDir || dir || S.defaultDir));
          el.btnText.textContent = '先打开看看';
          el.btnText2.textContent = '先打开看看';
          AC.success();
          return;
        }
        setBusy(false);
        showErr(d.error || '设置失败，再试一次');
        AC.fail();
      } catch {
        setBusy(false);
        showErr('网络异常，请稍后再试');
        AC.fail();
      }
      return;
    }

    /* 日常登录 */
    if (!el.p0.value) { AC.fail(); return showErr('请输入密码', el.p0); }
    setBusy(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass: el.p0.value }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        AC.success();
        setBtn('进去了…');
        if (STAY) {
          // 截图 / 演示用：停在成功态，按钮别变灰
          el.btn.disabled = false;
          el.btn.classList.remove('is-busy');
          S.busy = false;
        } else {
          setTimeout(() => location.replace('/'), 700);
        }
        return;
      }
      setBusy(false);
      showErr(d.error || '密码不对，再试试', el.p0);
      AC.fail();
      try { el.p0.select(); } catch {}
    } catch {
      setBusy(false);
      showErr('网络异常，请稍后再试');
      AC.fail();
    }
  });

  /* 输入时清掉红框 */
  [el.p1, el.p2, el.p0].forEach(i => i.addEventListener('input', () => {
    i.classList.remove('error');
    const lb = el.form.querySelector(`label[for="${i.id}"]`);
    if (lb) lb.classList.remove('error-label');
  }));

  /* ---------- 初始化 ---------- */
  (async () => {
    let meta = {};
    try { meta = await fetch('/api/meta').then(r => r.json()); } catch {}
    S.needSetup = !!meta.needSetup;
    S.defaultDir = meta.defaultDir || '';

    const brand = $('#brandName');
    if (brand && meta.name) brand.textContent = meta.name;
    if (S.defaultDir) {
      el.defaultDirText.textContent = S.defaultDir;
      el.defaultDirText.title = S.defaultDir;
    }

    if (S.needSetup) {
      /* 首次：先设密码，再选文件夹 */
      setStep('pass');
    } else {
      setStep('login');
    }
    AC.fit();
  })();
})();
