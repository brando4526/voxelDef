/** Tiny WebAudio synth for game sound effects; no audio files required. */
export class Audio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.last = {};
    this.volume = 0.5;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  env(node, t, a, peak, dur) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  tone(type, f0, f1, dur, peak = 0.3, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, 0.005, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, peak, filterType, f0, f1 = f0, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.004, peak, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    const minGap = { bow: 60, hit: 50, sword: 90, thud: 80, explosion: 120, pop: 80 }[name] ?? 40;
    if (now - (this.last[name] || 0) < minGap) return;
    this.last[name] = now;
    switch (name) {
      case 'click': this.tone('square', 520, 380, 0.06, 0.12); break;
      case 'buy': this.tone('square', 660, 660, 0.07, 0.12); this.tone('square', 990, 990, 0.12, 0.12, 0.07); break;
      case 'deny': this.tone('square', 180, 120, 0.18, 0.15); break;
      case 'coin': this.tone('triangle', 1200, 1800, 0.08, 0.08); break;
      case 'bow': this.noiseBurst(0.12, 0.25, 'bandpass', 1800, 600); this.tone('triangle', 220, 120, 0.1, 0.08); break;
      case 'ballista': this.tone('sawtooth', 140, 50, 0.25, 0.22); this.noiseBurst(0.15, 0.2, 'lowpass', 1200, 200); break;
      case 'catapult': this.noiseBurst(0.35, 0.25, 'lowpass', 600, 120); this.tone('triangle', 90, 40, 0.3, 0.2); break;
      case 'hit': this.noiseBurst(0.06, 0.18, 'highpass', 2500, 1500); break;
      case 'thunk': this.tone('square', 160, 70, 0.1, 0.18); break;
      case 'thud': this.noiseBurst(0.3, 0.45, 'lowpass', 400, 60); this.tone('sine', 80, 35, 0.3, 0.35); break;
      case 'sword': this.noiseBurst(0.08, 0.12, 'bandpass', 3500, 2500); this.tone('square', 900, 700, 0.05, 0.05); break;
      case 'ram': this.tone('sine', 70, 30, 0.4, 0.5); this.noiseBurst(0.3, 0.35, 'lowpass', 300, 80); break;
      case 'pop': this.noiseBurst(0.25, 0.35, 'lowpass', 1500, 100); break;
      case 'explosion': this.noiseBurst(1.1, 0.9, 'lowpass', 1200, 40); this.tone('sine', 60, 25, 0.8, 0.6); break;
      case 'death': this.tone('square', 300, 90, 0.15, 0.07); break;
      case 'waveStart':
        [392, 523, 659].forEach((f, i) => this.tone('square', f, f, 0.18, 0.12, i * 0.14));
        break;
      case 'waveEnd':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.16, 0.12, i * 0.12));
        break;
      case 'gameOver':
        [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.35, 0.18, i * 0.3));
        break;
      case 'castleHit': this.noiseBurst(0.12, 0.15, 'lowpass', 900, 300); break;
    }
  }
}
