import * as THREE from 'three';
import { Humanoid, PX, SHOULDER_Y, bowGeometry, arrowGeometry } from './rig.js';
import { VoxelGrid, voxelMaterial, cachedGeometry, vary, makeRng } from './voxel.js';
import { Projectile, solveLaunch, boulderMesh } from './projectiles.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

const ARCHER_OUTFIT = {
  name: 'archer', skin: 0xd8aa7a, hair: 0x6a4a2a, hood: 0x3e7a2a, eyes: 0x2a5a2a,
  shirt: 0x4e8a32, sleeve: 0x6b4a2b, pants: 0x5a4026, shoes: 0x2f2418,
  belt: 0x3a2a1a, tabard: 0x3a6a24, quiver: true, material: voxelMaterial,
};

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function angleLerp(a, b, k) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

function brazierGeometry() {
  return cachedGeometry('brazier', () => {
    const g = new VoxelGrid();
    g.box(1, 0, 1, 3, 3, 3, 0x3a3a3a);
    g.box(0, 3, 0, 4, 5, 4, (x, y, z) => (x === 0 || x === 3 || z === 0 || z === 3 ? 0x4a4a4e : y === 4 ? 0xff7a20 : 0x2a2020));
    return g.build(0.125, [-0.25, 0, -0.25]);
  });
}

export class Defense {
  constructor(game, slot, type) {
    this.game = game;
    this.slot = slot;
    this.type = type;
    this.cfg = game.config.defenses[type];
    this.levels = {};
    for (const k of Object.keys(this.cfg.upgrades)) this.levels[k] = 0;
    this.group = new THREE.Group();
    this.group.position.copy(slot.top);
    game.scene.add(this.group);
    this.spent = this.cfg.cost;
    this.brazier = null;
    this.time = Math.random() * 10;
  }

  get damage() {
    const up = this.cfg.upgrades.damage;
    return this.cfg.damage * (1 + (up?.damageBonus ?? 0.5) * (this.levels.damage || 0));
  }
  get interval() {
    const up = this.cfg.upgrades.speed;
    return this.cfg.fireInterval * Math.pow(up?.intervalMultiplier ?? 0.85, this.levels.speed || 0);
  }
  get range() {
    return this.cfg.range;
  }
  get splash() {
    const up = this.cfg.upgrades.area;
    return (this.cfg.splashRadius || 0) * (1 + (up?.radiusBonus ?? 0) * (this.levels.area || 0));
  }
  get fire() {
    return (this.levels.fire || 0) > 0;
  }

  canUpgrade(key) {
    const up = this.cfg.upgrades[key];
    return up && this.levels[key] < up.maxLevel;
  }

  upgrade(key) {
    if (!this.canUpgrade(key)) return false;
    this.levels[key]++;
    this.spent += this.cfg.upgrades[key].cost;
    if (key === 'fire') this.addBrazier();
    this.onUpgrade(key);
    return true;
  }

  onUpgrade() {}

  addBrazier() {
    if (this.brazier) return;
    this.brazier = new THREE.Mesh(brazierGeometry(), voxelMaterial);
    this.brazier.castShadow = true;
    this.brazier.position.set(1.25, 0, -1.25);
    this.group.add(this.brazier);
  }

  /** Enemy furthest along the path within range (horizontal) of the tower. */
  findTarget(minRange = 0) {
    let best = null;
    let bestP = -Infinity;
    const o = this.slot.top;
    const r2 = this.range * this.range;
    const m2 = minRange * minRange;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const p = e.object.position;
      const d2 = (p.x - o.x) ** 2 + (p.z - o.z) ** 2;
      if (d2 > r2 || d2 < m2) continue;
      if (e.progress > bestP) {
        bestP = e.progress;
        best = e;
      }
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    if (this.brazier && Math.random() < 0.6) {
      this.brazier.getWorldPosition(_v);
      this.game.particles.flames(_v.x, _v.y + 0.65, _v.z, 0.25, 0.1);
    }
  }

  stats() {
    const s = [
      { k: 'Damage', v: this.damage.toFixed(0) },
      { k: 'Fire interval', v: `${this.interval.toFixed(2)}s` },
      { k: 'Range', v: this.range.toFixed(0) },
    ];
    if (this.cfg.splashRadius) s.push({ k: 'Splash radius', v: this.splash.toFixed(1) });
    s.push({ k: 'Fire damage', v: this.fire ? 'Yes' : 'No' });
    return s;
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}

// ------------------------------------------------------------------ Archers

const ARCHER_SPOTS = [
  [0, 0], [-0.95, 0.55], [0.95, -0.55], [-0.55, -0.95], [0.55, 0.95],
];

class Archer {
  constructor(post, index) {
    this.post = post;
    this.rig = new Humanoid(ARCHER_OUTFIT);
    const [x, z] = ARCHER_SPOTS[index];
    this.rig.root.position.set(x, 0, z);
    this.rig.root.rotation.y = Math.random() * 6;
    post.group.add(this.rig.root);
    this.bow = new THREE.Mesh(bowGeometry(), voxelMaterial);
    this.bow.castShadow = true;
    this.rig.root.add(this.bow);
    this.arrow = new THREE.Mesh(arrowGeometry(1), voxelMaterial);
    this.rig.root.add(this.arrow);
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xeeeeee }));
    this.rig.root.add(this.string);
    this.cooldown = Math.random() * post.interval;
    this.aimW = 0;
    this.draw = 0;
    this.release = 0;
    this.aimLocal = new THREE.Vector3(0, 0, 1);
    this.target = null;
    this.time = Math.random() * 10;
  }

  update(dt) {
    const post = this.post;
    const r = this.rig;
    this.time += dt;
    const target = post.findTarget();
    this.target = target;
    this.cooldown -= dt;
    const root = r.root;
    const worldPos = _w.copy(root.position).add(post.group.position);
    const bowFrom = _v.copy(worldPos).setY(worldPos.y + r.hipY + SHOULDER_Y);
    let launch = null;
    if (target) {
      launch = solveLaunch(bowFrom, target, post.cfg.projectileSpeed, post.cfg.projectileGravity);
      const yaw = Math.atan2(launch.v0.x, launch.v0.z);
      root.rotation.y = angleLerp(root.rotation.y, yaw, Math.min(1, dt * 10));
      // aim direction in the archer's local space (yaw removed)
      const hl = Math.hypot(launch.v0.x, launch.v0.z);
      const pitch = Math.atan2(launch.v0.y, hl);
      const yawErr = Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y));
      this.aimLocal.set(Math.sin(yawErr) * Math.cos(pitch), Math.sin(pitch), Math.cos(yawErr) * Math.cos(pitch));
      this.aimW = Math.min(1, this.aimW + dt * 4);
      const window = post.interval * 0.7;
      this.draw = smooth(1 - Math.max(0, this.cooldown) / window);
      if (this.cooldown <= 0 && this.aimW > 0.9 && Math.abs(yawErr) < 0.25) {
        this.fire();
      }
    } else {
      this.aimW = Math.max(0, this.aimW - dt * 2);
      this.draw = Math.max(0, this.draw - dt * 3);
      if (this.cooldown < 0) this.cooldown = 0;
      this.aimLocal.lerp(_x.set(0, -0.2, 1).normalize(), dt * 2);
    }
    this.release = Math.max(0, this.release - dt * 4);
    this.pose();
  }

  fire() {
    const post = this.post;
    this.cooldown = post.interval * (0.92 + Math.random() * 0.16);
    this.draw = 0;
    this.release = 1;
    this.rig.root.updateMatrixWorld(true);
    const from = this.bow.getWorldPosition(new THREE.Vector3());
    post.game.projectiles.push(new Projectile(post.game, {
      kind: 'arrow', from, target: this.target, damage: post.damage, fire: post.fire,
      speed: post.cfg.projectileSpeed, gravity: post.cfg.projectileGravity,
    }));
    post.game.audio.play('bow');
  }

  pose() {
    const r = this.rig;
    const w = this.aimW;
    r.idlePose(this.time);
    r.footL.set(2.5 * PX, 0, 2 * PX);
    r.footR.set(-2.5 * PX, 0, -2.2 * PX);
    const sh = r.hipY + SHOULDER_Y + r.bob;
    const aim = this.aimLocal;
    const reach = 11.2 * PX;
    // bow hand: extended along aim from a point between the shoulders and the left shoulder
    const bowAim = _x.set(3 * PX, sh, 0).addScaledVector(aim, reach);
    const bowRest = _y.set(6.6 * PX, sh - 11 * PX, 1 * PX);
    r.handL.lerpVectors(bowRest, bowAim, w);
    // draw hand: from the string at the bow back to the cheek
    const nock = new THREE.Vector3().copy(r.handL).addScaledVector(aim, -1.5 * PX);
    const cheek = new THREE.Vector3(-1.2 * PX, sh + 1.5 * PX, 2.5 * PX).addScaledVector(aim, 1 * PX);
    const drawPos = nock.clone().lerp(cheek, this.draw);
    const rest = new THREE.Vector3(-6.6 * PX, sh - 11 * PX, 1 * PX);
    r.handR.lerpVectors(rest, drawPos, w);
    if (this.release > 0) r.handR.addScaledVector(aim, -this.release * 1.5 * PX).y += this.release * PX;
    // elbows point backward at rest and flare outward while drawing the bow
    r.elbowPoleR.set(-0.15, 0, -1).lerp(_v.set(-1, 0.25, -0.7), w);
    r.elbowPoleL.set(0.15, 0, -1).lerp(_v.set(1, -0.4, -0.3), w);
    r.headPitch = -Math.asin(Math.max(-0.9, Math.min(0.9, aim.y))) * 0.6 * w;
    r.lean = -0.04 * w;
    r.solve();

    // bow at the left hand, oriented to the aim (blend with a lowered rest orientation)
    const bowDir = _v.set(0, -0.5, 0.6).normalize().lerp(aim, w).normalize();
    const up = _x.copy(UP).addScaledVector(bowDir, -bowDir.y).normalize();
    const side = _y.crossVectors(up, bowDir).normalize();
    _m.makeBasis(side, up, bowDir);
    this.bow.quaternion.setFromRotationMatrix(_m);
    this.bow.position.copy(r.handLEnd);
    this.bow.updateMatrix();

    const pts = this.string.geometry.attributes.position;
    const top = new THREE.Vector3(0, 8.5 * PX, -3 * PX).applyMatrix4(this.bow.matrix);
    const bot = new THREE.Vector3(0, -8.5 * PX, -3 * PX).applyMatrix4(this.bow.matrix);
    const mid = top.clone().lerp(bot, 0.5);
    const pull = w * this.draw;
    const nockPt = mid.clone().lerp(r.handREnd, pull);
    pts.setXYZ(0, top.x, top.y, top.z);
    pts.setXYZ(1, nockPt.x, nockPt.y, nockPt.z);
    pts.setXYZ(2, bot.x, bot.y, bot.z);
    pts.needsUpdate = true;
    this.string.geometry.computeBoundingSphere();

    this.arrow.visible = !!this.target && w > 0.6 && pull > 0.08;
    if (this.arrow.visible) {
      this.arrow.position.copy(nockPt).addScaledVector(bowDir, 14 * PX);
      this.arrow.quaternion.setFromUnitVectors(FORWARD, bowDir);
    }
  }

  dispose() {
    this.post.group.remove(this.rig.root);
  }
}

export class ArcherPost extends Defense {
  constructor(game, slot) {
    super(game, slot, 'archer');
    this.archers = [];
    const n = this.cfg.startingUnits ?? 1;
    for (let i = 0; i < n; i++) this.archers.push(new Archer(this, i));
  }

  get count() {
    return this.archers.length;
  }

  onUpgrade(key) {
    if (key === 'extraArcher' && this.archers.length < ARCHER_SPOTS.length) {
      this.archers.push(new Archer(this, this.archers.length));
    }
  }

  addBrazier() {
    super.addBrazier();
    this.brazier.position.set(1.3, 0, -1.3);
  }

  update(dt) {
    super.update(dt);
    for (const a of this.archers) a.update(dt);
  }

  stats() {
    const s = super.stats();
    s.unshift({ k: 'Archers', v: `${this.archers.length} / ${ARCHER_SPOTS.length}` });
    s[1].v += ' each';
    return s;
  }
}

// ------------------------------------------------------------------ Ballista

const S = 0.125;
function ballistaGeometries() {
  return cachedGeometry('ballista', () => {
    const rng = makeRng(3);
    const wood = (c) => () => vary(c, 0.07, rng);
    const base = new VoxelGrid();
    base.box(-2, 0, -2, 2, 7, 2, wood(0x6b4a2b));
    base.box(-7, 0, -1, 7, 2, 1, wood(0x5e4126));
    base.box(-1, 0, -7, 1, 2, 7, wood(0x5e4126));
    base.box(-3, 6, -3, 3, 7, 3, 0x4a4a52);
    const baseGeo = base.build(S, [0, 0, 0]);

    const top = new VoxelGrid();
    top.box(-2, 0, -10, 2, 2, 12, wood(0x7a5530)); // stock
    top.box(-1, 2, -8, 1, 3, 12, wood(0x5e4126)); // groove rails
    top.box(-3, -2, -1, 3, 0, 3, 0x4a4a52); // turntable mount
    // bow arms with a slight backward sweep
    for (let x = -12; x <= 12; x++) {
      const back = Math.round((x * x) / 40);
      top.box(x, 1, 9 - back, x + 1, 3, 10 - back, Math.abs(x) < 3 ? 0x4a4a52 : vary(0x8a5a2a, 0.06, rng));
    }
    // winch at the back
    top.box(-4, 0, -11, 4, 3, -9, 0x4a4a52);
    top.box(-5, 1, -10, -4, 2, -9, 0x5e4126).box(4, 1, -10, 5, 2, -9, 0x5e4126);
    const topGeo = top.build(S, [0, 0, 0]);
    return { baseGeo, topGeo };
  });
}

export class Ballista extends Defense {
  constructor(game, slot) {
    super(game, slot, 'ballista');
    const { baseGeo, topGeo } = ballistaGeometries();
    const base = new THREE.Mesh(baseGeo, voxelMaterial);
    base.castShadow = true;
    this.group.add(base);
    this.yawGroup = new THREE.Group();
    this.yawGroup.position.y = 7 * S + 2 * S;
    this.group.add(this.yawGroup);
    this.pitchGroup = new THREE.Group();
    this.yawGroup.add(this.pitchGroup);
    this.top = new THREE.Mesh(topGeo, voxelMaterial);
    this.top.castShadow = true;
    this.pitchGroup.add(this.top);
    this.bolt = new THREE.Mesh(arrowGeometry(2.6), voxelMaterial);
    this.pitchGroup.add(this.bolt);
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xdddddd }));
    this.pitchGroup.add(this.string);
    this.cooldown = this.interval * 0.5;
    this.recoil = 0;
    this.yawGroup.rotation.y = Math.random() * 6;
  }

  update(dt) {
    super.update(dt);
    this.cooldown -= dt;
    const target = this.findTarget();
    const muzzle = this.yawGroup.getWorldPosition(_w);
    muzzle.y += 3 * S;
    let aligned = false;
    if (target) {
      const launch = solveLaunch(muzzle, target, this.cfg.projectileSpeed, this.cfg.projectileGravity);
      const yaw = Math.atan2(launch.v0.x, launch.v0.z);
      this.yawGroup.rotation.y = angleLerp(this.yawGroup.rotation.y, yaw, Math.min(1, dt * 5));
      const pitch = Math.atan2(launch.v0.y, Math.hypot(launch.v0.x, launch.v0.z));
      this.pitchGroup.rotation.x = -pitch;
      const err = Math.atan2(Math.sin(yaw - this.yawGroup.rotation.y), Math.cos(yaw - this.yawGroup.rotation.y));
      aligned = Math.abs(err) < 0.08;
      if (this.cooldown <= 0 && aligned) this.fire(target);
    } else if (this.cooldown < 0) this.cooldown = 0;

    this.recoil = Math.max(0, this.recoil - dt * 3);
    this.top.position.z = -this.recoil * 0.25;
    // string: pulled back as the winch reloads
    const loaded = 1 - Math.max(0, this.cooldown) / this.interval;
    const pull = smooth(loaded / 0.6);
    const recoilZ = this.top.position.z;
    const stringZ = 9 * S - 15 * S * pull + recoilZ;
    const tipZ = 6 * S + recoilZ;
    const pts = this.string.geometry.attributes.position;
    pts.setXYZ(0, -12.5 * S, 2 * S, tipZ);
    pts.setXYZ(1, 0, 2.5 * S, stringZ);
    pts.setXYZ(2, 12.5 * S, 2 * S, tipZ);
    pts.needsUpdate = true;
    this.string.geometry.computeBoundingSphere();
    this.bolt.visible = pull > 0.35;
    this.bolt.position.set(0, 3 * S, stringZ + 2.6 * 14 * PX);
  }

  fire(target) {
    this.cooldown = this.interval;
    this.recoil = 1;
    this.group.updateMatrixWorld(true);
    const from = this.bolt.getWorldPosition(new THREE.Vector3());
    this.game.projectiles.push(new Projectile(this.game, {
      kind: 'bolt', from, target, damage: this.damage, fire: this.fire,
      speed: this.cfg.projectileSpeed, gravity: this.cfg.projectileGravity,
    }));
    this.game.audio.play('ballista');
  }
}

// ------------------------------------------------------------------ Catapult

function catapultGeometries() {
  return cachedGeometry('catapult', () => {
    const rng = makeRng(8);
    const wood = (c) => () => vary(c, 0.07, rng);
    const base = new VoxelGrid();
    base.box(-7, 2, -10, -5, 4, 10, wood(0x6b4a2b));
    base.box(5, 2, -10, 7, 4, 10, wood(0x6b4a2b));
    for (const z of [-9, -2, 8]) base.box(-5, 2, z, 5, 3, z + 2, wood(0x5e4126));
    // uprights with a padded crossbar (the arm stops here)
    base.box(-7, 4, 1, -5, 15, 3, wood(0x7a5530));
    base.box(5, 4, 1, 7, 15, 3, wood(0x7a5530));
    base.box(-5, 13, 1, 5, 15, 3, wood(0x5e4126));
    base.box(-4, 13, 3, 4, 15, 4, 0x8a2a24);
    // braces
    for (let i = 0; i < 7; i++) {
      base.set(-6, 4 + i, -6 + i, 0x5e4126).set(5, 4 + i, -6 + i, 0x5e4126);
    }
    // torsion bundle + axle
    base.box(-5, 4, -4, 5, 6, -2, 0x8a7a5a);
    // wheels
    for (const z of [-8, 7])
      for (const x of [-8, 7])
        for (let y = 0; y < 4; y++) for (let zz = 0; zz < 4; zz++)
          if (!((y === 0 || y === 3) && (zz === 0 || zz === 3))) base.set(x, y, z + zz - 1, (y + zz) % 3 === 0 ? 0x3a3a3a : 0x4a3420);
    const baseGeo = base.build(S, [0, 0, 0]);

    const arm = new VoxelGrid();
    arm.box(-1, 0, -1, 1, 20, 1, wood(0x8a6238));
    // bucket: opens toward +Z so it faces up while the arm is cocked back
    arm.box(-3, 17, -1, 3, 22, 1, 0x5e4126);
    arm.box(-3, 17, 1, -2, 22, 3, 0x5e4126).box(2, 17, 1, 3, 22, 3, 0x5e4126);
    arm.box(-2, 17, 1, 2, 18, 3, 0x4e3620).box(-2, 21, 1, 2, 22, 3, 0x4e3620);
    const armGeo = arm.build(S, [0, 0, 0]);
    return { baseGeo, armGeo };
  });
}

const COCKED = -1.35;
const RELEASED = 0.32;

export class Catapult extends Defense {
  constructor(game, slot) {
    super(game, slot, 'catapult');
    const { baseGeo, armGeo } = catapultGeometries();
    this.yawGroup = new THREE.Group();
    this.group.add(this.yawGroup);
    const base = new THREE.Mesh(baseGeo, voxelMaterial);
    base.castShadow = true;
    this.yawGroup.add(base);
    this.armPivot = new THREE.Group();
    this.armPivot.position.set(0, 5 * S, -3 * S);
    this.yawGroup.add(this.armPivot);
    const arm = new THREE.Mesh(armGeo, voxelMaterial);
    arm.castShadow = true;
    this.armPivot.add(arm);
    this.stone = boulderMesh();
    this.stone.position.set(0, 19.5 * S, 2 * S);
    this.armPivot.add(this.stone);
    this.armPivot.rotation.x = COCKED;
    this.cooldown = this.interval * 0.5;
    this.throwT = -1;
    this.pendingTarget = null;
    this.yawGroup.rotation.y = Math.random() * 6;
  }

  update(dt) {
    super.update(dt);
    this.cooldown -= dt;
    const target = this.findTarget(this.cfg.minRange || 0);
    if (target) {
      const o = this.slot.top;
      const p = target.object.position;
      const yaw = Math.atan2(p.x - o.x, p.z - o.z);
      this.yawGroup.rotation.y = angleLerp(this.yawGroup.rotation.y, yaw, Math.min(1, dt * 3));
      const err = Math.atan2(Math.sin(yaw - this.yawGroup.rotation.y), Math.cos(yaw - this.yawGroup.rotation.y));
      if (this.cooldown <= 0 && this.throwT < 0 && Math.abs(err) < 0.12) {
        this.throwT = 0;
        this.pendingTarget = target;
        this.game.audio.play('catapult');
      }
    } else if (this.cooldown < 0) this.cooldown = 0;

    if (this.throwT >= 0) {
      const prev = this.throwT;
      this.throwT += dt / 0.28;
      const k = Math.min(1, this.throwT);
      this.armPivot.rotation.x = COCKED + (RELEASED - COCKED) * k * k;
      if (prev < 0.78 && this.throwT >= 0.78) this.launch();
      if (this.throwT >= 1) {
        this.throwT = -1;
        this.cooldown = this.interval;
      }
    } else {
      // winch the arm back down while reloading
      const reload = 1 - Math.max(0, this.cooldown) / this.interval;
      const k = smooth(reload / 0.7);
      this.armPivot.rotation.x = RELEASED + (COCKED - RELEASED) * k;
      this.stone.visible = k > 0.95;
      if (this.fire && this.stone.visible && Math.random() < 0.5) {
        this.stone.getWorldPosition(_v);
        this.game.particles.flames(_v.x, _v.y + 0.1, _v.z, 0.2, 0.12);
      }
    }
  }

  launch() {
    const target = this.pendingTarget?.alive ? this.pendingTarget : this.findTarget(this.cfg.minRange || 0);
    this.stone.visible = false;
    if (!target) return;
    this.group.updateMatrixWorld(true);
    const from = this.stone.getWorldPosition(new THREE.Vector3());
    this.game.projectiles.push(new Projectile(this.game, {
      kind: 'stone', from, target, damage: this.damage, fire: this.fire, splash: this.splash,
      speed: this.cfg.projectileSpeed, gravity: this.cfg.projectileGravity, minTime: 0.9,
    }));
  }
}

export function createDefense(game, slot, type) {
  if (type === 'archer') return new ArcherPost(game, slot);
  if (type === 'ballista') return new Ballista(game, slot);
  return new Catapult(game, slot);
}
