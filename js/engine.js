/* Dice 遊戲引擎：1–6 顆傳統骰子，玩法有「總點數」「指定點數個數」「豹子」。
   不碰 DOM，Node 也能跑（見 tools/rtp-test.js）。 */
(function (global) {
  'use strict';

  const RTP = 0.98;
  const MIN_DICE = 1;
  const MAX_DICE = 6;
  const MAX_CHANCE = 0.97; // 勝率上限 → 倍數至少約 1.01×
  const sha256 = global.sha256 || (typeof require !== 'undefined' && require('./sha256.js') && global.sha256);

  const TYPES = ['sum', 'count', 'triple'];
  const CONDS = ['eq', 'ge', 'le'];
  const GLYPH = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  const combos = n => Math.pow(6, n);
  function binom(n, k) {
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return Math.round(r);
  }

  // ways[s] = n 顆骰子擲出總和 s 的組合數（逐顆摺積）
  const sumCache = [];
  function sumWays(n) {
    if (sumCache[n]) return sumCache[n];
    let ways = [1];
    for (let d = 0; d < n; d++) {
      const next = new Array(ways.length + 6).fill(0);
      ways.forEach((w, s) => { if (w) for (let f = 1; f <= 6; f++) next[s + f] += w; });
      ways = next;
    }
    return (sumCache[n] = ways);
  }

  // 目標值的範圍：總點數 n..6n；指定點數個數 0..n
  function targetRange(n, type) {
    return type === 'sum' ? [n, 6 * n] : type === 'count' ? [0, n] : [0, 0];
  }

  // 所有可能結果與組合數（總和 = 6^n）
  function outcomes(n, type) {
    const out = [];
    if (type === 'sum') {
      const w = sumWays(n);
      for (let s = n; s <= 6 * n; s++) out.push({ value: s, ways: w[s] });
    } else if (type === 'count') {
      for (let k = 0; k <= n; k++) out.push({ value: k, ways: binom(n, k) * Math.pow(5, n - k) });
    }
    return out;
  }

  const hit = (cond, v, t) => (cond === 'eq' ? v === t : cond === 'ge' ? v >= t : v <= t);

  function winChance(bet) {
    const total = combos(bet.n);
    if (bet.type === 'triple') return bet.n < 2 ? 0 : (bet.face ? 1 : 6) / total;
    let w = 0;
    for (const o of outcomes(bet.n, bet.type)) if (hit(bet.cond, o.value, bet.target)) w += o.ways;
    return w / total;
  }

  // 公平倍數 = RTP / 勝率 → 任何注項的期望回報都是 98%
  function multiplier(bet) {
    const p = winChance(bet);
    return p > 0 ? RTP / p : 0;
  }

  // 本局用來判定的數值：總點數、指定點數出現幾顆、豹子點數（0 = 不是豹子）
  function measure(bet, dice) {
    if (bet.type === 'sum') return dice.reduce((a, b) => a + b, 0);
    if (bet.type === 'count') return dice.filter(d => d === bet.face).length;
    return dice.length >= 2 && dice.every(d => d === dice[0]) ? dice[0] : 0;
  }

  function isWin(bet, dice) {
    const v = measure(bet, dice);
    if (bet.type === 'triple') return v > 0 && (!bet.face || v === bet.face);
    return hit(bet.cond, v, bet.target);
  }

  // 檢查並整理注項，不合法就丟錯
  function normalize(b) {
    const bet = {
      n: Math.round(+b.n), type: b.type, cond: b.cond || 'eq',
      target: Math.round(+b.target || 0), face: Math.round(+b.face || 0)
    };
    if (!(bet.n >= MIN_DICE && bet.n <= MAX_DICE)) throw new Error('骰子數需為 1–6');
    if (!TYPES.includes(bet.type)) throw new Error('未知的玩法');
    if (bet.type === 'triple') {
      if (bet.n < 2) throw new Error('豹子至少要 2 顆骰子');
      if (bet.face < 0 || bet.face > 6) throw new Error('豹子點數需為 1–6');
      bet.cond = 'eq';
      bet.target = 0;
    } else {
      if (!CONDS.includes(bet.cond)) throw new Error('未知的條件');
      const [lo, hi] = targetRange(bet.n, bet.type);
      if (bet.target < lo || bet.target > hi) throw new Error(`目標需在 ${lo}–${hi}`);
      if (bet.type === 'count' && !(bet.face >= 1 && bet.face <= 6)) throw new Error('請選擇點數');
      if (bet.type === 'sum') bet.face = 0;
    }
    return bet;
  }

  const COND_SUM = { eq: '＝', ge: '≥', le: '≤' };
  const COND_COUNT = { eq: '剛好', ge: '至少', le: '最多' };
  function label(bet) {
    if (bet.type === 'sum') return `${bet.n}骰 總點${COND_SUM[bet.cond]}${bet.target}`;
    if (bet.type === 'count') return `${bet.n}骰 ${COND_COUNT[bet.cond]}${bet.target}個${GLYPH[bet.face]}`;
    return `${bet.n}骰 ${bet.face ? '豹子' + GLYPH[bet.face] : '任意豹子'}`;
  }

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    const c = global.crypto || (typeof require !== 'undefined' ? require('crypto').webcrypto : null);
    c.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  // 由種子產生 0~1 浮點數串流：每個 SHA-256 取 8 組 32-bit
  function floats(serverSeed, clientSeed, nonce, count) {
    const out = [];
    for (let cursor = 0; out.length < count; cursor++) {
      const h = sha256(`${serverSeed}:${clientSeed}:${nonce}:${cursor}`);
      for (let i = 0; i < 64 && out.length < count; i += 8) out.push(parseInt(h.slice(i, i + 8), 16) / 0x100000000);
    }
    return out;
  }

  // 第 i 顆骰子 = floor(float_i × 6) + 1
  function rollDice(serverSeed, clientSeed, nonce, n) {
    return floats(serverSeed, clientSeed, nonce, n).map(f => Math.floor(f * 6) + 1);
  }

  const cents = x => Math.floor(x * 100 + 1e-7) / 100;

  class DiceGame {
    constructor(opts = {}) {
      this.balance = opts.balance ?? 1000;
      this.clientSeed = opts.clientSeed || randomHex(8);
      this.nonce = opts.nonce || 0;
      this.nextServerSeed = randomHex(32);
    }

    get nextServerHash() { return sha256(this.nextServerSeed); }

    // 下注並立即結算（扣注、擲骰、派彩）
    roll(amount, rawBet) {
      amount = cents(+amount);
      const bet = normalize(rawBet);
      if (!(amount > 0)) throw new Error('請輸入下注金額');
      if (amount > this.balance + 1e-9) throw new Error('餘額不足');
      const chance = winChance(bet);
      if (chance > MAX_CHANCE) throw new Error(`勝率需 ≤ ${MAX_CHANCE * 100}%（倍數太低）`);
      const serverSeed = this.nextServerSeed;
      this.nextServerSeed = randomHex(32);
      this.nonce += 1;
      const dice = rollDice(serverSeed, this.clientSeed, this.nonce, bet.n);
      const win = isWin(bet, dice);
      const mult = RTP / chance;
      const payout = win ? cents(amount * mult) : 0;
      this.balance = cents(this.balance - amount + payout);
      return {
        nonce: this.nonce, amount, bet, dice, value: measure(bet, dice), win, chance, multiplier: mult, payout,
        serverSeed, serverHash: sha256(serverSeed), clientSeed: this.clientSeed
      };
    }
  }

  global.Dice = {
    RTP, MIN_DICE, MAX_DICE, MAX_CHANCE, TYPES, CONDS, GLYPH,
    sumWays, outcomes, targetRange, hit, winChance, multiplier, measure, isWin, normalize, label,
    rollDice, randomHex, cents, combos, DiceGame
  };
  if (typeof module !== 'undefined') module.exports = global.Dice;
})(typeof window !== 'undefined' ? window : globalThis);
