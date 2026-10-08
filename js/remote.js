/* 從大廳（GDBO）進入時使用 SHA Platform：骰子點數、派彩與餘額皆由伺服器決定，餘額為會員的 GDBO 錢包。
   網址帶 ?api=<SHA API>&return=<大廳> 與 #token=<launch token>；沒有 token 時沿用本機試玩（engine.js）。 */
(function (global) {
  'use strict';
  const D = global.Dice;

  const query = new URLSearchParams(global.location.search);
  let token = new URLSearchParams(global.location.hash.slice(1)).get('token');
  try {
    if (token) global.sessionStorage.setItem('dice.launchToken', token);
    else token = global.sessionStorage.getItem('dice.launchToken');
  } catch (e) { /* ignore */ }
  if (global.location.hash) global.history.replaceState(null, '', global.location.pathname + global.location.search);
  // api 只接受 Cloudflare Workers 或本機，launch token 不會送到其他主機
  const apiBase = (() => {
    try {
      const u = new URL(query.get('api') || 'https://sha-platform-dev.sha-platform.workers.dev/api/v1');
      return /\.workers\.dev$|(^|\.)gdclub\.cc$|^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? u.href.replace(/\/$/, '') : '';
    } catch (e) { return ''; }
  })();

  const toUnits = coins => String(Math.round(coins * 100) * 10);
  const fromMoney = money => Number(money.units) / 10 ** money.scale;

  class RemoteDiceGame extends D.DiceGame {
    constructor(opts) {
      super({ ...opts, balance: 0 });
      this.remote = true;
      this.commitment = null;
    }

    get nextServerHash() { return this.commitment ? this.commitment.server_seed_hash : ''; }

    async api(path, body) {
      const response = await fetch(apiBase + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages = { INSUFFICIENT_FUNDS: '餘額不足', INVALID_LAUNCH_TOKEN: '登入已逾時，請回大廳重新進入', INVALID_BET: '注項不合法' };
        throw new Error(messages[payload.error && payload.error.code] || (payload.error && payload.error.message) || `連線錯誤 (${response.status})`);
      }
      return payload;
    }

    /** 取得餘額與下一局的伺服器種子承諾。 */
    async connect() {
      const session = await this.api('/games/dice/session');
      this.balance = fromMoney(session.balance);
      this.commitment = session.commitment;
    }

    // 下注並由伺服器擲骰、結算；回傳格式與本機 DiceGame.roll 相同
    async roll(amount, rawBet) {
      amount = D.cents(+amount);
      const bet = D.normalize(rawBet);
      if (!(amount > 0)) throw new Error('請輸入下注金額');
      if (amount > this.balance + 1e-9) throw new Error('餘額不足');
      const chance = D.winChance(bet);
      if (chance > D.MAX_CHANCE) throw new Error(`勝率需 ≤ ${D.MAX_CHANCE * 100}%（倍數太低）`);
      const res = await this.api('/games/dice/bets', {
        request_id: global.crypto.randomUUID(), commitment_id: this.commitment.id, client_seed: this.clientSeed,
        wager: { units: toUnits(amount), currency: 'TWD', scale: 3 }, ...bet
      });
      this.balance = fromMoney(res.balance);
      this.commitment = res.next_commitment;
      this.nonce = +res.fairness.nonce;
      const o = res.outcome;
      return {
        nonce: this.nonce, amount, bet, dice: o.dice, value: o.value, win: o.win, chance, multiplier: D.multiplier(bet),
        payout: fromMoney(res.payout), serverSeed: res.fairness.server_seed, serverHash: res.fairness.server_seed_hash,
        clientSeed: res.fairness.client_seed
      };
    }
  }

  D.remote = token && apiBase ? { RemoteDiceGame } : null;
})(window);
