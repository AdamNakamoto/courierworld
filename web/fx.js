// Little puffs: dust kicked up by the courier (each running step, a skid, a landing), spray where
// waterfalls land and splashes when wading, and chimney smoke that keeps on rising.
import * as THREE from "https://esm.sh/three@0.160.0";
import { texFromCanvas } from "./world.js";

export function createDust(parent, noNormals, count = 48, tint = 0xeee6d2) {
  const tex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.85)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 30, 0, 7);
    g.fill();
    return texFromCanvas(c);
  })();
  const color = new THREE.Color(tint);
  const pool = [];
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    parent.add(s);
    noNormals.push(s);
    pool.push({ s, life: 0, max: 1, size: 0.3, vel: new THREE.Vector3(), up: new THREE.Vector3(), rise: 0, grow: 0.9 });
  }
  let next = 0;
  const t = new THREE.Vector3();
  return {
    /// A few puffs at pos (in the parent's space), drifting out along the ground and up; `rise`
    /// keeps them climbing (smoke), `grow` is how much bigger they get as they go.
    puff(pos, up, { n = 1, size = 0.3, spread = 0.6, life = 0.5, rise = 0, grow = 0.9 } = {}) {
      for (let i = 0; i < n; i++) {
        const p = pool[(next = (next + 1) % pool.length)];
        t.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        t.addScaledVector(up, -t.dot(up)).normalize();
        p.s.position.copy(pos).addScaledVector(t, 0.08);
        p.vel.copy(t).multiplyScalar(spread * (0.5 + Math.random() * 0.5)).addScaledVector(up, 0.35 + Math.random() * 0.3);
        p.life = p.max = life * (0.8 + Math.random() * 0.4);
        p.size = size * (0.7 + Math.random() * 0.6);
        p.up.copy(up);
        p.rise = rise;
        p.grow = grow;
        p.s.visible = true;
      }
    },
    /// shade: 1 in daylight, lower at night (sprites ignore the scene's lights).
    update(dt, shade = 1) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.s.visible = false;
          continue;
        }
        const k = 1 - p.life / p.max;
        p.s.position.addScaledVector(p.vel, dt).addScaledVector(p.up, p.rise * dt);
        p.vel.multiplyScalar(Math.exp(-dt * 4));
        const sc = p.size * (0.6 + p.grow * k);
        p.s.scale.set(sc, sc, 1);
        p.s.material.opacity = 0.7 * (1 - k) * Math.min(1, k * 8);
        p.s.material.color.copy(color).multiplyScalar(shade);
      }
    },
  };
}
