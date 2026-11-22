import * as THREE from 'three';
import { Humanoid, PX, SHOULDER_Y, swordGeometry, shieldGeometry, tntGeometry } from './rig.js';
import { VoxelGrid, voxelMaterial, cachedGeometry, vary, makeRng } from './voxel.js';

const UP = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
let nextEnemyId = 0;
const RAM_SPACING = 3.8; // rams are ~3.3 blocks long; keep a gap so they never overlap

const OUTFITS = {
  soldier: {
    name: 'soldier', skin: 0xc69c6d, hair: 0x4a3020, helmet: 0x9a9aa4, eyes: 0x2a2a2a,
    shirt: 0x7d7d87, sleeve: 0x7d7d87, pants: 0x4a3a2a, shoes: 0x2f2f2f,
    belt: 0x3a2a1a, tabard: 0x9a2a2a, tabardMark: 0xe0c040,
  },
  shieldSoldier: {
    name: 'shieldSoldier', skin: 0xb88a5e, hair: 0x2a2020, helmet: 0x6c6c78, eyes: 0x2a2a2a, beard: 0x3a2618,
    shirt: 0x5d5d66, sleeve: 0x5d5d66, pants: 0x3a2e24, shoes: 0x262626,
    belt: 0x2a1e14, tabard: 0x7a1e1e, tabardMark: 0x1e1e1e,
  },
  bomber: {
    name: 'bomber', skin: 0xc69c6d, hair: 0x1e1e1e, hood: 0xb02a2a, eyes: 0xd02020,
    shirt: 0x34343a, sleeve: 0x34343a, pants: 0x26262e, shoes: 0x1a1a1a, belt: 0x6b4423,
  },
};

const bgMat = new THREE.SpriteMaterial({ color: 0x1a1a1a, depthTest: false, toneMapped: false });
const fgMats = {
  green: new THREE.SpriteMaterial({ color: 0x44dd44, depthTest: false, toneMapped: false }),
  yellow: new THREE.SpriteMaterial({ color: 0xf0d030, depthTest: false, toneMapped: false }),
  red: new THREE.SpriteMaterial({ color: 0xe03030, depthTest: false, toneMapped: false }),
};

class HealthBar {
  constructor(parent, y, width = 0.8) {
    this.group = new THREE.Group();
    this.group.position.y = y;
    this.width = width;
    this.bg = new THREE.Sprite(bgMat);
    this.bg.scale.set(width + 0.06, 0.14, 1);
    this.bg.renderOrder = 998;
    this.fg = new THREE.Sprite(fgMats.green);
    this.fg.center.set(0, 0.5);
    this.fg.scale.set(width, 0.08, 1);
    this.fg.position.x = -width / 2;
    this.fg.renderOrder = 999;
    this.group.add(this.bg, this.fg);
    this.group.visible = false;
    parent.add(this.group);
  }
  set(frac) {
    this.group.visible = frac < 0.999;
    this.fg.scale.x = Math.max(0.001, this.width * frac);
    this.fg.material = frac > 0.6 ? fgMats.green : frac > 0.3 ? fgMats.yellow : fgMats.red;
  }
}

export class Enemy {
  constructor(game, type, mods, stopOffset) {
    const cfg = game.config.enemies[type];
    this.game = game;
    this.type = type;
    this.cfg = cfg;
    this.maxHp = cfg.hitpoints * (mods.healthMultiplier || 1);
    this.hp = this.maxHp;
    this.speed = cfg.speed * (mods.speedMultiplier || 1);
    this.reward = game.config.game.creditsPerDifficulty[cfg.difficulty] ?? 1;
    this.dist = 0;
    this.offset = (Math.random() - 0.5) * 1.5;
    this.stopAt = game.world.path.length - stopOffset;
    this.state = 'walk';
    this.alive = true;
    this.id = nextEnemyId++;
    this.moving = true;
    this.burn = 0;
    this.burnTick = 0;
    this.hurt = 0;
    this.time = Math.random() * 10;
    this.attackTimer = 0;
    this.height = 1.4;
    this.radius = 0.35;
    this.material = voxelMaterial.clone();
    this.material.emissive = new THREE.Color(0, 0, 0);
    this.object = new THREE.Group();
    this.model = new THREE.Group();
    this.object.add(this.model);
    game.scene.add(this.object);
    this.yaw = Math.PI / 2;
    this.place(0);
  }

  /** Puts the enemy at path distance d, returning world position into `out`. */
  pathPoint(d, out, tan = _tan) {
    this.game.world.path.sample(d, out, tan);
    out.x += tan.z * this.offset;
    out.z += -tan.x * this.offset;
    return out;
  }

  place(dt) {
    this.pathPoint(this.dist, this.object.position, _tan);
    let targetYaw = Math.atan2(_tan.x, _tan.z);
    if (this.state === 'attack') targetYaw = Math.PI / 2; // face the castle gate (+X)
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += dt > 0 ? diff * Math.min(1, dt * 6) : diff;
    this.object.rotation.y = this.yaw;
  }

  aimPoint(out) {
    return out.copy(this.object.position).setY(this.height * 0.55);
  }

  /** Predicted aim point `t` seconds ahead (enemies follow the path at constant speed). */
  predict(t, out) {
    const d = this.state === 'walk' ? Math.min(this.dist + this.speed * t, this.stopAt) : this.dist;
    this.pathPoint(d, out);
    out.y = this.height * 0.55;
    return out;
  }

  get progress() {
    return this.dist + (this.state === 'attack' ? 1000 : 0);
  }

  takeDamage(amount, { fire = false } = {}) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hurt = 0.18;
    if (fire) {
      this.burn = this.game.config.game.fire.durationSeconds;
      this.burnTick = 1;
    }
    this.game.spawnDamageText?.(this, amount, fire);
    if (this.hp <= 0) this.die(true);
  }

  randomBodyPoint(out) {
    return out.set((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 1.0, (Math.random() - 0.5) * 0.3)
      .applyMatrix4(this.object.matrixWorld);
  }

  die(killed) {
    if (!this.alive) return;
    this.alive = false;
    this.healthBar && (this.healthBar.group.visible = false);
    this.object.updateMatrixWorld(true);
    this.game.particles.shatter(this.model, { maxPerMesh: this.debrisPerMesh ?? 30, speed: 1.8 });
    this.game.scene.remove(this.object);
    this.material.dispose();
    this.game.onEnemyDeath(this, killed);
  }

  arrive() {
    this.state = 'attack';
    this.attackTimer = this.cfg.attackInterval * 0.5;
  }

  update(dt) {
    this.time += dt;
    if (this.hurt > 0) this.hurt -= dt;
    if (this.burn > 0) {
      this.burn -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick += 1;
        this.takeDamage(this.game.config.game.fire.damagePerSecond, { fire: false });
        if (!this.alive) return;
      }
      for (let i = 0; i < 2; i++) {
        this.randomBodyPoint(_v);
        this.game.particles.flames(_v.x, _v.y, _v.z, 0.15, 0.11);
      }
    }
    const fl = this.burn > 0 ? 0.08 + Math.random() * 0.1 : 0;
    if (this.hurt > 0) this.material.emissive.setRGB(0.65, 0.05, 0.05);
    else this.material.emissive.setRGB(fl, fl * 0.35, 0);

    if (this.state === 'walk') {
      this.moving = this.canAdvance();
      if (this.moving) this.dist += this.speed * dt;
      if (this.dist >= this.stopAt) {
        this.dist = this.stopAt;
        this.arrive();
      }
    } else if (this.state === 'attack') {
      this.attackUpdate(dt);
    }
    if (!this.alive) return;
    this.place(dt);
    this.animate(dt);
    this.healthBar?.set(this.hp / this.maxHp);
  }

  canAdvance() {
    return true;
  }

  attackUpdate() {}
  animate() {}
}

// ------------------------------------------------------------------ Soldiers

export class Soldier extends Enemy {
  constructor(game, type, mods) {
    super(game, type, mods, 0.6 + Math.random() * 2.4);
    this.shielded = type === 'shieldSoldier';
    const outfit = { ...OUTFITS[type], material: this.material };
    this.rig = new Humanoid(outfit);
    this.model.add(this.rig.root);
    this.sword = new THREE.Mesh(swordGeometry(), this.material);
    this.sword.castShadow = true;
    this.rig.root.add(this.sword);
    if (this.shielded) {
      this.shield = new THREE.Mesh(shieldGeometry(), this.material);
      this.shield.castShadow = true;
      this.rig.root.add(this.shield);
    }
    this.phase = Math.random() * Math.PI * 2;
    this.swordDir = new THREE.Vector3(0, 0.6, 0.8).normalize();
    this.healthBar = new HealthBar(this.object, 1.75);
    this.offset = (Math.random() - 0.5) * 2.0;
  }

  attackUpdate(dt) {
    const prev = this.attackTimer;
    this.attackTimer += dt;
    const I = this.cfg.attackInterval;
    // the blow lands 60% into the swing cycle
    if (prev < I * 0.6 && this.attackTimer >= I * 0.6) {
      this.game.damageCastle(this.cfg.castleDamage, this.object.position, 'sword');
    }
    if (this.attackTimer >= I) this.attackTimer -= I;
  }

  animate(dt) {
    const r = this.rig;
    const sh = r.hipY + SHOULDER_Y;
    let bladeDir = _dir;
    if (this.state === 'walk') {
      this.phase += (dt * this.speed) / (4.5 * PX);
      r.walkPose(this.phase);
      const s = Math.sin(this.phase);
      r.handR.set(-6.2 * PX, sh - 9 * PX + r.bob, 3 * PX + s * 1.5 * PX);
      bladeDir.set(-0.1, 0.75, 0.65);
      if (this.shielded) r.handL.set(3 * PX, sh - 7 * PX + r.bob, 7 * PX);
    } else if (this.state === 'cheer') {
      // victory: weapons raised and pumping
      r.idlePose(this.time);
      const k = Math.sin(this.time * 9 + this.offset * 5);
      r.bob += Math.max(0, k) * 1.5 * PX;
      r.handR.set(-5 * PX, sh + 9 * PX + k * PX, 1.5 * PX);
      r.handL.set(5 * PX, sh + 8 * PX - k * PX, 1.5 * PX);
      bladeDir.set(-0.2, 1, 0.1);
    } else {
      r.idlePose(this.time);
      r.footL.z = 2.5 * PX;
      r.footR.z = -2.5 * PX;
      const t = this.attackTimer / this.cfg.attackInterval;
      const ready = _v.set(-5.5 * PX, sh - 7 * PX, 5 * PX);
      const raised = new THREE.Vector3(-3.5 * PX, sh + 4 * PX, 1 * PX);
      const struck = new THREE.Vector3(-2.5 * PX, sh - 7 * PX, 10 * PX);
      if (t < 0.45) {
        const k = smooth(t / 0.45);
        r.handR.lerpVectors(ready, raised, k);
        bladeDir.set(0, 0.7, 0.7).lerp(_tan.set(0, 0.6, -0.8), k);
        r.lean = -0.08 * k;
      } else if (t < 0.6) {
        const k = (t - 0.45) / 0.15;
        r.handR.lerpVectors(raised, struck, k * k);
        bladeDir.set(0, 0.6, -0.8).lerp(_tan.set(0, -0.35, 1), k);
        r.lean = -0.08 + 0.3 * k;
      } else {
        const k = smooth((t - 0.6) / 0.4);
        r.handR.lerpVectors(struck, ready, k);
        bladeDir.set(0, -0.35, 1).lerp(_tan.set(0, 0.7, 0.7), k);
        r.lean = 0.22 * (1 - k);
      }
      if (this.shielded) r.handL.set(3 * PX, sh - 6 * PX, 7 * PX);
      else r.handL.set(6.6 * PX, sh - 10.5 * PX, 0.5 * PX);
    }
    r.solve();
    this.sword.position.copy(r.handREnd);
    this.sword.quaternion.setFromUnitVectors(UP, bladeDir.normalize());
    if (this.shield) {
      this.shield.position.copy(r.handLEnd).add(_v.set(0, 0, 1.2 * PX));
      this.shield.rotation.set(0, 0, 0);
    }
  }
}

// ------------------------------------------------------------------ Bomber

export class Bomber extends Enemy {
  constructor(game, type, mods) {
    super(game, type, mods, 0.3 + Math.random() * 0.8);
    this.rig = new Humanoid({ ...OUTFITS.bomber, material: this.material });
    this.model.add(this.rig.root);
    this.tnt = new THREE.Mesh(tntGeometry(), this.material);
    this.tnt.castShadow = true;
    this.rig.root.add(this.tnt);
    this.phase = Math.random() * 6;
    this.healthBar = new HealthBar(this.object, 1.75);
    this.offset = (Math.random() - 0.5) * 1.2;
  }

  arrive() {
    this.alive = false;
    const p = this.object.position.clone();
    this.object.updateMatrixWorld(true);
    this.game.particles.shatter(this.model, { maxPerMesh: 25, speed: 6 });
    this.game.scene.remove(this.object);
    this.game.particles.explosion(p.setY(0.6), 2.4, { debrisColor: 0x8a8a8a });
    this.game.audio.play('explosion');
    this.game.damageCastle(this.cfg.castleDamage, p, 'bomb');
    this.material.dispose();
    this.game.onEnemyDeath(this, false);
  }

  die(killed) {
    if (!this.alive) return;
    const p = this.object.position.clone();
    super.die(killed);
    this.game.particles.explosion(p.setY(0.7), 0.7, { debrisColor: 0xc8322a });
    this.game.audio.play('pop');
  }

  animate(dt) {
    const r = this.rig;
    const sh = r.hipY + SHOULDER_Y;
    this.phase += (dt * this.speed) / (4 * PX);
    r.walkPose(this.phase, 4 * PX, 2.8 * PX, 0);
    r.lean = 0.14;
    const bob = Math.sin(this.phase * 2) * 0.4 * PX;
    r.handL.set(4.5 * PX, sh - 6.5 * PX + bob + r.bob, 7 * PX);
    r.handR.set(-4.5 * PX, sh - 6.5 * PX + bob + r.bob, 7 * PX);
    r.solve();
    this.tnt.position.set(0, sh - 6 * PX + bob + r.bob, 8.5 * PX);
    // sparks from the lit fuse
    if (Math.random() < 0.7) {
      this.tnt.updateWorldMatrix(true, false);
      _v.set(0, 6 * PX, 0).applyMatrix4(this.tnt.matrixWorld);
      this.game.particles.glowP({
        x: _v.x, y: _v.y, z: _v.z,
        vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 2,
        color: Math.random() < 0.5 ? 0xffe070 : 0xffffff, size: 0.05, life: 0.3, gravity: 6,
      });
    }
  }
}

// ------------------------------------------------------------------ Battering ram

const S = 0.125;
function ramGeometries() {
  return cachedGeometry('ram', () => {
    const rng = makeRng(5);
    const wood = (c = 0x7a5530) => () => vary(c, 0.08, rng);
    const frame = new VoxelGrid();
    // side beams
    frame.box(1, 3, 0, 3, 5, 26, wood(0x6b4a2b));
    frame.box(11, 3, 0, 13, 5, 26, wood(0x6b4a2b));
    // cross beams
    for (const z of [1, 12, 24]) frame.box(3, 3, z, 11, 4, z + 1, wood(0x5e4126));
    // posts
    for (const [x, z] of [[1, 1], [11, 1], [1, 23], [11, 23], [1, 12], [11, 12]]) frame.box(x, 5, z, x + 2, 13, z + 2, wood(0x6b4a2b));
    // A-frame roof covered in hides
    for (let l = 0; l < 6; l++) {
      const col = l === 5 ? 0x5a4126 : 0x8a7350;
      frame.box(l, 13 + l, -1, l + 1, 14 + l, 27, wood(col));
      frame.box(13 - l, 13 + l, -1, 14 - l, 14 + l, 27, wood(col));
    }
    frame.box(6, 18, -1, 8, 19, 27, wood(0x5a4126));
    // hide straps
    for (const z of [4, 13, 22]) for (let l = 0; l < 6; l++) { frame.set(l, 13 + l, z, 0x3a2a1a); frame.set(13 - l, 13 + l, z, 0x3a2a1a); }
    const frameGeo = frame.build(S, [-7 * S, 0, -13 * S]);

    const log = new VoxelGrid();
    log.box(0, 0, 0, 4, 4, 28, (x, y, z) => {
      if (z >= 25) return vary(0x5a5a62, 0.08, rng); // iron head
      if (z % 7 === 3) return 0x4a4a52; // iron bands
      return vary(0x8a6238, 0.1, rng);
    });
    log.box(1, 1, 28, 3, 3, 29, 0x4a4a52);
    // chains up to the roof
    for (const z of [6, 20]) for (let y = 4; y < 10; y++) log.set(2, y, z, y % 2 ? 0x3a3a3a : 0x5a5a5a);
    const logGeo = log.build(S, [-2 * S, 0, -14 * S]);

    const wheel = new VoxelGrid();
    for (let y = -4; y <= 4; y++)
      for (let z = -4; z <= 4; z++) {
        const d = Math.hypot(y, z);
        if (d <= 4.2) wheel.set(0, y, z, d > 3.2 ? 0x4a3420 : (y === 0 || z === 0) ? 0x6b4a2b : d < 1 ? 0x3a3a3a : null);
      }
    wheel.set(0, 0, 0, 0x3a3a3a);
    const wheelGeo = wheel.build(S, [-0.5 * S, -0.5 * S, -0.5 * S]);
    return { frameGeo, logGeo, wheelGeo };
  });
}

export class Ram extends Enemy {
  constructor(game, type, mods) {
    super(game, type, mods, 1.55);
    this.offset = (Math.random() - 0.5) * 0.4;
    this.height = 1.6;
    this.radius = 0.9;
    this.debrisPerMesh = 70;
    const { frameGeo, logGeo, wheelGeo } = ramGeometries();
    const mk = (g) => {
      const m = new THREE.Mesh(g, this.material);
      m.castShadow = true;
      m.receiveShadow = true;
      this.model.add(m);
      return m;
    };
    this.frame = mk(frameGeo);
    this.log = mk(logGeo);
    this.log.position.set(0, 0.55, 0);
    this.wheels = [];
    for (const [x, z] of [[-0.85, -1.1], [0.85, -1.1], [-0.85, 1.1], [0.85, 1.1]]) {
      const w = mk(wheelGeo);
      w.position.set(x, 0.5, z);
      this.wheels.push(w);
    }
    this.healthBar = new HealthBar(this.object, 2.7, 1.1);
    this.swing = 0;
  }

  randomBodyPoint(out) {
    return out.set((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 1.8, (Math.random() - 0.5) * 3)
      .applyMatrix4(this.object.matrixWorld);
  }

  aimPoint(out) {
    return out.copy(this.object.position).setY(1.0);
  }

  /** Rams queue behind the ram in front instead of driving through it. */
  canAdvance() {
    for (const e of this.game.enemies) {
      if (e === this || !e.alive || e.type !== 'ram') continue;
      const gap = e.dist - this.dist;
      if ((gap > 0 && gap < RAM_SPACING) || (gap === 0 && e.id < this.id)) return false;
    }
    return true;
  }

  attackUpdate(dt) {
    const prev = this.attackTimer;
    this.attackTimer += dt;
    const I = this.cfg.attackInterval;
    if (prev < I * 0.8 && this.attackTimer >= I * 0.8) {
      const hit = this.object.position.clone().add(new THREE.Vector3(1.8, 1.0, 0));
      this.game.particles.dust(hit, 1.2, 0x8a8a8a);
      this.game.damageCastle(this.cfg.castleDamage, this.object.position, 'ram');
      this.game.particles.shake = Math.max(this.game.particles.shake, 0.15);
    }
    if (this.attackTimer >= I) this.attackTimer -= I;
  }

  animate(dt) {
    if (this.state === 'walk') {
      const spin = this.moving ? (dt * this.speed) / 0.5 : 0;
      for (const w of this.wheels) w.rotation.x += spin;
      this.log.position.z = Math.sin(this.time * 2) * 0.05;
      this.model.position.y = Math.abs(Math.sin(this.time * 5)) * 0.02;
    } else {
      // pull back slowly, slam forward
      const t = this.attackTimer / this.cfg.attackInterval;
      const z = t < 0.65 ? -smooth(t / 0.65) * 0.9 : t < 0.8 ? -0.9 + ((t - 0.65) / 0.15) ** 2 * 1.5 : 0.6 * (1 - (t - 0.8) / 0.2);
      this.log.position.z = z;
    }
  }
}

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export function createEnemy(game, type, mods) {
  switch (type) {
    case 'ram': return new Ram(game, type, mods);
    case 'bomber': return new Bomber(game, type, mods);
    default: return new Soldier(game, type, mods);
  }
}
