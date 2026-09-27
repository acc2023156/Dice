/* 合成音效（Web Audio，不需音檔）：第一次使用者操作後才建立 AudioContext */
(function (global) {
  'use strict';
  let ctx = null;
  let enabled = true;
  let noiseBuf = null;
  try { enabled = localStorage.getItem('dice.sound') !== 'off'; } catch (e) { /* storage unavailable */ }

  function audio() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, { at = 0, dur = 0.08, type = 'sine', gain = 0.12, slide = 0 } = {}) {
    const ac = enabled && audio();
    if (!ac) return;
    const t = ac.currentTime + at;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise({ at = 0, dur = 0.6, gain = 0.3, from = 3000, to = 120 } = {}) {
    const ac = enabled && audio();
    if (!ac) return;
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + at;
    const src = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    src.buffer = noiseBuf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t);
    src.stop(t + dur);
  }

  const Sound = {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('dice.sound', enabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
      if (enabled) tone(660, { dur: 0.06 });
      return enabled;
    },
    select() { tone(520, { dur: 0.04, type: 'square', gain: 0.04 }); },
    // 出手：骰子在手中互撞的喀啦聲
    shake() {
      for (let i = 0; i < 5; i++) noise({ at: i * 0.045, dur: 0.035, gain: 0.12, from: 5000, to: 1800 });
    },
    // 落桌：力道越小聲音越輕
    clack(power = 1) {
      const p = Math.max(0.15, Math.min(1, power));
      noise({ dur: 0.05, gain: 0.32 * p, from: 4200, to: 700 });
      tone(900 + Math.random() * 500, { dur: 0.03, type: 'square', gain: 0.025 * p });
    },
    win(big) {
      const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
      notes.forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.18, type: 'triangle', gain: 0.1 }));
    },
    lose() { tone(220, { dur: 0.22, type: 'triangle', gain: 0.1, slide: 0.6 }); }
  };
  global.Sound = Sound;
})(window);
