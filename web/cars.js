// Courier Cars (car-kinds.js): the 19 cars a courier can drive, each Courier World's own design. A car is a ride like
// those in rides.js (it faces +z with its base on the ground, its wheels turn about x, and `mount` says how the rider
// goes in it), but the courier is hidden: only the car shows. Every car moves at the moped's speed.
//
// Each body is a side profile ([z forward, y up] points) pushed out to the car's width, with glass, lights, wheels and
// the car's own details on top: a few boxes and cylinders each, cheap to draw.
import * as THREE from "https://esm.sh/three@0.160.0";
import { toon } from "./world.js";
import { carOf } from "./car-kinds.js";

export const CAR_SPEED = 2.0; // the moped's (rides.js)
const GLASS = 0x34505e, TYRE = 0x262b2e, HUB = 0xd9d8d2, CHROME = 0xd9dde0, DARK = 0x2a2f33;
const lit = (c, k = 0.9) => ({ emissive: c, emissiveIntensity: k });

function kit() {
  const mats = new Map();
  const mat = (c, extra) => {
    const key = `${c}:${extra ? JSON.stringify(extra) : ""}`;
    if (!mats.has(key)) mats.set(key, toon(c, extra));
    return mats.get(key);
  };
  return (parent, geo, color, x = 0, y = 0, z = 0, extra) => {
    const m = new THREE.Mesh(geo, mat(color, extra));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
}

/// A side profile ([z, y] points, going round) pushed out `width` wide, centred on x = 0 (rounded edges).
function profile(points, width, bevel = 0.04) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevel: true, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  g.rotateY(-Math.PI / 2); // (the shape's x is the car's forward z; it's pushed out along -x)
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

/// A wheel turning about x, radius r, at (x, y = r, z), with a hub (and white walls, if asked).
function wheel(add, parent, r, width, x, z, { hub = HUB, whitewall = false } = {}) {
  const w = new THREE.Group();
  w.position.set(x, r, z);
  parent.add(w);
  add(w, new THREE.CylinderGeometry(r, r, width, 18).rotateZ(Math.PI / 2), TYRE);
  if (whitewall) add(w, new THREE.CylinderGeometry(r * 0.78, r * 0.78, width + 0.01, 18).rotateZ(Math.PI / 2), 0xf4f1e8);
  add(w, new THREE.CylinderGeometry(r * 0.5, r * 0.5, width + 0.02, 12).rotateZ(Math.PI / 2), hub);
  add(w, new THREE.BoxGeometry(width + 0.03, r * 0.85, 0.05), 0x5a5f6e); // (a spoke, to see it turn)
  return w;
}

/// Four wheels at the corners: `front` and `rear` z, `track` (half the distance between left and right).
function four(add, group, wheels, r, width, track, front, rear, opts) {
  for (const x of [-track, track]) for (const z of [front, rear]) wheels.push(wheel(add, group, r, width, x, z, opts));
}

/// Head lights at the front (z) and tail lights at the back, `w` apart, at height y.
function lights(add, group, front, rear, w, y, size = 0.12) {
  for (const x of [-w, w]) {
    add(group, new THREE.BoxGeometry(size * 1.4, size, 0.05), 0xfff2b0, x, y, front, lit(0xfff2b0, 0.8));
    add(group, new THREE.BoxGeometry(size * 1.4, size * 0.7, 0.05), 0xff4a3d, x, y, rear, lit(0xff4a3d, 0.7));
  }
}

/// A flat panel (glass, a stripe, a sign) on one side of the car, x > 0 or < 0, along z.
function side(add, group, color, w, h, y, z, x, extra) {
  for (const s of [-1, 1]) add(group, new THREE.BoxGeometry(0.02, h, w), color, s * x, y, z, extra);
}

/// A car of kind `id` (car-kinds.js) as a ride: { group, mount, update, riderY, key }.
export function createCar(id) {
  const kind = carOf(id) ?? carOf(1), add = kit(), group = new THREE.Group(), wheels = [];
  let float = null, flame = null, bounce = null;
  const body = (pts, w, color, bevel) => add(group, profile(pts, w, bevel), color);
  const glass = (pts, w) => add(group, profile(pts, w, 0.02), GLASS);

  switch (kind.key) {
    case "van": {
      // The post office's red van: tall and boxy, a sloped nose, an envelope on each side.
      body([[-1.3, 0.25], [1.3, 0.25], [1.32, 0.8], [1.05, 1.45], [-1.3, 1.5]], 1.4, 0xd9534a);
      glass([[0.9, 0.95], [1.27, 0.82], [1.04, 1.38], [0.9, 1.4]], 1.42);
      side(add, group, 0xfbf8ef, 0.9, 0.5, 0.95, -0.35, 0.71);
      side(add, group, 0xd9534a, 0.86, 0.04, 1.04, -0.35, 0.72); // (the envelope's flap)
      side(add, group, GLASS, 0.32, 0.36, 1.12, 0.72, 0.71);
      lights(add, group, 1.33, -1.31, 0.5, 0.6);
      four(add, group, wheels, 0.3, 0.22, 0.58, 0.85, -0.85);
      break;
    }
    case "taxi": {
      // A yellow cab: a sedan with a checkered stripe and a light on the roof.
      body([[-1.25, 0.25], [1.25, 0.25], [1.3, 0.62], [0.55, 0.72], [-1.2, 0.74]], 1.36, 0xf2c230);
      body([[-0.75, 0.7], [0.45, 0.7], [0.15, 1.18], [-0.6, 1.18]], 1.22, 0xf2c230, 0.03);
      glass([[-0.68, 0.74], [0.38, 0.74], [0.11, 1.12], [-0.56, 1.12]], 1.26);
      for (let i = 0; i < 10; i++) side(add, group, i % 2 ? 0x1d2023 : 0xfbf8ef, 0.2, 0.08, 0.56, -1.0 + i * 0.22, 0.69);
      add(group, new THREE.BoxGeometry(0.42, 0.14, 0.22), 0xfbf8ef, 0, 1.27, -0.2, lit(0xfff2b0, 0.4));
      lights(add, group, 1.31, -1.26, 0.48, 0.52);
      four(add, group, wheels, 0.27, 0.2, 0.58, 0.8, -0.8);
      break;
    }
    case "hatch": {
      // A little two-tone runabout: teal, with a white roof.
      body([[-1.0, 0.24], [1.05, 0.24], [1.1, 0.62], [0.6, 0.72], [-1.0, 0.74]], 1.3, 0x2f9c95);
      body([[-0.98, 0.7], [0.45, 0.7], [0.12, 1.2], [-0.92, 1.18]], 1.2, 0xfbf8ef, 0.03);
      glass([[-0.9, 0.74], [0.38, 0.74], [0.09, 1.12], [-0.86, 1.1]], 1.24);
      lights(add, group, 1.11, -1.01, 0.45, 0.52);
      four(add, group, wheels, 0.25, 0.2, 0.55, 0.66, -0.64);
      break;
    }
    case "pickup": {
      // A sturdy pickup: a cab up front and an open bed behind.
      body([[-1.35, 0.3], [1.3, 0.3], [1.35, 0.78], [0.75, 0.82], [0.7, 0.62], [-1.35, 0.62]], 1.42, 0x3f6fbf);
      body([[-0.05, 0.6], [0.72, 0.6], [0.5, 1.28], [-0.05, 1.3]], 1.36, 0x3f6fbf, 0.03);
      glass([[0.0, 0.82], [0.66, 0.82], [0.47, 1.22], [0.0, 1.24]], 1.4);
      for (const x of [-0.66, 0.66]) add(group, new THREE.BoxGeometry(0.08, 0.26, 1.3), 0x3f6fbf, x, 0.74, -0.7); // (the bed's sides)
      add(group, new THREE.BoxGeometry(1.4, 0.26, 0.08), 0x3f6fbf, 0, 0.74, -1.34);
      add(group, new THREE.BoxGeometry(0.5, 0.36, 0.5), 0xc9a36b, -0.15, 0.8, -0.65); // (a parcel in the back)
      lights(add, group, 1.36, -1.39, 0.52, 0.62);
      four(add, group, wheels, 0.32, 0.24, 0.62, 0.85, -0.85);
      break;
    }
    case "offroad": {
      // An open-top four-by-four: khaki, a roll bar, a spare wheel on the back.
      body([[-1.1, 0.35], [1.15, 0.35], [1.2, 0.85], [0.45, 0.9], [0.4, 0.75], [-1.1, 0.8]], 1.4, 0x7d8a52);
      add(group, new THREE.BoxGeometry(1.3, 0.05, 0.05), DARK, 0, 1.0, 0.42); // (the windscreen frame)
      add(group, new THREE.BoxGeometry(1.2, 0.3, 0.03), GLASS, 0, 1.12, 0.42);
      for (const x of [-0.6, 0.6]) add(group, new THREE.BoxGeometry(0.06, 0.6, 0.06), DARK, x, 1.1, -0.45);
      add(group, new THREE.BoxGeometry(1.26, 0.06, 0.06), DARK, 0, 1.4, -0.45);
      for (const x of [-0.25, 0.25]) add(group, new THREE.BoxGeometry(0.42, 0.3, 0.4), 0x3b4145, x, 0.95, -0.2); // seats
      const spare = wheel(add, group, 0.3, 0.22, 0, -1.2, {}); // (the spare: it doesn't turn)
      spare.position.set(0, 0.8, -1.22);
      spare.rotation.y = Math.PI / 2;
      lights(add, group, 1.21, -1.11, 0.5, 0.72, 0.14);
      four(add, group, wheels, 0.34, 0.26, 0.64, 0.75, -0.72);
      break;
    }
    case "camper": {
      // A two-tone camper: cream over turquoise, a split windscreen, a pop-up roof.
      body([[-1.3, 0.25], [1.25, 0.25], [1.32, 0.75], [-1.3, 0.75]], 1.42, 0x3fb2b0);
      body([[-1.3, 0.73], [1.32, 0.73], [1.15, 1.45], [-1.3, 1.45]], 1.42, 0xf4ecd8);
      glass([[0.98, 0.92], [1.28, 0.92], [1.13, 1.32], [0.98, 1.32]], 1.44);
      for (const z of [-0.85, -0.3, 0.25]) side(add, group, GLASS, 0.4, 0.3, 1.12, z, 0.72);
      add(group, new THREE.BoxGeometry(1.2, 0.35, 1.6), 0xe8a33d, 0, 1.62, -0.3); // (the pop-up roof, raised)
      add(group, new THREE.CircleGeometry(0.18, 16), 0xfbf8ef, 0, 0.55, 1.335);
      lights(add, group, 1.33, -1.31, 0.5, 0.5);
      four(add, group, wheels, 0.28, 0.22, 0.58, 0.85, -0.85);
      break;
    }
    case "icecream": {
      // A pastel ice-cream truck with a serving window and a giant cone on the roof.
      body([[-1.3, 0.25], [1.25, 0.25], [1.32, 0.78], [1.05, 1.45], [-1.3, 1.5]], 1.42, 0xf7c6d9);
      for (let i = 0; i < 4; i++) side(add, group, i % 2 ? 0xa8e0c8 : 0xfbf8ef, 2.4, 0.1, 0.42 + i * 0.12, -0.05, 0.715);
      side(add, group, GLASS, 0.8, 0.42, 1.08, -0.35, 0.715);
      glass([[0.9, 0.95], [1.27, 0.84], [1.04, 1.38], [0.9, 1.4]], 1.44);
      add(group, new THREE.ConeGeometry(0.22, 0.6, 12).rotateX(Math.PI), 0xd9a55a, 0, 1.85, -0.3);
      add(group, new THREE.SphereGeometry(0.26, 14, 10), 0xfbe3ec, 0, 2.18, -0.3);
      add(group, new THREE.SphereGeometry(0.06, 8, 6), 0xd9534a, 0, 2.46, -0.3);
      lights(add, group, 1.33, -1.31, 0.5, 0.6);
      four(add, group, wheels, 0.3, 0.22, 0.58, 0.85, -0.85);
      break;
    }
    case "monster": {
      // A little truck high on huge wheels, its springs showing.
      bounce = new THREE.Group();
      group.add(bounce);
      const b = (pts, w, c, bev) => add(bounce, profile(pts, w, bev), c);
      b([[-1.15, 0.85], [1.15, 0.85], [1.2, 1.25], [0.55, 1.3], [-1.15, 1.3]], 1.4, 0x8d4bb8);
      b([[-0.6, 1.28], [0.5, 1.28], [0.25, 1.75], [-0.5, 1.75]], 1.3, 0x8d4bb8, 0.03);
      add(bounce, profile([[-0.53, 1.32], [0.43, 1.32], [0.21, 1.69], [-0.44, 1.69]], 1.34, 0.02), GLASS);
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) add(bounce, new THREE.BoxGeometry(0.02, 0.06, 0.5), 0xf2c230, s * 0.71, 1.0 + i * 0.09, 0.6 - i * 0.4); // (flames)
      lights(add, bounce, 1.21, -1.16, 0.5, 1.1);
      for (const x of [-0.72, 0.72]) for (const z of [0.82, -0.82]) {
        wheels.push(wheel(add, group, 0.55, 0.42, x, z, { hub: 0xf2c230 }));
        add(group, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), CHROME, x * 0.7, 0.75, z * 0.85); // (a spring)
      }
      break;
    }
    case "tuktuk": {
      // A three-wheeler: one wheel in front, a striped canopy, open sides.
      body([[-0.95, 0.25], [0.6, 0.25], [1.05, 0.55], [1.05, 0.75], [-0.95, 0.7]], 1.2, 0x2fa36b);
      add(group, new THREE.BoxGeometry(1.05, 0.08, 1.9), 0xfbf8ef, 0, 1.58, -0.05);
      for (let i = 0; i < 5; i++) add(group, new THREE.BoxGeometry(1.06, 0.085, 0.18), 0xf2c230, 0, 1.585, -0.85 + i * 0.4);
      for (const [x, z] of [[-0.5, 0.85], [0.5, 0.85], [-0.5, -0.9], [0.5, -0.9]]) add(group, new THREE.BoxGeometry(0.05, 0.85, 0.05), DARK, x, 1.15, z);
      add(group, new THREE.BoxGeometry(0.9, 0.4, 0.04), GLASS, 0, 1.15, 0.87);
      add(group, new THREE.BoxGeometry(0.9, 0.35, 0.5), 0x3b4145, 0, 0.9, -0.45); // (the back seat)
      add(group, new THREE.BoxGeometry(0.16, 0.12, 0.05), 0xfff2b0, 0, 0.7, 1.07, lit(0xfff2b0, 0.8));
      wheels.push(wheel(add, group, 0.24, 0.16, 0, 0.75));
      for (const x of [-0.55, 0.55]) wheels.push(wheel(add, group, 0.26, 0.18, x, -0.62));
      break;
    }
    case "bus": {
      // A red double-decker: two rows of windows, a destination board.
      body([[-1.6, 0.25], [1.6, 0.25], [1.62, 2.3], [-1.6, 2.3]], 1.5, 0xd23b32, 0.06);
      for (const y of [0.95, 1.8]) for (let i = 0; i < 5; i++) side(add, group, GLASS, 0.48, 0.4, y, -1.25 + i * 0.6, 0.76);
      add(group, new THREE.BoxGeometry(1.2, 0.45, 0.03), GLASS, 0, 1.0, 1.635);
      add(group, new THREE.BoxGeometry(1.2, 0.45, 0.03), GLASS, 0, 1.82, 1.635);
      add(group, new THREE.BoxGeometry(0.9, 0.16, 0.03), 0x1d2023, 0, 2.15, 1.635);
      add(group, new THREE.BoxGeometry(1.54, 0.06, 3.24), 0xfbf8ef, 0, 1.4, 0); // (the band between the decks)
      lights(add, group, 1.64, -1.62, 0.55, 0.5);
      four(add, group, wheels, 0.32, 0.24, 0.62, 1.05, -1.05);
      break;
    }
    case "tractor": {
      // Big wheels behind, small ones in front, a cab frame and a puffing chimney.
      body([[-0.6, 0.55], [1.1, 0.55], [1.15, 1.05], [-0.6, 1.1]], 0.8, 0x4c9a3d);
      add(group, new THREE.BoxGeometry(1.0, 0.1, 0.9), 0x4c9a3d, 0, 2.0, -0.4);
      for (const [x, z] of [[-0.45, 0.05], [0.45, 0.05], [-0.45, -0.85], [0.45, -0.85]]) add(group, new THREE.BoxGeometry(0.06, 0.95, 0.06), DARK, x, 1.5, z);
      add(group, new THREE.BoxGeometry(0.5, 0.35, 0.45), 0x3b4145, 0, 1.25, -0.45);
      add(group, new THREE.CylinderGeometry(0.06, 0.07, 0.6, 8), DARK, 0.2, 1.4, 0.8);
      add(group, new THREE.BoxGeometry(0.2, 0.12, 0.05), 0xfff2b0, 0, 0.9, 1.17, lit(0xfff2b0, 0.8));
      for (const x of [-0.6, 0.6]) {
        wheels.push(wheel(add, group, 0.62, 0.36, x, -0.55, { hub: 0xf2c230 }));
        wheels.push(wheel(add, group, 0.32, 0.22, x * 0.85, 0.8, { hub: 0xf2c230 }));
      }
      break;
    }
    case "sports": {
      // A low wedge coupe with a rear wing.
      body([[-1.3, 0.2], [1.35, 0.2], [1.38, 0.42], [0.4, 0.68], [-0.25, 0.92], [-0.95, 0.85], [-1.3, 0.62]], 1.45, 0xe8643a);
      glass([[-0.7, 0.8], [0.3, 0.7], [-0.25, 0.88], [-0.75, 0.84]], 1.32);
      add(group, new THREE.BoxGeometry(1.45, 0.05, 0.3), DARK, 0, 1.0, -1.15);
      for (const x of [-0.55, 0.55]) add(group, new THREE.BoxGeometry(0.05, 0.25, 0.15), DARK, x, 0.85, -1.15);
      side(add, group, DARK, 0.5, 0.15, 0.4, 0.1, 0.73); // (air intakes)
      lights(add, group, 1.39, -1.31, 0.52, 0.36, 0.1);
      four(add, group, wheels, 0.26, 0.24, 0.6, 0.85, -0.85);
      break;
    }
    case "convertible": {
      // Top down: a sea-green cruiser with chrome and white-wall tyres.
      body([[-1.45, 0.25], [1.45, 0.25], [1.5, 0.62], [0.55, 0.72], [-1.45, 0.72]], 1.42, 0x3fb59b);
      add(group, new THREE.BoxGeometry(1.3, 0.04, 0.04), CHROME, 0, 0.98, 0.5);
      add(group, new THREE.BoxGeometry(1.24, 0.25, 0.03), GLASS, 0, 0.86, 0.48).rotation.x = -0.35;
      for (const z of [0.0, -0.6]) add(group, new THREE.BoxGeometry(1.1, 0.35, 0.4), 0xf4ecd8, 0, 0.85, z); // seats
      side(add, group, CHROME, 2.7, 0.04, 0.5, 0, 0.715);
      lights(add, group, 1.51, -1.46, 0.52, 0.52);
      four(add, group, wheels, 0.27, 0.2, 0.6, 0.9, -0.95, { whitewall: true });
      break;
    }
    case "racer": {
      // An open-wheel racer: a narrow nose, wings front and back, a number, the wheels out in the air.
      body([[-1.3, 0.22], [1.45, 0.22], [1.5, 0.3], [0.5, 0.45], [-0.2, 0.6], [-0.9, 0.55], [-1.3, 0.45]], 0.62, 0x2f6fd8);
      add(group, new THREE.BoxGeometry(1.5, 0.05, 0.28), 0x2f6fd8, 0, 0.2, 1.38); // front wing
      add(group, new THREE.BoxGeometry(1.3, 0.05, 0.32), 0x2f6fd8, 0, 0.95, -1.25); // rear wing
      for (const x of [-0.4, 0.4]) add(group, new THREE.BoxGeometry(0.05, 0.4, 0.2), DARK, x, 0.75, -1.2);
      add(group, new THREE.SphereGeometry(0.17, 14, 10), 0xfbf8ef, 0, 0.72, -0.15); // (the helmet)
      add(group, new THREE.BoxGeometry(0.28, 0.07, 0.05), GLASS, 0, 0.73, 0.0);
      add(group, new THREE.CircleGeometry(0.16, 16), 0xfbf8ef, 0.32, 0.45, 0.55).rotation.y = Math.PI / 2;
      add(group, new THREE.CircleGeometry(0.16, 16), 0xfbf8ef, -0.32, 0.45, 0.55).rotation.y = -Math.PI / 2;
      four(add, group, wheels, 0.3, 0.32, 0.62, 0.95, -0.85);
      break;
    }
    case "muscle": {
      // A long hood, a short tail, and twin racing stripes over the top.
      body([[-1.4, 0.25], [1.5, 0.25], [1.55, 0.62], [0.35, 0.7], [-0.05, 1.05], [-0.95, 1.02], [-1.4, 0.7]], 1.48, 0x1f3f7a);
      glass([[-0.88, 0.97], [0.28, 0.73], [-0.06, 0.99], [-0.86, 0.98]], 1.36);
      for (const x of [-0.14, 0.14]) {
        add(group, new THREE.BoxGeometry(0.12, 0.02, 1.2), 0xfbf8ef, x, 0.69, 0.95);
        add(group, new THREE.BoxGeometry(0.12, 0.02, 0.5), 0xfbf8ef, x, 0.72, -1.15);
      }
      add(group, new THREE.BoxGeometry(0.5, 0.14, 0.4), DARK, 0, 0.75, 0.7); // (the hood scoop)
      lights(add, group, 1.56, -1.41, 0.55, 0.5);
      four(add, group, wheels, 0.3, 0.28, 0.62, 0.95, -0.95);
      break;
    }
    case "hover": {
      // No wheels: a smooth pod on a cushion of light, bobbing a hand's width off the road.
      float = new THREE.Group();
      group.add(float);
      const pod = add(float, new THREE.CapsuleGeometry(0.62, 1.4, 6, 18), 0xe9f3f6);
      pod.rotation.x = Math.PI / 2;
      pod.scale.set(1.1, 0.75, 1);
      pod.position.y = 0.75;
      const dome = add(float, new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), GLASS);
      dome.scale.set(1, 0.8, 1.4);
      dome.position.set(0, 1.0, 0.05);
      add(float, new THREE.CylinderGeometry(0.75, 0.75, 0.04, 24), 0x5ff3ff, 0, 0.3, 0.45, lit(0x5ff3ff, 1.2));
      add(float, new THREE.CylinderGeometry(0.75, 0.75, 0.04, 24), 0x5ff3ff, 0, 0.3, -0.45, lit(0x5ff3ff, 1.2));
      for (const x of [-0.3, 0.3]) add(float, new THREE.BoxGeometry(0.2, 0.08, 0.05), 0xfff2b0, x, 0.72, 1.36, lit(0xfff2b0, 0.9));
      float.userData.base = 0.15;
      break;
    }
    case "limo": {
      // A stretch limousine in gold, with a long row of dark windows.
      body([[-1.9, 0.25], [1.9, 0.25], [1.95, 0.62], [1.1, 0.72], [-1.9, 0.74]], 1.42, 0xd4af37);
      body([[-1.45, 0.7], [0.95, 0.7], [0.65, 1.15], [-1.3, 1.15]], 1.3, 0xd4af37, 0.03);
      glass([[-1.38, 0.74], [0.88, 0.74], [0.61, 1.1], [-1.25, 1.1]], 1.34);
      side(add, group, 0xfbf3d0, 3.5, 0.04, 0.52, 0, 0.715);
      add(group, new THREE.BoxGeometry(0.3, 0.12, 0.3), CHROME, 0, 0.78, 1.7); // (the bonnet ornament's stand)
      lights(add, group, 1.96, -1.91, 0.52, 0.52);
      four(add, group, wheels, 0.28, 0.22, 0.6, 1.3, -1.3, { hub: 0xd4af37 });
      break;
    }
    case "cyber": {
      // All hard angles: a low, faceted dark coupe with a flat roof and a rear wing, glowing neon edges and a glow
      // underneath.
      body([[-1.35, 0.28], [1.4, 0.28], [1.46, 0.44], [0.78, 0.6], [0.22, 0.96], [-0.72, 0.98], [-1.2, 0.8], [-1.35, 0.58]], 1.5, 0x22252b, 0.02);
      glass([[-0.68, 0.64], [0.66, 0.6], [0.2, 0.92], [-0.68, 0.94]], 1.54);
      const neon = (c) => lit(c, 1.4);
      for (const s of [-1, 1]) {
        add(group, new THREE.BoxGeometry(0.03, 0.03, 2.6), 0x3df5ff, s * 0.76, 0.33, 0, neon(0x3df5ff)); // (the sills)
        const e1 = add(group, new THREE.BoxGeometry(0.03, 0.03, 0.68), 0xff3df0, s * 0.76, 0.78, 0.5, neon(0xff3df0)); // (the screen's edges)
        e1.rotation.x = 0.58;
        add(group, new THREE.BoxGeometry(0.03, 0.03, 0.94), 0xff3df0, s * 0.76, 0.97, -0.25, neon(0xff3df0)); // (the roof's)
        add(group, new THREE.BoxGeometry(0.2, 0.08, 0.05), 0xfff2b0, s * 0.48, 0.42, 1.44, neon(0xfff2b0)); // (slit head lights)
        add(group, new THREE.BoxGeometry(0.06, 0.32, 0.05), 0xff3d3d, s * 0.62, 0.66, -1.31, neon(0xff3d3d)); // (upright tail lights)
        add(group, new THREE.BoxGeometry(0.05, 0.22, 0.06), DARK, s * 0.5, 0.9, -1.12); // (the wing's posts)
      }
      add(group, new THREE.BoxGeometry(1.36, 0.04, 0.3), 0x22252b, 0, 1.02, -1.16); // (the rear wing)
      add(group, new THREE.BoxGeometry(1.36, 0.02, 0.03), 0x3df5ff, 0, 1.05, -1.31, neon(0x3df5ff));
      add(group, new THREE.BoxGeometry(1.2, 0.02, 2.3), 0x3df5ff, 0, 0.12, 0, neon(0x3df5ff)); // (the glow underneath)
      four(add, group, wheels, 0.3, 0.26, 0.62, 0.85, -0.85, { hub: 0x3df5ff });
      break;
    }
    case "rocketcar": {
      // A silver dart with fins, and a rocket on the back with its flame going.
      body([[-1.2, 0.25], [1.6, 0.25], [1.7, 0.35], [0.3, 0.7], [-0.4, 0.85], [-1.2, 0.75]], 1.1, 0xc9ced6);
      glass([[-0.55, 0.78], [0.2, 0.68], [-0.35, 0.83]], 0.9);
      for (const s of [-1, 1]) {
        const fin = add(group, new THREE.BoxGeometry(0.04, 0.55, 0.5), 0xd9534a, s * 0.45, 0.95, -1.0);
        fin.rotation.z = s * 0.35;
      }
      add(group, new THREE.CylinderGeometry(0.24, 0.3, 0.7, 14).rotateX(Math.PI / 2), 0x8d9790, 0, 0.6, -1.4);
      flame = add(group, new THREE.ConeGeometry(0.2, 0.6, 12).rotateX(-Math.PI / 2), 0xffa13d, 0, 0.6, -2.0, lit(0xff8a2a, 1.4));
      add(group, new THREE.BoxGeometry(0.5, 0.05, 0.05), 0xfff2b0, 0, 0.32, 1.66, lit(0xfff2b0, 0.9));
      four(add, group, wheels, 0.25, 0.2, 0.55, 1.0, -0.75, { hub: 0xd9534a });
      break;
    }
  }

  // The courier rides hidden inside; the car moves at the moped's speed.
  // (`tag`: how high a name tag or a bubble goes over it, the car's own height and a bit. `reach`: how far the car
  // goes from the point the camera looks at, 0.9 m over the ground, so the see-through cut can leave it whole.)
  const box = new THREE.Box3().setFromObject(group), eye = new THREE.Vector3(0, 0.9, 0);
  const reach = Math.max(...[box.min, box.max].flatMap((a) => [box.min, box.max].flatMap((b) => [box.min, box.max].map((c) => eye.distanceTo(new THREE.Vector3(a.x, b.y, c.z))))));
  const mount = { y: 0, z: 0, pose: "sit", pedal: false, speed: CAR_SPEED, hidden: true, tag: box.max.y + 0.4, reach: reach + 0.1 };
  function update(dt, speed, t) {
    for (const w of wheels) w.rotation.x += dt * speed * 10;
    if (float) float.position.y = float.userData.base + Math.sin(t * 2.2) * 0.05;
    if (flame) flame.scale.set(1, 1, 0.8 + 0.4 * Math.abs(Math.sin(t * 23)) + speed * 0.3);
    if (bounce) bounce.position.y = Math.abs(Math.sin(t * 6)) * 0.04 * Math.min(1, speed);
  }
  return { group, mount, update, riderY: () => 0, key: `car${kind.id}`, car: kind.id };
}
