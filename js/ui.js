/* 畫面：3D 擲骰動畫、下注面板、分布圖、自動投注、紀錄、公平性視窗 */
(function () {
  'use strict';
  const D = window.Dice;
  const $ = s => document.querySelector(s);
  const fmt = x => (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMult = x => (x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : x.toFixed(2)) + '×';
  const pct = x => (x * 100 >= 99.995 ? '100' : (x * 100).toFixed(x < 0.001 ? 4 : 2)) + '%';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  const KEY = 'dice.v1';
  const START_BALANCE = 1000;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = {
    balance: $('#balance'), wallet: $('.wallet'), bet: $('#betAmount'), main: $('#mainBtn'), fast: $('#fastChk'),
    diceCount: $('#diceCount'), typeSeg: $('#typeSeg'), faceField: $('#faceField'), faceLabel: $('#faceLabel'), facePick: $('#facePick'),
    condField: $('#condField'), condLabel: $('#condLabel'), condSeg: $('#condSeg'),
    targetField: $('#targetField'), targetLabel: $('#targetLabel'), targetOut: $('#targetOut'), tMinus: $('#tMinus'), tPlus: $('#tPlus'), quickSum: $('#quickSum'),
    chance: $('#chanceOut'), mult: $('#multOut'), pay: $('#payOut'), profit: $('#profitOut'),
    tray: $('#tray'), tapHint: $('#tapHint'), result: $('#result'), resultVal: $('#resultVal'), resultSub: $('#resultSub'),
    recent: $('#recent'), betLine: $('#betLine'), dist: $('#dist'), distTitle: $('#distTitle'), tripleNote: $('#tripleNote'), nonce: $('#nonceOut'),
    modeSeg: $('#modeSeg'), autoFields: $('#autoFields'),
    autoCount: $('#autoCount'), onWin: $('#onWin'), onLoss: $('#onLoss'), stopProfit: $('#stopProfit'), stopLoss: $('#stopLoss'),
    myList: $('#myList'), summary: $('#summary'), oddsTable: $('#oddsTable'), tableHead: $('#tableHead'), tableHint: $('#tableHint'),
    sound: $('#soundBtn'), back: $('#backBtn'),
    fair: $('#fairDialog'), clientSeed: $('#clientSeed'), nextHash: $('#nextHash'),
    vServer: $('#vServer'), vClient: $('#vClient'), vNonce: $('#vNonce'), vDice: $('#vDice'), verifyOut: $('#verifyOut')
  };

  // ---------- 骰面 ----------
  // 3×3 格位置（1 左上 … 9 右下）
  const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const pips = v => (PIPS[v] || []).map(c => `<i style="grid-area:${Math.ceil(c / 3)}/${(c - 1) % 3 + 1}"></i>`).join('');
  const faceCls = v => (v === 1 ? 'red big1' : v === 4 ? 'red' : ''); // 傳統骰子：1、4 點為紅色
  const miniDie = (v, extra = '') => `<span class="mini ${faceCls(v)} ${extra}">${pips(v)}</span>`;
  // 文字中的 ⚀–⚅ 換成跟字一樣大的小骰面（Unicode 骰子字形在多數字型裡太小）
  const G = v => miniDie(v, 'ig');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const glyphs = s => esc(s).replace(/[⚀-⚅]/g, c => G(c.charCodeAt(0) - 0x267f));
  // 讓點數 v 朝上（面向鏡頭）所需的 [rotateX, rotateY]
  const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

  // ---------- 存檔 ----------
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }
  const game = new D.DiceGame({ balance: saved.balance ?? START_BALANCE, clientSeed: saved.clientSeed, nonce: saved.nonce });
  if (saved.nextServerSeed) game.nextServerSeed = saved.nextServerSeed;
  const history = Array.isArray(saved.history) ? saved.history : [];
  const sel = Object.assign({ n: 3, type: 'sum', cond: 'ge', target: 11, face: 6 }, saved.sel || {});
  if (saved.bet) el.bet.value = saved.bet;
  el.fast.checked = !!saved.fast;

  let mode = 'manual';
  let rolling = false;
  let autoRunning = false;
  let autoStopReq = false;
  let shownBalance = null; // 動畫進行中顯示「已扣注、未派彩」的餘額
  let lastHit = null;      // 最近一局的結果值（分布圖上標記）
  let relayoutPending = false;
  let trayTaps = +saved.trayTaps || 0; // 直接點托盤擲骰的次數，滿 3 次就不再顯示點擊提示

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        balance: game.balance, clientSeed: game.clientSeed, nonce: game.nonce, nextServerSeed: game.nextServerSeed,
        history: history.slice(0, 100), bet: el.bet.value, sel, fast: el.fast.checked, trayTaps
      }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- 返回大廳（只接受自家網域，避免被當成跳轉跳板） ----------
  (function () {
    const ret = new URLSearchParams(location.search).get('return');
    if (!ret) return;
    try {
      const u = new URL(ret);
      const okHost = u.hostname === 'acc2023156.github.io' || u.hostname === location.hostname || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (!/^https?:$/.test(u.protocol) || !okHost) return;
      el.back.href = u.href;
      el.back.hidden = false;
    } catch (e) { /* invalid url */ }
  })();

  // ---------- 小提示 ----------
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:#ed4163;color:#fff;padding:8px 16px;border-radius:99px;font-weight:700;z-index:50;display:none;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  document.body.appendChild(toast);
  let toastTimer = 0;
  function say(msg, ok) {
    toast.textContent = msg;
    toast.style.background = ok ? '#1f8a2c' : '#ed4163';
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 2200);
  }

  // ---------- 注項 ----------
  const bet = () => ({ n: sel.n, type: sel.type, cond: sel.cond, target: sel.target, face: sel.face });

  // 把選項修正到合法範圍
  function fixSel() {
    sel.n = Math.min(D.MAX_DICE, Math.max(D.MIN_DICE, Math.round(+sel.n) || 3));
    if (!D.TYPES.includes(sel.type) || (sel.type === 'triple' && sel.n < 2)) sel.type = 'sum';
    if (!D.CONDS.includes(sel.cond)) sel.cond = 'ge';
    if (sel.type === 'count' && !(sel.face >= 1 && sel.face <= 6)) sel.face = 6;
    if (sel.type === 'triple' && !(sel.face >= 0 && sel.face <= 6)) sel.face = 0;
    if (sel.type !== 'triple') {
      const [lo, hi] = D.targetRange(sel.n, sel.type);
      sel.target = Math.min(hi, Math.max(lo, Math.round(+sel.target) || 0));
    }
  }

  // 大 / 小：以平均值 3.5n 為界（剛好等於平均值不算）
  const quickBet = (n, q) => (q === 'small' ? { cond: 'le', target: Math.ceil(3.5 * n) - 1 } : { cond: 'ge', target: Math.floor(3.5 * n) + 1 });

  function defaultsFor(type) {
    if (type === 'sum') Object.assign(sel, quickBet(sel.n, 'big'));
    else if (type === 'count') { sel.cond = 'ge'; sel.target = 1; if (!sel.face) sel.face = 6; }
    else sel.face = 0; // 豹子預設「任意」
  }

  function changeSel(fn) {
    if (rolling || autoRunning) return;
    fn();
    fixSel();
    lastHit = null;
    Sound.select();
    save();
    renderControls();
  }

  // ---------- 3D 骰子 ----------
  const dice = [];
  for (let i = 0; i < D.MAX_DICE; i++) {
    const shadow = document.createElement('div');
    shadow.className = 'die-shadow';
    const die = document.createElement('div');
    die.className = 'die';
    let faces = '<div class="core"></div><div class="core cx"></div><div class="core cy"></div>';
    for (let v = 1; v <= 6; v++) faces += `<div class="face f${v} ${faceCls(v)}">${pips(v)}</div>`;
    die.innerHTML = `<div class="lift"><div class="cube">${faces}</div></div>`;
    el.tray.appendChild(shadow);
    el.tray.appendChild(die);
    dice.push({ el: die, lift: die.querySelector('.lift'), cube: die.querySelector('.cube'), shadow, x: 0, y: 0, rx: 0, ry: 0, rz: 0, v: 1 + (i % 6), shown: false });
  }
  let ds = 64;

  function applyDie(d, x, y, lift, rx, ry, rz) {
    d.el.style.transform = `translate(${x}px, ${y}px)`;
    // 每顆骰子以自己為中心透視（正上方俯視），靜止時不會因偏離托盤中心而露出側面
    d.lift.style.transform = `perspective(${ds * 9}px) translateZ(${lift * 0.8}px)`;
    d.cube.style.transform = `rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg)`;
    const k = Math.min(1, lift / 400);
    d.shadow.style.transform = `translate(${x + 3 + lift * 0.18}px, ${y + 5 + lift * 0.28}px) scale(${1 - k * 0.35})`;
    d.shadow.style.opacity = (0.6 - k * 0.4).toFixed(3);
  }

  // 靜止位置：1–3 顆一排，4 顆 2×2，5–6 顆兩排；加一點隨機偏移與歪斜
  function layout(n) {
    const W = el.tray.clientWidth, H = el.tray.clientHeight;
    const cols = n <= 3 ? n : n === 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    // 骰子放在托盤正中央；用骰子大小確保最上排不會被結果看板（高 RESULT_H）擋住
    const RESULT_H = 52;
    const byHeight = rows > 1 ? (H / 2 - RESULT_H) / (0.85 * (rows - 1) + 0.5) : (H / 2 - RESULT_H) / 0.5;
    ds = Math.round(Math.max(30, Math.min(76, W / (cols * 1.9 + 0.9), byHeight)));
    el.tray.style.setProperty('--ds', ds + 'px');
    const gx = ds * 1.85, gy = ds * 1.7;
    const cy = H / 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const x = W / 2 + (c - (inRow - 1) / 2) * gx + rand(-0.16, 0.16) * ds;
      const y = cy + (r - (rows - 1) / 2) * gy + rand(-0.12, 0.12) * ds;
      out.push({ x: x - ds / 2, y: y - ds / 2, rz: rand(-20, 20) });
    }
    return out;
  }

  // 不做動畫，直接把骰子擺好（改骰子數、視窗縮放時）
  function placeDice() {
    const spots = layout(sel.n);
    dice.forEach((d, i) => {
      const on = i < sel.n;
      d.el.style.display = d.shadow.style.display = on ? '' : 'none';
      if (!on) { d.shown = false; return; }
      const [rx, ry] = FACE_ROT[d.v];
      Object.assign(d, { x: spots[i].x, y: spots[i].y, rx, ry, rz: spots[i].rz, shown: true });
      applyDie(d, d.x, d.y, 0, d.rx, d.ry, d.rz);
    });
  }

  function clearMarks() {
    dice.forEach(d => d.el.classList.remove('hl', 'dim'));
    el.result.hidden = true;
  }

  function bounce(x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  // 拋骰：往上拋起 → 落桌彈跳 → 邊滾邊滑到新位置，最後停在指定點數
  function throwDice(values, fast) {
    const n = values.length;
    const spots = layout(n);
    const W = el.tray.clientWidth, H = el.tray.clientHeight;
    const H0 = fast ? 150 : 300;
    const dur = fast ? 600 : 1400;
    const TOSS = 0.16;
    const plans = values.map((v, i) => {
      const d = dice[i];
      d.el.style.display = d.shadow.style.display = '';
      d.v = v;
      // 新出現的骰子從托盤下緣丟進來
      const from = d.shown ? { x: d.x, y: d.y } : { x: W / 2 - ds / 2 + rand(-60, 60), y: H - ds * 0.6 };
      const [fx, fy] = FACE_ROT[v];
      const dir = () => (Math.random() < 0.5 ? -1 : 1);
      const spin = (start, base) => base + 360 * Math.round((start + dir() * rand(fast ? 540 : 900, fast ? 900 : 1440) - base) / 360);
      return {
        d, from, to: spots[i],
        start: { rx: d.rx, ry: d.ry, rz: d.rz },
        end: { rx: spin(d.rx, fx), ry: spin(d.ry, fy), rz: spots[i].rz + (fast ? 0 : 360 * dir()) },
        delay: i * (fast ? 20 : 55) + rand(0, fast ? 20 : 50),
        h: H0 * rand(0.85, 1.1), prev: 0, falling: false, hits: 0
      };
    });
    dice.forEach((d, i) => { if (i >= n) { d.el.style.display = d.shadow.style.display = 'none'; d.shown = false; } });
    const loud = n > 3 ? 0.7 : 1;

    return new Promise(resolve => {
      const t0 = performance.now();
      function impact(p) {
        p.hits += 1;
        Sound.clack(loud / Math.pow(p.hits, 1.3));
        if (p.hits === 1 && p.d === dice[0]) {
          el.tray.classList.remove('thud');
          void el.tray.offsetWidth;
          el.tray.classList.add('thud');
        }
      }
      function frame(now) {
        let done = true;
        for (const p of plans) {
          const t = Math.min(1, Math.max(0, (now - t0 - p.delay) / dur));
          if (t < 1) done = false;
          const lift = t < TOSS ? p.h * Math.sin(t / TOSS * Math.PI / 2) : p.h * (1 - bounce((t - TOSS) / (1 - TOSS)));
          if (lift < p.prev) p.falling = true;
          else if (p.falling && lift > p.prev) { p.falling = false; impact(p); }
          if (t === 1 && p.falling) { p.falling = false; impact(p); }
          p.prev = lift;
          const m = easeOut(t);
          const r = easeOut(Math.min(1, t / 0.9));
          applyDie(p.d,
            p.from.x + (p.to.x - p.from.x) * m, p.from.y + (p.to.y - p.from.y) * m, lift,
            p.start.rx + (p.end.rx - p.start.rx) * r, p.start.ry + (p.end.ry - p.start.ry) * r, p.start.rz + (p.end.rz - p.start.rz) * r);
        }
        if (!done) { requestAnimationFrame(frame); return; }
        for (const p of plans) {
          const [rx, ry] = FACE_ROT[p.d.v];
          Object.assign(p.d, { x: p.to.x, y: p.to.y, rx, ry, rz: p.to.rz, shown: true });
          applyDie(p.d, p.d.x, p.d.y, 0, rx, ry, p.d.rz);
        }
        resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  // ---------- 面板 ----------
  el.diceCount.innerHTML = Array.from({ length: D.MAX_DICE }, (_, i) => `<button type="button" data-n="${i + 1}">${i + 1}</button>`).join('');
  el.facePick.innerHTML = '<button type="button" data-face="0">任意</button>' +
    [1, 2, 3, 4, 5, 6].map(v => `<button type="button" data-face="${v}" aria-label="${v} 點">${miniDie(v)}</button>`).join('');

  function renderBalance() {
    el.balance.textContent = fmt(shownBalance ?? game.balance);
  }

  function renderControls() {
    const lock = rolling || autoRunning;
    const b = bet();
    const { n, type } = sel;
    el.diceCount.querySelectorAll('button').forEach(x => { x.classList.toggle('on', +x.dataset.n === n); x.disabled = lock; });
    el.typeSeg.querySelectorAll('button').forEach(x => {
      x.classList.toggle('on', x.dataset.type === type);
      x.disabled = lock || (x.dataset.type === 'triple' && n < 2);
    });

    el.faceField.hidden = type === 'sum';
    el.facePick.classList.toggle('with-any', type === 'triple');
    el.faceLabel.textContent = type === 'count' ? '要數哪個點數' : '豹子點數';
    el.facePick.querySelectorAll('button').forEach(x => { x.classList.toggle('on', +x.dataset.face === sel.face); x.disabled = lock; });

    el.condField.hidden = el.targetField.hidden = type === 'triple';
    el.condLabel.innerHTML = type === 'count' ? `${G(sel.face)} 出現的顆數要` : '總點數要';
    const condTxt = type === 'count' ? { eq: '剛好', ge: '至少', le: '最多' } : { eq: '剛好', ge: '以上', le: '以下' };
    el.condSeg.querySelectorAll('button').forEach(x => {
      x.classList.toggle('on', x.dataset.cond === sel.cond);
      x.textContent = condTxt[x.dataset.cond];
      x.disabled = lock;
    });
    if (type !== 'triple') {
      const [lo, hi] = D.targetRange(n, type);
      el.targetLabel.textContent = type === 'sum' ? `總點數（${lo}–${hi}）` : `顆數（0–${n}）`;
      el.targetOut.textContent = type === 'sum' ? sel.target : `${sel.target} 顆`;
      el.tMinus.disabled = lock || sel.target <= lo;
      el.tPlus.disabled = lock || sel.target >= hi;
    }
    el.quickSum.hidden = type !== 'sum';
    el.quickSum.querySelectorAll('button').forEach(x => {
      const q = quickBet(n, x.dataset.quick);
      x.classList.toggle('on', q.cond === sel.cond && q.target === sel.target);
      x.disabled = lock;
    });

    // 勝率 / 倍數
    const chance = D.winChance(b);
    const ok = chance > 0 && chance <= D.MAX_CHANCE;
    const amount = Math.max(0, +el.bet.value || 0);
    const m = ok ? D.RTP / chance : 0;
    el.chance.textContent = pct(chance);
    el.chance.className = ok ? '' : 'warn';
    el.mult.textContent = ok ? fmtMult(m) : '—';
    el.pay.textContent = ok ? fmt(D.cents(amount * m)) : '—';
    el.profit.textContent = ok ? '+' + fmt(D.cents(amount * m) - amount) : '—';
    el.profit.className = ok ? 'g' : '';
    el.betLine.innerHTML = ok
      ? `本注 <b>${glyphs(D.label(b))}</b>　勝率 <b>${pct(chance)}</b>　贏了 <span class="g">${fmtMult(m)}</span>`
      : `<span style="color:var(--red)">勝率 ${pct(chance)} 太高（上限 ${D.MAX_CHANCE * 100}%），請調整目標</span>`;

    // 主按鈕
    el.main.classList.remove('stop');
    el.main.disabled = false;
    if (autoRunning) {
      el.main.classList.add('stop');
      el.main.textContent = autoStopReq ? '停止中…' : '停止自動投注';
    } else if (rolling) {
      el.main.textContent = '擲骰中…';
      el.main.disabled = true;
    } else {
      el.main.textContent = mode === 'auto' ? '開始自動投注' : '擲骰';
      el.main.disabled = !ok;
    }
    document.querySelectorAll('[data-amt]').forEach(x => { x.disabled = lock; });
    el.bet.disabled = lock;
    el.modeSeg.querySelectorAll('button').forEach(x => { x.disabled = lock; });
    [el.autoCount, el.onWin, el.onLoss, el.stopProfit, el.stopLoss].forEach(i => { i.disabled = autoRunning; });
    el.nonce.textContent = game.nonce + (rolling ? 0 : 1);
    el.tapHint.classList.toggle('show', mode === 'manual' && !lock && !el.main.disabled && trayTaps < 3);

    renderDist();
    renderTable();
    renderBalance();
  }

  // ---------- 分布圖：每種結果一根長條，綠色 = 會贏，點長條設定目標 ----------
  function renderDist() {
    const { n, type } = sel;
    const isTriple = type === 'triple';
    el.dist.hidden = isTriple;
    el.tripleNote.hidden = !isTriple;
    if (isTriple) {
      el.distTitle.textContent = `${n} 顆骰子全部同點`;
      const total = D.combos(n);
      el.tripleNote.innerHTML = `任意豹子 <b>6 / ${total.toLocaleString()}</b>（${pct(6 / total)}）→ <b>${fmtMult(D.RTP * total / 6)}</b><br>` +
        `指定點數豹子 <b>1 / ${total.toLocaleString()}</b>（${pct(1 / total)}）→ <b>${fmtMult(D.RTP * total)}</b>`;
      return;
    }
    el.distTitle.innerHTML = type === 'sum' ? `${n} 顆骰子總點數的機率（越高越常開出）` : `${n} 顆骰子中 ${G(sel.face)} 出現幾顆的機率`;
    const outs = D.outcomes(n, type);
    const total = D.combos(n);
    const max = Math.max(...outs.map(o => o.ways));
    // 柱子太密時只標 5 的倍數、目標與結果，且避開它們旁邊的數字以免重疊
    const dense = outs.length > 16;
    const near = v => [sel.target, lastHit].some(x => x !== null && Math.abs(v - x) <= 1 && v !== x);
    const keyV = v => v === sel.target || v === lastHit;
    el.dist.innerHTML = outs.map(o => {
      const w = D.hit(sel.cond, o.value, sel.target);
      const nl = dense && !keyV(o.value) && (o.value % 5 !== 0 || near(o.value));
      const cls = `bar${w ? ' w' : ''}${o.value === sel.target ? ' t' : ''}${o.value === lastHit ? ' hit' : ''}${nl ? ' nl' : ''}`;
      const h = Math.max(2, o.ways / max * 100);
      return `<button type="button" class="${cls}" data-v="${o.value}" title="${o.value}${type === 'count' ? ' 顆' : ' 點'}：${pct(o.ways / total)}">` +
        `<span class="col" style="height:calc(${h}% - 14px)"></span><span class="lbl">${o.value}</span></button>`;
    }).join('');
  }

  // ---------- 賠率表 ----------
  function renderTable() {
    const { n, type } = sel;
    if (type === 'triple') {
      el.tableHint.textContent = '豹子：所有骰子點數相同（倍數 × 勝率 = 98%）';
      el.tableHead.innerHTML = '<span>骰子數</span><span>任意豹子</span><span>指定點數</span><span>任意勝率</span>';
      let html = '';
      for (let k = 2; k <= D.MAX_DICE; k++) {
        const t = D.combos(k);
        html += `<div class="row four${k === n ? ' cur' : ''}"><span>${k} 顆</span><span>${fmtMult(D.RTP * t / 6)}</span><span>${fmtMult(D.RTP * t)}</span><span>${pct(6 / t)}</span></div>`;
      }
      el.oddsTable.innerHTML = html;
      return;
    }
    const unit = type === 'sum' ? '點' : '顆';
    el.tableHint.innerHTML = `${n} 顆骰子 · ${type === 'sum' ? '總點數' : G(sel.face) + ' 出現顆數'}：各目標的倍數（勝率 > 97% 不開放）`;
    el.tableHead.innerHTML = type === 'sum'
      ? '<span>目標</span><span>剛好</span><span>以上</span><span>以下</span>'
      : '<span>目標</span><span>剛好</span><span>至少</span><span>最多</span>';
    const [lo, hi] = D.targetRange(n, type);
    let html = '';
    for (let t = lo; t <= hi; t++) {
      const cell = cond => {
        const b = { n, type, cond, target: t, face: sel.face };
        const p = D.winChance(b);
        const on = cond === sel.cond && t === sel.target;
        if (!(p > 0 && p <= D.MAX_CHANCE)) return '<span class="x">—</span>';
        return `<span${on ? ' class="g"' : ''} title="勝率 ${pct(p)}">${fmtMult(D.RTP / p)}</span>`;
      };
      html += `<div class="row four${t === sel.target ? ' cur' : ''}"><span>${t} ${unit}</span>${cell('eq')}${cell('ge')}${cell('le')}</div>`;
    }
    el.oddsTable.innerHTML = html;
  }

  // ---------- 紀錄 ----------
  const valueText = h => (h.type === 'sum' ? `${h.value}` : h.type === 'count' ? `${h.value}×${G(h.face)}` : h.value ? `豹${G(h.value)}` : '—');

  function renderRecent() {
    el.recent.innerHTML = history.slice(0, 8).map(h => `<span class="pill${h.win ? '' : ' l'}">${valueText(h)}</span>`).join('');
  }

  function renderHistory() {
    if (!history.length) {
      el.myList.innerHTML = '<div class="empty">還沒有紀錄，擲一把吧！</div>';
    } else {
      el.myList.innerHTML = history.slice(0, 50).map(h => {
        const dl = h.dice.map(v => miniDie(v, h.type === 'count' && v === h.face ? 'hl' : '')).join('');
        return `<div class="row"><span>#${h.nonce}</span><span>${glyphs(h.label)}</span><span class="dl">${dl}</span><span>${fmt(h.amount)}</span>` +
          `<span class="${h.win ? 'g' : 'r'}">${h.win ? fmt(h.payout) : '-' + fmt(h.amount)}</span></div>`;
      }).join('');
    }
    const n = history.length;
    const wagered = history.reduce((s, h) => s + h.amount, 0);
    const paid = history.reduce((s, h) => s + h.payout, 0);
    const wins = history.filter(h => h.win).length;
    const net = paid - wagered;
    el.summary.innerHTML =
      `<div>局數<b>${n}</b></div>` +
      `<div>勝率<b>${n ? pct(wins / n) : '-'}</b></div>` +
      `<div>淨損益<b class="${net > 0 ? 'g' : net < 0 ? 'r' : ''}">${fmt(net)}</b></div>` +
      `<div>總下注<b>${fmt(wagered)}</b></div>` +
      `<div>總派彩<b>${fmt(paid)}</b></div>` +
      `<div>實際回報<b>${wagered ? pct(paid / wagered) : '-'}</b></div>`;
    renderRecent();
  }

  function record(r) {
    history.unshift({
      nonce: r.nonce, label: D.label(r.bet), type: r.bet.type, face: r.bet.face, n: r.bet.n, value: r.value, dice: r.dice,
      amount: r.amount, payout: r.payout, win: r.win, mult: r.multiplier, serverSeed: r.serverSeed, clientSeed: r.clientSeed, t: Date.now()
    });
    if (history.length > 100) history.length = 100;
  }

  function bumpWallet() {
    el.wallet.classList.remove('bump');
    void el.wallet.offsetWidth;
    el.wallet.classList.add('bump');
  }

  // 餘額用完自動補回
  function refillIfBroke() {
    if (game.balance < 0.1) {
      game.balance = START_BALANCE;
      say(`遊戲幣用完了，已補回 ${START_BALANCE}`, true);
    }
  }

  // ---------- 結果 ----------
  function showResult(r) {
    const b = r.bet;
    dice.forEach((d, i) => {
      if (i >= b.n) return;
      const mark = b.type === 'count' ? r.dice[i] === b.face : r.win;
      d.el.classList.toggle('hl', mark);
      d.el.classList.toggle('dim', b.type === 'count' && !mark);
    });
    el.resultVal.innerHTML = b.type === 'sum' ? `${r.value} 點`
      : b.type === 'count' ? `${r.value} 顆 ${G(b.face)}`
        : r.value ? `豹子 ${G(r.value)}` : '沒有豹子';
    el.resultSub.textContent = r.win ? `${fmtMult(r.multiplier)}　+${fmt(r.payout)}` : `沒中　-${fmt(r.amount)}`;
    el.result.className = 'result ' + (r.win ? 'win' : 'lose');
    el.result.hidden = false;
    lastHit = b.type === 'triple' ? null : r.value;
    if (r.win) { Sound.win(r.multiplier >= 10); bumpWallet(); } else Sound.lose();
  }

  async function doRoll(fast) {
    if (rolling) return null;
    const amount = readBet();
    let r;
    try { r = game.roll(amount, bet()); } catch (e) { say(e.message); return null; }
    record(r);
    save();
    rolling = true;
    shownBalance = D.cents(game.balance - r.payout);
    clearMarks();
    renderControls();
    Sound.shake();
    await throwDice(r.dice, fast || reduceMotion);
    rolling = false;
    if (relayoutPending) { relayoutPending = false; placeDice(); }
    shownBalance = null;
    showResult(r);
    refillIfBroke();
    save();
    renderHistory();
    renderControls();
    return r;
  }

  function readBet() {
    const v = D.cents(Math.max(0, +el.bet.value || 0));
    el.bet.value = v.toFixed(2);
    return v;
  }

  // ---------- 自動投注 ----------
  async function runAuto() {
    const baseBet = readBet();
    const rounds = Math.max(0, Math.floor(+el.autoCount.value || 0));
    const onWin = Math.max(0, +el.onWin.value || 0);
    const onLoss = Math.max(0, +el.onLoss.value || 0);
    const stopProfit = Math.max(0, +el.stopProfit.value || 0);
    const stopLoss = Math.max(0, +el.stopLoss.value || 0);
    let amount = baseBet;
    let net = 0;
    let done = 0;
    autoRunning = true;
    autoStopReq = false;
    renderControls();
    while (!autoStopReq && (rounds === 0 || done < rounds)) {
      if (amount > game.balance) { say('餘額不足，自動投注停止'); break; }
      el.bet.value = amount.toFixed(2);
      const r = await doRoll(el.fast.checked);
      if (!r) break;
      net += r.payout - r.amount;
      done += 1;
      if (rounds) el.autoCount.value = rounds - done;
      amount = r.win ? (onWin ? D.cents(amount * (1 + onWin / 100)) : baseBet) : (onLoss ? D.cents(amount * (1 + onLoss / 100)) : baseBet);
      amount = Math.max(0.01, amount);
      if (stopProfit && net >= stopProfit) { say(`已達獲利目標 ${fmt(net)}`, true); break; }
      if (stopLoss && -net >= stopLoss) { say(`已達虧損上限 ${fmt(net)}`); break; }
      await wait(el.fast.checked ? 250 : 550);
    }
    if (rounds) el.autoCount.value = rounds;
    el.bet.value = baseBet.toFixed(2);
    autoRunning = false;
    autoStopReq = false;
    save();
    renderControls();
  }

  // ---------- 事件 ----------
  el.main.addEventListener('click', () => {
    if (autoRunning) { autoStopReq = true; renderControls(); return; }
    if (mode === 'auto') runAuto();
    else doRoll(el.fast.checked);
  });
  // 手動模式點托盤也能擲
  el.tray.addEventListener('click', () => {
    if (mode !== 'manual' || autoRunning || el.main.disabled) return;
    trayTaps += 1;
    el.main.click();
  });

  el.diceCount.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || +b.dataset.n === sel.n) return;
    changeSel(() => {
      const prevType = sel.type;
      sel.n = +b.dataset.n;
      // 骰子數改變時，總點數目標跟著換成新的「大」，避免停在不合理的位置
      if (prevType === 'sum') Object.assign(sel, quickBet(sel.n, sel.cond === 'le' ? 'small' : 'big'));
      if (prevType === 'triple' && sel.n < 2) { sel.type = 'sum'; defaultsFor('sum'); }
    });
    clearMarks();
    placeDice();
  });

  el.typeSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.dataset.type === sel.type) return;
    changeSel(() => { sel.type = b.dataset.type; defaultsFor(sel.type); });
    clearMarks();
  });

  el.facePick.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    changeSel(() => { sel.face = +b.dataset.face; });
  });

  el.condSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    changeSel(() => { sel.cond = b.dataset.cond; });
  });

  const stepTarget = d => changeSel(() => { sel.target += d; });
  el.tMinus.addEventListener('click', () => stepTarget(-1));
  el.tPlus.addEventListener('click', () => stepTarget(1));
  el.quickSum.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    changeSel(() => Object.assign(sel, quickBet(sel.n, b.dataset.quick)));
  });
  el.dist.addEventListener('click', e => {
    const b = e.target.closest('.bar');
    if (!b) return;
    changeSel(() => { sel.target = +b.dataset.v; });
  });

  document.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
    const v = +el.bet.value || 0;
    const a = b.dataset.amt;
    const n = a === 'half' ? v / 2 : a === 'double' ? v * 2 : game.balance;
    el.bet.value = Math.min(game.balance, Math.max(0.01, D.cents(n))).toFixed(2);
    save();
    renderControls();
  }));
  el.bet.addEventListener('change', () => { readBet(); save(); renderControls(); });
  el.bet.addEventListener('input', renderControls);
  el.fast.addEventListener('change', save);

  el.modeSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || rolling || autoRunning) return;
    mode = b.dataset.mode;
    el.modeSeg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    el.autoFields.hidden = mode !== 'auto';
    renderControls();
  });

  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab-body').forEach(x => { x.hidden = x.id !== 'tab-' + b.dataset.tab; });
  });

  el.sound.addEventListener('click', () => { el.sound.classList.toggle('off', !Sound.toggle()); });
  el.sound.classList.toggle('off', !Sound.enabled);

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea, dialog')) return;
    if (e.code === 'Space') { e.preventDefault(); if (!el.main.disabled) el.main.click(); }
    else if (e.key === 'ArrowUp' && sel.type !== 'triple') { e.preventDefault(); if (!el.tPlus.disabled) stepTarget(1); }
    else if (e.key === 'ArrowDown' && sel.type !== 'triple') { e.preventDefault(); if (!el.tMinus.disabled) stepTarget(-1); }
  });

  if (window.ResizeObserver) {
    let lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const w = el.tray.clientWidth, h = el.tray.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (rolling) relayoutPending = true; // 動畫結束後再擺
      else placeDice();
    }).observe(el.tray);
  }

  // ---------- 公平性 ----------
  function renderVerify() {
    const s = el.vServer.value.trim(), c = el.vClient.value.trim();
    const nonce = Math.floor(+el.vNonce.value), n = Math.floor(+el.vDice.value);
    if (!s || !c || !(nonce >= 1) || !(n >= D.MIN_DICE && n <= D.MAX_DICE)) {
      el.verifyOut.innerHTML = '<span class="r">請填入完整資料</span>';
      return;
    }
    let vals;
    try { vals = D.rollDice(s, c, nonce, n); } catch (e) { el.verifyOut.innerHTML = '<span class="r">種子只能包含英數字元</span>'; return; }
    el.verifyOut.innerHTML = `SHA256(伺服器種子) = <span class="g">${window.sha256(s)}</span><br>` +
      `骰子：${vals.join(', ')}（總點 ${vals.reduce((a, b) => a + b, 0)}）<br>${vals.map(v => miniDie(v)).join('')}`;
  }

  $('#fairBtn').addEventListener('click', () => {
    el.clientSeed.value = game.clientSeed;
    el.nextHash.textContent = game.nextServerHash;
    const last = history[0];
    el.vServer.value = last ? last.serverSeed : '';
    el.vClient.value = last ? last.clientSeed : '';
    el.vNonce.value = last ? last.nonce : '';
    el.vDice.value = last ? last.n : '';
    renderVerify();
    el.fair.showModal();
  });
  [el.vServer, el.vClient, el.vNonce, el.vDice].forEach(i => i.addEventListener('input', renderVerify));
  el.clientSeed.addEventListener('change', () => {
    const v = el.clientSeed.value.replace(/[^\x20-\x7e]/g, '').trim();
    if (!v) { el.clientSeed.value = game.clientSeed; return; }
    game.clientSeed = v;
    el.clientSeed.value = v;
    save();
  });
  $('#seedRandom').addEventListener('click', () => {
    game.clientSeed = D.randomHex(8);
    game.nextServerSeed = D.randomHex(32);
    el.clientSeed.value = game.clientSeed;
    el.nextHash.textContent = game.nextServerHash;
    save();
  });

  // ---------- 初始化 ----------
  fixSel();
  if (history[0] && history[0].n === sel.n) history[0].dice.forEach((v, i) => { dice[i].v = v; });
  placeDice();
  renderHistory();
  renderControls();
  window.addEventListener('beforeunload', save);
})();
