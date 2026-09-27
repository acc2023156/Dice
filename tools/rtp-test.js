/* RTP 驗證：node tools/rtp-test.js
   1) 用窮舉 6^n 種結果核對每個注項的勝率 → 理論 RTP 皆為 98%
   2) 用真實引擎（含 SHA-256 亂數）蒙地卡羅模擬
   3) 檢查 SHA-256 與 Node crypto 一致、骰子點數分布均勻 */
'use strict';
require('../js/sha256.js');
const D = require('../js/engine.js');
const crypto = require('crypto');

let ok = true;
const check = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) ok = false; };

for (const s of ['', 'abc', 'seed:client:1:0', 'x'.repeat(200)]) {
  check(globalThis.sha256(s) === crypto.createHash('sha256').update(s).digest('hex'), `sha256("${s.slice(0, 20)}")`);
}

// 每顆骰子、每個點數出現頻率 ≈ 1/6
{
  const N = 60000, n = 6, hits = Array.from({ length: n }, () => new Array(7).fill(0));
  for (let k = 1; k <= N; k++) D.rollDice('server', 'client', k, n).forEach((v, i) => hits[i][v]++);
  const expect = N / 6;
  let maxDev = 0;
  for (const h of hits) for (let f = 1; f <= 6; f++) maxDev = Math.max(maxDev, Math.abs(h[f] - expect) / expect);
  check(maxDev < 0.04, `點數分布均勻（6 顆 × 6 點，最大偏差 ${(maxDev * 100).toFixed(2)}%）`);
}

// 所有合法注項
function allBets() {
  const bets = [];
  for (let n = 1; n <= 6; n++) {
    for (const type of ['sum', 'count']) {
      const [lo, hi] = D.targetRange(n, type);
      for (const cond of D.CONDS) for (let t = lo; t <= hi; t++) {
        if (type === 'count') for (let face = 1; face <= 6; face++) bets.push({ n, type, cond, target: t, face });
        else bets.push({ n, type, cond, target: t });
      }
    }
    if (n >= 2) for (let face = 0; face <= 6; face++) bets.push({ n, type: 'triple', face });
  }
  return bets;
}

// 窮舉 6^n 種骰面，核對勝率公式
{
  const every = n => {
    const out = [];
    const rec = (a) => { if (a.length === n) { out.push(a.slice()); return; } for (let f = 1; f <= 6; f++) { a.push(f); rec(a); a.pop(); } };
    rec([]);
    return out;
  };
  const faces = [null]; for (let n = 1; n <= 6; n++) faces.push(every(n));
  let bad = 0, count = 0, playable = 0;
  for (const raw of allBets()) {
    const bet = D.normalize(raw);
    const wins = faces[bet.n].filter(d => D.isWin(bet, d)).length;
    const p = D.winChance(bet);
    count++;
    if (Math.abs(wins / D.combos(bet.n) - p) > 1e-12) { bad++; if (bad < 5) console.log('  mismatch', D.label(bet), wins, p); }
    if (p > 0 && p <= D.MAX_CHANCE) {
      playable++;
      if (Math.abs(p * D.multiplier(bet) - D.RTP) > 1e-12) bad++;
    }
  }
  check(bad === 0, `窮舉核對 ${count} 個注項勝率（其中 ${playable} 個可下注），理論 RTP 皆為 98.00%`);
}

// 蒙地卡羅：用真引擎跑
const cases = [
  { n: 1, type: 'sum', cond: 'eq', target: 6 },
  { n: 2, type: 'sum', cond: 'eq', target: 7 },
  { n: 3, type: 'sum', cond: 'ge', target: 11 },
  { n: 3, type: 'count', cond: 'ge', target: 1, face: 6 },
  { n: 4, type: 'count', cond: 'eq', target: 2, face: 1 },
  { n: 6, type: 'sum', cond: 'le', target: 18 },
  { n: 3, type: 'triple', face: 0 },
  { n: 2, type: 'triple', face: 6 }
];
const N = 80000;
for (const bet of cases) {
  const g = new D.DiceGame({ balance: 1e12 });
  let paid = 0;
  for (let i = 0; i < N; i++) paid += g.roll(100, bet).payout;
  const rtp = paid / N / 100;
  const m = D.multiplier(bet);
  const tol = 4 * Math.sqrt(m * 0.98 / N) + 0.01;
  check(Math.abs(rtp - 0.98) < tol, `模擬 ${D.label(bet)} ×${m.toFixed(4)}：RTP ${(rtp * 100).toFixed(2)}%（${N} 局）`);
}

// 高勝率注項被擋下
{
  const g = new D.DiceGame({ balance: 100 });
  let blocked = false;
  try { g.roll(1, { n: 3, type: 'sum', cond: 'ge', target: 3 }); } catch (e) { blocked = true; }
  check(blocked && g.balance === 100 && g.nonce === 0, '勝率 100% 的注項會被拒絕且不扣款');
}

process.exit(ok ? 0 : 1);
