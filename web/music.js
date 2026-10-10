// Lo-fi background music, generated live with the Web Audio API: no audio files, nothing to license.
// Electric-piano chords, a warm bass line, a lazy swung beat, a sparse melody and vinyl crackle, all
// through a tape-ish chain (low-pass, soft saturation, a slow wow). Browsers only allow sound after a
// click or key press, so start() is called from the Begin button.

const BPM = 72;
const BEAT = 60 / BPM;
const SWING = 0.6; // share of each beat taken by its first eighth
const VOLUME = 0.5;
const LOOKAHEAD = 0.3; // seconds of notes scheduled ahead
const STORE = "courier:music";

// Each chord: bass note and an electric-piano voicing (MIDI numbers), one bar each.
const PROGRESSIONS = [
  [ // Fmaj9 · Em7 · Dm9 · Cmaj9
    { bass: 41, keys: [57, 60, 64, 67] }, { bass: 40, keys: [55, 59, 62, 64] },
    { bass: 38, keys: [53, 57, 60, 64] }, { bass: 36, keys: [52, 55, 59, 62] },
  ],
  [ // Dm9 · G13 · Cmaj9 · Am7
    { bass: 38, keys: [53, 57, 60, 64] }, { bass: 43, keys: [53, 57, 59, 64] },
    { bass: 36, keys: [52, 55, 59, 62] }, { bass: 45, keys: [55, 60, 64, 67] },
  ],
  [ // Bbmaj7 · Am7 · Gm9 · C9
    { bass: 46, keys: [53, 57, 62, 65] }, { bass: 45, keys: [55, 60, 64, 67] },
    { bass: 43, keys: [53, 57, 58, 62] }, { bass: 36, keys: [52, 58, 62, 64] },
  ],
];
const MELODY = [67, 69, 72, 74, 76, 79, 81]; // C major pentatonic, upper register

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

function loadEnabled() {
  try { return localStorage.getItem(STORE) !== "off"; } catch { return true; }
}
function saveEnabled(on) {
  try { localStorage.setItem(STORE, on ? "on" : "off"); } catch {}
}

export function createMusic() {
  let enabled = loadEnabled();
  let ctx = null, timer = 0;
  let master, bus, epBus, drumBus, verbSend, wow, noise;
  // Where the song is: the next eighth to schedule, its time, and the arrangement.
  let nextTime = 0, slot = 0, bar = 0, prog = PROGRESSIONS[0], melodic = false;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    const tape = ctx.createBiquadFilter();
    tape.type = "lowpass";
    tape.frequency.value = 4200;
    tape.Q.value = 0.4;
    const sat = ctx.createWaveShaper();
    sat.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(2 * (i / 511.5 - 1)) / Math.tanh(2));
    bus = ctx.createGain();
    bus.connect(tape).connect(sat).connect(comp).connect(master).connect(ctx.destination);

    // A small generated room.
    const verb = ctx.createConvolver();
    verb.buffer = impulse(2.4);
    verbSend = ctx.createGain();
    verbSend.gain.value = 0.25;
    verbSend.connect(verb).connect(comp);

    // Electric piano bus with a gentle tremolo.
    epBus = ctx.createGain();
    epBus.gain.value = 0.85;
    const epTone = ctx.createBiquadFilter();
    epTone.type = "lowpass";
    epTone.frequency.value = 2600;
    epBus.connect(epTone).connect(bus);
    epTone.connect(verbSend);
    const trem = ctx.createOscillator();
    trem.frequency.value = 4.4;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.12;
    trem.connect(tremDepth).connect(epBus.gain);
    trem.start();

    drumBus = ctx.createGain();
    drumBus.gain.value = 0.8;
    const drumTone = ctx.createBiquadFilter();
    drumTone.type = "lowpass";
    drumTone.frequency.value = 5200;
    drumBus.connect(drumTone).connect(bus);

    // Tape wow: a slow pitch drift shared by the tonal voices.
    const wowLfo = ctx.createOscillator();
    wowLfo.frequency.value = 0.45;
    wow = ctx.createGain();
    wow.gain.value = 7; // cents
    wowLfo.connect(wow);
    wowLfo.start();

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

    crackle();
  }

  function impulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }

  /// Vinyl: a quiet hiss with sparse pops, looped.
  function crackle() {
    const len = ctx.sampleRate * 5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
    for (let k = 0; k < 90; k++) {
      const at = Math.floor(Math.random() * (len - 200));
      const amp = rand(0.15, 0.7) * (chance(0.5) ? 1 : -1);
      for (let j = 0; j < 60; j++) d[at + j] += amp * Math.exp(-j / 8);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    src.connect(hp).connect(g).connect(bus);
    src.start();
  }

  function voice(type, freq, t, peak, attack, decay, end, dest, wobble = true) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (wobble) {
      wow.connect(o.detune);
      o.onended = () => wow.disconnect(o.detune);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.3, 0.0002), t + decay);
    g.gain.exponentialRampToValueAtTime(0.0001, t + end);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + end + 0.05);
    return o;
  }

  function epChord(t, keys, vel, length) {
    keys.forEach((m, i) => {
      const at = t + i * rand(0.008, 0.022); // a soft strum
      const v = vel * rand(0.8, 1);
      voice("sine", hz(m), at, 0.11 * v, 0.012, 0.7, length, epBus);
      voice("triangle", hz(m) * 2.002, at, 0.018 * v, 0.006, 0.25, length * 0.6, epBus);
    });
  }

  function bass(t, midi, length) {
    const g = ctx.createGain();
    g.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    g.connect(lp).connect(bus);
    voice("sine", hz(midi), t, 0.32, 0.02, length * 0.6, length, g, false);
    voice("triangle", hz(midi) * 2, t, 0.05, 0.02, length * 0.4, length * 0.8, g, false);
  }

  function kick(t, vel) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(g).connect(drumBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  function noiseHit(t, vel, filterType, freq, q, length, dest) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(g).connect(dest);
    src.start(t, rand(0, 0.5));
    src.stop(t + length + 0.05);
  }

  function snare(t, vel) {
    noiseHit(t, 0.22 * vel, "bandpass", 1800, 0.7, 0.2, drumBus);
    noiseHit(t, 0.06 * vel, "bandpass", 1800, 0.7, 0.3, verbSend);
    voice("triangle", 185, t, 0.1 * vel, 0.002, 0.06, 0.12, drumBus, false);
  }

  function hat(t, vel, open) {
    noiseHit(t, 0.07 * vel, "highpass", 7200, 0.5, open ? 0.28 : 0.045, drumBus);
  }

  function melodyNote(t, midi, length) {
    const g = ctx.createGain();
    g.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1900;
    g.connect(lp).connect(bus);
    lp.connect(verbSend);
    const o = voice("triangle", hz(midi), t, 0.045, 0.06, length * 0.7, length, g);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const depth = ctx.createGain();
    depth.gain.value = 9;
    vib.connect(depth).connect(o.detune);
    vib.start(t);
    vib.stop(t + length + 0.05);
  }

  /// One eighth note of the song, at time t.
  function play(t) {
    const chord = prog[bar % 4];
    const next = prog[(bar + 1) % 4];
    const intro = bar < 2; // keys alone at first
    const drums = bar >= 4 && bar % 16 !== 15; // the beat drops out for a bar now and then

    if (slot === 0) epChord(t, chord.keys, rand(0.85, 1), BEAT * 3.2);
    if ((slot === 3 || slot === 5) && chance(0.35)) epChord(t, chord.keys.slice(1), rand(0.4, 0.6), BEAT * 1.4);

    if (!intro) {
      if (slot === 0) bass(t, chord.bass, BEAT * 1.6);
      if (slot === 4) bass(t, chance(0.7) ? chord.bass : chord.bass + 7, BEAT * 1.4);
      if (slot === 7 && chance(0.4)) bass(t, next.bass + (chance(0.5) ? -1 : 2), BEAT * 0.4);
    }

    if (drums) {
      if (slot === 0 || slot === 4 || (slot === 5 && chance(0.3)) || (slot === 3 && chance(0.15))) kick(t, slot % 4 === 0 ? 1 : 0.7);
      if (slot === 2 || slot === 6) snare(t, rand(0.85, 1));
      if (chance(0.92)) hat(t, (slot % 2 === 0 ? 1 : 0.6) * rand(0.7, 1), slot === 7 && chance(0.25));
    }

    if (melodic && !intro && chance(slot % 2 === 0 ? 0.22 : 0.1)) {
      melodyNote(t, MELODY[Math.floor(Math.random() * MELODY.length)], BEAT * rand(0.6, 1.6));
    }
  }

  function advance() {
    nextTime += BEAT * (slot % 2 === 0 ? SWING : 1 - SWING);
    slot = (slot + 1) % 8;
    if (slot === 0) {
      bar++;
      if (bar % 8 === 0) {
        prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
        melodic = chance(0.6);
      }
    }
  }

  function schedule() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      play(nextTime);
      advance();
    }
  }

  function fadeTo(value, seconds) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  function run() {
    if (!ctx) {
      build();
      nextTime = ctx.currentTime + 0.1;
    }
    ctx.resume();
    if (!timer) timer = setInterval(schedule, 60);
    nextTime = Math.max(nextTime, ctx.currentTime + 0.05);
    fadeTo(VOLUME, 2.5);
  }

  function pause() {
    if (!ctx) return;
    fadeTo(0, 0.6);
    clearInterval(timer);
    timer = 0;
    setTimeout(() => { if (!enabled || document.hidden) ctx.suspend(); }, 700);
  }

  // Quiet in background tabs, back when the player returns.
  document.addEventListener("visibilitychange", () => {
    if (!ctx || !enabled) return;
    if (document.hidden) pause();
    else run();
  });

  return {
    get enabled() { return enabled; },
    /// Call from a click or key press: browsers block sound until then.
    start() {
      if (enabled) run();
    },
    toggle() {
      enabled = !enabled;
      saveEnabled(enabled);
      if (enabled) run();
      else pause();
      return enabled;
    },
  };
}
