// =====================================================================
// SOUND (made in code, no sound files) - shared by offline + online
// =====================================================================

const Sound = {
  ctx: null, master: null, noise: null, crowdGain: null,

  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      // 2 seconds of random "white noise" - the crowd is made from this
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Background crowd murmur that loops forever
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = "bandpass"; band.frequency.value = 500; band.Q.value = 0.6;
      this.crowdGain = this.ctx.createGain();
      this.crowdGain.gain.value = 0.05;
      src.connect(band).connect(this.crowdGain).connect(this.master);
      src.start();
    } catch (e) { this.ctx = null; }
  },
  muted: false,
  setMuted(m) { this.muted = !!m; if (this.master) this.master.gain.value = m ? 0 : 1; },

  // a burst of filtered noise with a volume envelope
  noiseBurst(freq, q, peak, attack, decay) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + attack + decay + 0.05);
  },
  tone(type, f1, f2, vol, dur) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  kick(power) {
    const v = clamp(power / 1000, 0.25, 1);
    this.tone("sine", 160, 50, 0.35 * v, 0.12);     // the "thump"
    this.noiseBurst(2500, 1.5, 0.08 * v, 0.003, 0.04); // the "click"
  },
  whistle(long = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, dur = long ? 0.9 : 0.3;
    const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.value = 2900;
    lfo.frequency.value = 28; lfoGain.gain.value = 140; // the "trill"
    lfo.connect(lfoGain).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.09, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
  },
  cheer() {
    this.noiseBurst(900, 0.5, 0.55, 0.3, 3.2);
    this.noiseBurst(2200, 0.7, 0.25, 0.4, 2.6);
  },
  ooh() { this.noiseBurst(420, 0.8, 0.3, 0.25, 1.2); },
  post() { this.tone("triangle", 1400, 900, 0.15, 0.25); },
  // referee shows a card: two sharp blasts + the crowd reacts
  card(kind) {
    this.whistle(); setTimeout(() => this.whistle(), 220);
    if (kind === 2) this.noiseBurst(300, 0.6, 0.35, 0.2, 1.4); else this.ooh();
  },
  // assistant referee's flag: a short whistle and a groan
  flag() { this.whistle(); this.noiseBurst(350, 0.7, 0.18, 0.15, 0.8); },
  // skill move: a quick "whoosh"
  skill() { this.noiseBurst(1600, 1.2, 0.12, 0.02, 0.25); },
  // big celebration (trophy): long cheer + fanfare
  fanfare() {
    this.cheer();
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone("square", f, f, 0.06, 0.35), i * 160));
  },
};

// Play a sound event that the game logic sent (["kick", 800], ["cheer"] ...)
function playEvent([name, arg]) {
  if (name === "kick") Sound.kick(arg || 600);
  else if (name === "whistleLong") Sound.whistle(true);
  else if (name === "card") Sound.card(arg);
  else if (Sound[name]) Sound[name]();
}

