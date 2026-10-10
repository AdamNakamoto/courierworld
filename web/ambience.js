// Ambient sound for the planet, generated live with the Web Audio API (no audio files): footsteps
// that follow your pace, the hum or rumble of your ride, birds by day and crickets at night, a
// soft breeze, rain when it showers, a hop and a thud when you jump, and a chime for every
// delivered letter. Like the music, it needs a click to start.

const VOLUME = 0.7;
const STORE = "courier:sounds";

const rand = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

function loadEnabled() {
  try { return localStorage.getItem(STORE) !== "off"; } catch { return true; }
}
function saveEnabled(on) {
  try { localStorage.setItem(STORE, on ? "on" : "off"); } catch {}
}

export function createAmbience() {
  let enabled = loadEnabled();
  let ctx = null, master, verbSend, noise, breeze, rainBed;
  let stepPhase = 0, birdIn = 2, cricketIn = 1, dripIn = 0, rideKind, rideLoop = null;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // A short outdoor echo, so birds and chimes sit in the town rather than in your ear.
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
    }
    verb.buffer = ir;
    verbSend = ctx.createGain();
    verbSend.gain.value = 0.3;
    verbSend.connect(verb).connect(master);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

    // Breeze: low, slowly swelling air.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    breeze = ctx.createGain();
    breeze.gain.value = 0.05;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.07;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.025;
    swell.connect(swellDepth).connect(breeze.gain);
    src.connect(lp).connect(breeze).connect(master);
    src.start();
    swell.start();

    // Rain: a soft, wide hiss of countless drops; silent until it showers.
    rainBed = ctx.createGain();
    rainBed.gain.value = 0;
    rainBed.connect(master);
    [[-0.5, 0.2], [0.5, 1.1]].forEach(([pan, offset]) => {
      const r = ctx.createBufferSource();
      r.buffer = noise;
      r.loop = true;
      r.playbackRate.value = 0.9 + offset * 0.1;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const lp2 = ctx.createBiquadFilter();
      lp2.type = "lowpass";
      lp2.frequency.value = 5200;
      r.connect(hp).connect(lp2).connect(panner(pan)).connect(rainBed);
      r.start(0, offset);
    });
  }

  const panner = (pan) => {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  };

  function burst(t, length, filterType, freq, q, peak, dest, rate = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(g).connect(dest);
    src.start(t, rand(0, 1.5));
    src.stop(t + length + 0.05);
  }

  function tone(t, type, freq, peak, length, dest, sweepTo) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.01, length / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  /// One footstep: a soft scuff on pavement with a little body.
  function footstep(speed) {
    const t = ctx.currentTime + 0.01;
    const out = panner(rand(-0.15, 0.15));
    out.connect(master);
    const v = 0.5 + 0.5 * speed;
    burst(t, 0.09, "bandpass", rand(700, 1100), 1.2, 0.16 * v, out, rand(0.8, 1.1));
    tone(t, "sine", rand(85, 105), 0.12 * v, 0.07, out, 55);
  }

  /// A bird somewhere in the trees: a few quick whistles.
  function bird() {
    const out = panner(rand(-0.8, 0.8));
    const g = ctx.createGain();
    g.gain.value = rand(0.4, 1);
    g.connect(out).connect(master);
    out.connect(verbSend);
    const base = rand(2400, 3800);
    let t = ctx.currentTime + 0.02;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const len = rand(0.06, 0.16);
      const f = base * rand(0.85, 1.2);
      tone(t, "sine", f, 0.05, len, g, f * rand(1.15, 1.5));
      t += len + rand(0.03, 0.12);
    }
  }

  /// A cricket's chirp: three fast pulses of a high tone.
  function cricket() {
    const out = panner(rand(-0.9, 0.9));
    const g = ctx.createGain();
    g.gain.value = rand(0.25, 0.7);
    g.connect(out).connect(master);
    const f = rand(4100, 4700);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      tone(t, "sine", f, 0.022, 0.025, g);
      t += 0.045;
    }
  }

  /// One raindrop landing nearby: a tiny high tick.
  function drip() {
    const out = panner(rand(-0.9, 0.9));
    out.connect(master);
    burst(ctx.currentTime + 0.01, rand(0.015, 0.04), "bandpass", rand(2500, 6000), 4, rand(0.01, 0.035), out, rand(0.8, 1.3));
  }

  /// The ride's own sound, looping; its level follows your speed.
  function makeRideLoop(kind) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    const nodes = [];
    const noiseLoop = (type, freq, q, level) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const lv = ctx.createGain();
      lv.gain.value = level;
      src.connect(f).connect(lv).connect(g);
      src.start();
      nodes.push(src);
    };
    let pitch = null;
    if (kind === "skate") noiseLoop("lowpass", 320, 0.7, 0.5);
    else if (kind === "bike") noiseLoop("bandpass", 1800, 2.5, 0.12);
    else if (kind === "plane") noiseLoop("bandpass", 850, 0.6, 0.45);
    else if (kind === "moped") {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 55;
      const o2 = ctx.createOscillator();
      o2.type = "square";
      o2.frequency.value = 110;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      const lv = ctx.createGain();
      lv.gain.value = 0.18;
      const lv2 = ctx.createGain();
      lv2.gain.value = 0.05;
      o.connect(lp);
      o2.connect(lv2).connect(lp);
      lp.connect(lv).connect(g);
      o.start();
      o2.start();
      nodes.push(o, o2);
      pitch = (s) => {
        o.frequency.setTargetAtTime(45 + 40 * s, ctx.currentTime, 0.2);
        o2.frequency.setTargetAtTime(90 + 80 * s, ctx.currentTime, 0.2);
      };
    }
    return {
      gain: g, pitch, kind,
      stop() {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        setTimeout(() => { nodes.forEach((n) => n.stop()); g.disconnect(); }, 600);
      },
    };
  }

  function fadeTo(value, seconds) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }
  function run() {
    if (!ctx) build();
    ctx.resume();
    fadeTo(VOLUME, 1.5);
  }
  function pause() {
    if (!ctx) return;
    fadeTo(0, 0.4);
    setTimeout(() => { if (!enabled || document.hidden) ctx.suspend(); }, 500);
  }
  document.addEventListener("visibilitychange", () => {
    if (!ctx || !enabled) return;
    if (document.hidden) pause();
    else run();
  });

  const live = () => ctx && enabled && ctx.state === "running" && !document.hidden;

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
    /// Each frame. speed: 0 still, 0.62 walking, 1 running. ride: null on foot, else the ride's key.
    /// night: 0 day to 1 night. rain: 0 dry to 1 a proper shower. air: true mid-jump.
    update(dt, { speed, ride, night, rain = 0, air = false }) {
      if (!live()) return;
      // Footsteps, faster when running (and none in mid-air).
      if (air) stepPhase = 0.6;
      else if (!ride && speed > 0.08) {
        stepPhase += dt * (1.2 + 1.9 * speed);
        if (stepPhase >= 1) {
          stepPhase -= 1;
          footstep(speed);
        }
      } else stepPhase = 0.6; // the first step comes quickly after you start walking
      // The ride's loop.
      if (ride !== rideKind) {
        rideLoop?.stop();
        rideLoop = ride ? makeRideLoop(ride) : null;
        rideKind = ride;
      }
      if (rideLoop) {
        rideLoop.gain.gain.setTargetAtTime(speed > 0.05 ? 0.25 + 0.75 * speed : 0, ctx.currentTime, 0.15);
        rideLoop.pitch?.(speed);
      }
      // Birds by day, crickets by night; both mostly keep quiet in the rain.
      birdIn -= dt;
      if (birdIn <= 0) {
        if (chance((1 - night) * (1 - 0.85 * rain))) bird();
        birdIn = rand(2.5, 7);
      }
      cricketIn -= dt;
      if (cricketIn <= 0) {
        if (chance(night * (1 - 0.7 * rain))) cricket();
        cricketIn = rand(0.35, 1.1);
      }
      breeze.gain.value = 0.05 - 0.015 * night + 0.02 * rain;
      // The rain's hiss, with the odd nearby drop on top.
      rainBed.gain.setTargetAtTime(0.11 * rain, ctx.currentTime, 0.5);
      dripIn -= dt;
      if (dripIn <= 0) {
        if (rain > 0.05) drip();
        dripIn = rand(0.02, 0.12) / Math.max(0.2, rain);
      }
    },
    /// Springing off the ground: a soft rising whoop.
    jump() {
      if (!live()) return;
      const t = ctx.currentTime + 0.005;
      const out = panner(0);
      out.connect(master);
      tone(t, "sine", 330, 0.12, 0.16, out, 640);
      burst(t, 0.14, "bandpass", 1300, 0.9, 0.08, out, 1.2);
    },
    /// Touching down; level 0..1 is how hard.
    land(level = 1) {
      if (!live()) return;
      const t = ctx.currentTime + 0.005;
      const out = panner(0);
      out.connect(master);
      const v = 0.4 + 0.6 * level;
      tone(t, "sine", 120, 0.2 * v, 0.12, out, 55);
      burst(t, 0.1, "lowpass", 900, 0.7, 0.14 * v, out, 0.8);
    },
    /// A bright two-note bell for a delivered letter.
    chime() {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(master);
      g.connect(verbSend);
      [[1318.5, 0], [1975.5, 0.13]].forEach(([f, dt]) => {
        tone(t + dt, "triangle", f, 0.18, 1.3, g);
        tone(t + dt, "sine", f * 2, 0.04, 0.6, g);
      });
    },
  };
}
