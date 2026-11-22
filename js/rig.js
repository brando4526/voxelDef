import * as THREE from 'three';
import { VoxelGrid, cachedGeometry, vary, makeRng } from './voxel.js';

export const PX = 0.045; // one "pixel" of a Minecraft-proportioned character

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _j = new THREE.Vector3();
const _end = new THREE.Vector3();
const _bend = new THREE.Vector3();
export const SHOULDER_Y = 11.5 * PX; // shoulder height above the torso pivot (hip)

/** Orients `obj` so its local -Y runs from `from` to `to`, with local +Z facing `pole`. */
function orientSegment(obj, from, to, pole) {
  _d.subVectors(to, from).normalize();
  _y.copy(_d).negate();
  _z.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from);
}

/**
 * Analytic two-bone IK. Places upper segment root->joint and lower joint->target,
 * bending toward `pole`. Returns the reached end position.
 */
export function solveTwoBone(root, target, l1, l2, pole, upper, lower) {
  _t.subVectors(target, root);
  let dist = _t.length();
  const dir = _t.normalize();
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const bend = _bend.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-6) bend.set(0, 0, 1);
  bend.normalize();
  _j.copy(root).addScaledVector(dir, a).addScaledVector(bend, h);
  _end.copy(root).addScaledVector(dir, dist);
  orientSegment(upper, root, _j, bend);
  orientSegment(lower, _j, _end, bend);
  return _end;
}

function segGeo(key, w, h, d, colorFn) {
  return cachedGeometry(key, () => {
    const g = new VoxelGrid();
    g.box(0, 0, 0, w, h, d, colorFn);
    // pivot at top center; segment hangs along -Y
    return g.build(PX, [(-w / 2) * PX, -h * PX, (-d / 2) * PX]);
  });
}

/**
 * Outfit describes the colors used for each body part.
 * { name, skin, hair, shirt, sleeve, pants, shoes, belt, helmet, eyes, tabard }
 */
function buildHead(o) {
  return cachedGeometry(`head-${o.name}`, () => {
    const rng = makeRng(o.name.length * 31);
    const g = new VoxelGrid();
    g.box(0, 0, 0, 8, 8, 8, () => vary(o.skin, 0.04, rng));
    // hair / hood / helmet on top & back
    const capCol = o.helmet ?? o.hair;
    g.box(0, 6, 0, 8, 8, 8, () => vary(capCol, 0.06, rng));
    g.box(0, 2, 0, 8, 8, 2, () => vary(capCol, 0.06, rng));
    g.box(0, 4, 0, 1, 8, 8, () => vary(capCol, 0.06, rng));
    g.box(7, 4, 0, 8, 8, 8, () => vary(capCol, 0.06, rng));
    if (o.helmet) {
      g.box(0, 5, 7, 8, 6, 8, () => vary(o.helmet, 0.05, rng)); // brim
      g.set(3, 2, 7, o.helmet).set(4, 2, 7, o.helmet).set(3, 3, 7, o.helmet).set(4, 3, 7, o.helmet); // nose guard
    }
    if (o.hood) g.box(0, 7, 0, 8, 8, 8, () => vary(o.hood, 0.05, rng));
    // face (front = +z)
    g.set(1, 3, 7, 0xffffff).set(2, 3, 7, o.eyes ?? 0x3a2a7a);
    g.set(5, 3, 7, o.eyes ?? 0x3a2a7a).set(6, 3, 7, 0xffffff);
    g.set(3, 1, 7, 0x8a5a44).set(4, 1, 7, 0x8a5a44);
    if (o.beard) g.box(1, 0, 7, 7, 2, 8, () => vary(o.beard, 0.06, rng)).set(3, 1, 7, 0x6a3a2a).set(4, 1, 7, 0x6a3a2a);
    return g.build(PX, [-4 * PX, 0, -4 * PX]);
  });
}

function buildTorso(o) {
  return cachedGeometry(`torso-${o.name}`, () => {
    const rng = makeRng(o.name.length * 17);
    const g = new VoxelGrid();
    g.box(0, 0, 0, 8, 12, 4, (x, y) => {
      if (y < 1) return vary(o.pants, 0.05, rng);
      if (y === 2 && o.belt) return x === 3 || x === 4 ? 0xc8a040 : vary(o.belt, 0.05, rng);
      if (o.tabard && x >= 2 && x <= 5 && y > 2) return vary(o.tabard, 0.05, rng);
      return vary(o.shirt, 0.06, rng);
    });
    if (o.tabardMark) {
      g.set(3, 8, 3, o.tabardMark).set(4, 8, 3, o.tabardMark).set(3, 7, 3, o.tabardMark).set(4, 7, 3, o.tabardMark);
      g.set(3, 9, 3, o.tabardMark).set(4, 6, 3, o.tabardMark);
    }
    if (o.quiver) {
      g.box(5, 3, -1, 7, 11, 0, () => vary(0x6b4423, 0.06, rng));
      g.set(5, 11, -1, 0xeeeeee).set(6, 12, -1, 0xeeeeee).set(5, 12, -1, 0xd33);
    }
    return g.build(PX, [-4 * PX, 0, -2 * PX]);
  });
}

export class Humanoid {
  constructor(outfit) {
    this.outfit = outfit;
    this.root = new THREE.Group();
    this.parts = [];
    const add = (geo) => {
      const m = new THREE.Mesh(geo, outfit.material);
      m.castShadow = true;
      this.root.add(m);
      this.parts.push(m);
      return m;
    };
    this.torso = add(buildTorso(outfit));
    this.head = add(buildHead(outfit));
    const n = outfit.name;
    const sleeve = (x, y) => (y < 2 && outfit.bareHands !== false ? outfit.skin : outfit.sleeve);
    this.upperArmL = add(segGeo(`ua-${n}`, 4, 6, 4, () => outfit.sleeve));
    this.upperArmR = add(segGeo(`ua-${n}`, 4, 6, 4, () => outfit.sleeve));
    this.lowerArmL = add(segGeo(`la-${n}`, 4, 6, 4, sleeve));
    this.lowerArmR = add(segGeo(`la-${n}`, 4, 6, 4, sleeve));
    this.upperLegL = add(segGeo(`ul-${n}`, 4, 6, 4, () => outfit.pants));
    this.upperLegR = add(segGeo(`ul-${n}`, 4, 6, 4, () => outfit.pants));
    this.lowerLegL = add(segGeo(`ll-${n}`, 4, 6, 4, (x, y) => (y < 2 ? outfit.shoes : outfit.pants)));
    this.lowerLegR = add(segGeo(`ll-${n}`, 4, 6, 4, (x, y) => (y < 2 ? outfit.shoes : outfit.pants)));

    this.L = 6 * PX; // segment length
    this.hipY = 12 * PX;
    this.bob = 0;
    this.lean = 0;
    this.yawBody = 0;
    this.headPitch = 0;
    this.headYaw = 0;

    // IK targets in root space (+Z forward, +X = character's left)
    this.footL = new THREE.Vector3(2 * PX, 0, 0);
    this.footR = new THREE.Vector3(-2 * PX, 0, 0);
    this.handL = new THREE.Vector3(6 * PX, 10 * PX, 0);
    this.handR = new THREE.Vector3(-6 * PX, 10 * PX, 0);
    this.kneePole = new THREE.Vector3(0, 0, 1);
    this.elbowPoleL = new THREE.Vector3(0.3, -0.2, -1);
    this.elbowPoleR = new THREE.Vector3(-0.3, -0.2, -1);

    this.shoulderL = new THREE.Vector3();
    this.shoulderR = new THREE.Vector3();
    this.hipL = new THREE.Vector3();
    this.hipR = new THREE.Vector3();
    this.handLEnd = new THREE.Vector3();
    this.handREnd = new THREE.Vector3();
    this.torsoMatrix = new THREE.Matrix4();
  }

  /** Recompute joint anchors from torso bob/lean, then solve all four limbs. */
  solve() {
    const hipY = this.hipY + this.bob;
    this.torso.position.set(0, hipY, 0);
    this.torso.rotation.set(this.lean, this.yawBody, 0);
    this.torso.updateMatrix();
    this.torsoMatrix.copy(this.torso.matrix);
    this.shoulderL.set(6 * PX, SHOULDER_Y, 0).applyMatrix4(this.torsoMatrix);
    this.shoulderR.set(-6 * PX, SHOULDER_Y, 0).applyMatrix4(this.torsoMatrix);
    this.hipL.set(2 * PX, hipY, 0);
    this.hipR.set(-2 * PX, hipY, 0);
    const neck = _t.set(0, 12 * PX, 0).applyMatrix4(this.torsoMatrix);
    this.head.position.copy(neck);
    this.head.rotation.set(this.lean * 0.5 + this.headPitch, this.yawBody + this.headYaw, 0, 'YXZ');

    const L = this.L;
    solveTwoBone(this.hipL, this.footL, L, L, this.kneePole, this.upperLegL, this.lowerLegL);
    solveTwoBone(this.hipR, this.footR, L, L, this.kneePole, this.upperLegR, this.lowerLegR);
    this.handLEnd.copy(solveTwoBone(this.shoulderL, this.handL, L, L, this.elbowPoleL, this.upperArmL, this.lowerArmL));
    this.handREnd.copy(solveTwoBone(this.shoulderR, this.handR, L, L, this.elbowPoleR, this.upperArmR, this.lowerArmR));
  }

  /** Standard walk cycle: feet follow a lifted ellipse, hands swing opposite. */
  walkPose(phase, stride = 4.5 * PX, lift = 2.5 * PX, armSwing = 1) {
    const sL = Math.sin(phase), cL = Math.cos(phase);
    this.footL.set(2 * PX, Math.max(0, cL) * lift, sL * stride);
    this.footR.set(-2 * PX, Math.max(0, -cL) * lift, -sL * stride);
    // hips drop at full stride so the legs can reach the ground
    this.bob = -0.4 * PX - Math.abs(sL) * 1.3 * PX;
    this.lean = 0.06;
    const sh = SHOULDER_Y + this.hipY + this.bob;
    if (armSwing) {
      this.handL.set(6.6 * PX, sh - 11 * PX, -sL * stride * 1.3 * armSwing + PX);
      this.handR.set(-6.6 * PX, sh - 11 * PX, sL * stride * 1.3 * armSwing + PX);
    }
  }

  idlePose(t) {
    this.footL.set(2.2 * PX, 0, 0.3 * PX);
    this.footR.set(-2.2 * PX, 0, -0.3 * PX);
    this.bob = -0.5 * PX + Math.sin(t * 2) * 0.15 * PX;
    this.lean = 0;
  }
}

/** Sword / shield / bow / TNT props built from voxels. */
export function swordGeometry() {
  return cachedGeometry('sword', () => {
    const g = new VoxelGrid();
    g.box(0, 0, 0, 1, 3, 1, 0x5a3a1e); // grip
    g.box(-1, 3, 0, 2, 4, 1, 0x8a8a8a); // guard
    g.box(0, 4, 0, 1, 13, 1, (x, y) => (y === 12 ? 0xf0f0f0 : 0xd8d8e0)); // blade
    return g.build(PX, [-0.5 * PX, -1.5 * PX, -0.5 * PX]);
  });
}

export function shieldGeometry() {
  return cachedGeometry('shield', () => {
    const g = new VoxelGrid();
    g.box(0, 0, 0, 8, 10, 1, (x, y) => {
      if (x === 0 || x === 7 || y === 0 || y === 9) return 0x6e6e72;
      if ((x === 3 || x === 4) || (y === 5)) return 0xe0c040;
      return 0x8a2a24;
    });
    g.box(0, -1, 0, 8, 0, 1, (x) => (x > 1 && x < 6 ? 0x6e6e72 : null));
    return g.build(PX, [-4 * PX, -5 * PX, 0]);
  });
}

export function tntGeometry() {
  return cachedGeometry('tnt', () => {
    const g = new VoxelGrid();
    g.box(0, 0, 0, 8, 8, 8, (x, y, z) => {
      const side = x === 0 || x === 7 || z === 0 || z === 7;
      if (y === 7) return (x + z) % 3 === 0 ? 0x5a5a5a : 0xb8b0a0;
      if (side && (y === 3 || y === 4)) return (x + z) % 2 ? 0xffffff : 0x202020;
      return y % 2 ? 0xc8322a : 0xb82a24;
    });
    g.box(3, 8, 3, 5, 10, 5, 0x3a3a3a); // fuse
    return g.build(PX * 1.1, [-4 * PX * 1.1, -4 * PX * 1.1, -4 * PX * 1.1]);
  });
}

export function bowGeometry() {
  return cachedGeometry('bow', () => {
    const g = new VoxelGrid();
    // arc in the Y/Z plane: grip at the origin, limbs curving back toward the archer (-Z)
    for (let y = -8; y <= 8; y++) {
      const z = -Math.round(((y * y) / 64) * 3);
      g.set(0, y, z, Math.abs(y) < 2 ? 0x3a2a1a : 0x8a5a2a);
    }
    return g.build(PX, [-0.5 * PX, -0.5 * PX, -0.5 * PX]);
  });
}

export function arrowGeometry(scale = 1) {
  return cachedGeometry(`arrow-${scale}`, () => {
    const g = new VoxelGrid();
    g.box(0, 0, 0, 1, 1, 14, (x, y, z) => (z >= 12 ? 0xb0b0b8 : z < 3 ? 0xf2f2f2 : 0x8a6a3a));
    g.set(1, 0, 1, 0xf2f2f2).set(-1, 0, 1, 0xf2f2f2).set(0, 1, 1, 0xf2f2f2).set(0, -1, 1, 0xf2f2f2);
    g.set(0, 0, 14, 0x9090a0);
    const s = PX * scale;
    return g.build(s, [-0.5 * s, -0.5 * s, -14 * s]);
  });
}
