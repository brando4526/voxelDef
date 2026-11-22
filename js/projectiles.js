import * as THREE from 'three';
import { arrowGeometry } from './rig.js';
import { VoxelGrid, voxelMaterial, cachedGeometry, vary, makeRng } from './voxel.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();

function horiz(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Ballistic launch toward where `enemy` will be. Returns initial velocity, flight time and impact point.
 */
export function solveLaunch(from, enemy, speed, gravity, minTime = 0.15) {
  const end = enemy.aimPoint(new THREE.Vector3());
  let t = Math.max(minTime, horiz(from, end) / speed);
  for (let i = 0; i < 3; i++) {
    enemy.predict(t, end);
    t = Math.max(minTime, horiz(from, end) / speed);
  }
  const v0 = end.clone().sub(from);
  v0.y += 0.5 * gravity * t * t;
  v0.divideScalar(t);
  return { v0, t, end };
}

function boulderGeometry() {
  return cachedGeometry('boulder', () => {
    const rng = makeRng(11);
    const g = new VoxelGrid();
    for (let x = -2; x <= 2; x++)
      for (let y = -2; y <= 2; y++)
        for (let z = -2; z <= 2; z++)
          if (x * x + y * y + z * z <= 5.5) g.set(x, y, z, vary(0x7d7a74, 0.15, rng));
    return g.build(0.09, [-0.045, -0.045, -0.045]);
  });
}

export function boulderMesh() {
  const m = new THREE.Mesh(boulderGeometry(), voxelMaterial);
  m.castShadow = true;
  return m;
}

export class Projectile {
  /**
   * kind: 'arrow' | 'bolt' | 'stone'
   */
  constructor(game, { kind, from, target, damage, fire, splash = 0, speed, gravity, minTime }) {
    this.game = game;
    this.kind = kind;
    this.target = target;
    this.damage = damage;
    this.fire = fire;
    this.splash = splash;
    this.gravity = gravity;
    const { v0, t, end } = solveLaunch(from, target, speed, gravity, minTime);
    this.start = from.clone();
    this.v0 = v0;
    this.duration = t;
    this.end = end;
    this.t = 0;
    this.alive = true;
    this.trailAcc = 0;

    if (kind === 'stone') this.mesh = boulderMesh();
    else {
      this.mesh = new THREE.Mesh(arrowGeometry(kind === 'bolt' ? 2.6 : 1), voxelMaterial);
      this.mesh.castShadow = true;
    }
    if (fire) {
      this.mesh.material = voxelMaterial.clone();
      this.mesh.material.emissive = new THREE.Color(0.7, 0.3, 0.05);
    }
    this.mesh.position.copy(from);
    this.spin = new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.t += dt;
    const t = Math.min(this.t, this.duration);
    const p = this.mesh.position;
    p.copy(this.start).addScaledVector(this.v0, t);
    p.y -= 0.5 * this.gravity * t * t;
    _v.copy(this.v0);
    _v.y -= this.gravity * t;
    if (this.kind === 'stone') {
      this.mesh.rotation.x += this.spin.x * dt;
      this.mesh.rotation.y += this.spin.y * dt;
    } else {
      this.mesh.quaternion.setFromUnitVectors(FORWARD, _v.normalize());
    }

    // trails
    const P = this.game.particles;
    this.trailAcc += dt;
    const every = this.kind === 'stone' ? 0.02 : 0.012;
    while (this.trailAcc > every) {
      this.trailAcc -= every;
      if (this.fire) {
        P.flames(p.x, p.y, p.z, this.kind === 'stone' ? 0.3 : 0.08, this.kind === 'stone' ? 0.2 : 0.09);
      }
      if (this.kind === 'stone') P.trail(p, { color: 0x8a8a8a, size: 0.16, life: 0.5, glow: false });
      else P.trail(p, { color: this.fire ? 0xffa040 : this.kind === 'bolt' ? 0xd0e0ff : 0xf0f0f0, size: this.kind === 'bolt' ? 0.08 : 0.05, life: this.kind === 'bolt' ? 0.4 : 0.28 });
    }

    if (this.t >= this.duration) this.impact();
  }

  impact() {
    this.alive = false;
    this.game.scene.remove(this.mesh);
    if (this.fire) this.mesh.material.dispose();
    const P = this.game.particles;
    const end = this.mesh.position;
    if (this.kind === 'stone') {
      const ground = end.clone().setY(0.1);
      P.dust(ground, 1.6, 0x8a7a5a);
      for (let i = 0; i < 14; i++) {
        _a.set((Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5);
        P.debris(ground.x, 0.3, ground.z, vary(0x7d7a74, 0.15), 0.09, _a, 1.8);
      }
      if (this.fire) P.explosion(ground, 0.9, { debrisColor: 0x5a4a3a });
      this.game.audio.play('thud');
      for (const e of this.game.enemies) {
        if (!e.alive) continue;
        const d = horiz(e.object.position, end);
        if (d <= this.splash + e.radius * 0.5) e.takeDamage(this.damage, { fire: this.fire });
      }
      // splash ring shockwave
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        P.glowP({
          x: ground.x + Math.cos(a) * 0.3, y: 0.15, z: ground.z + Math.sin(a) * 0.3,
          vx: Math.cos(a) * this.splash * 3, vy: 0, vz: Math.sin(a) * this.splash * 3,
          color: this.fire ? 0xff9a30 : 0xbfb49a, size: 0.12, life: 0.3, drag: 3,
        });
      }
      return;
    }
    const tgt = this.target;
    if (tgt.alive) {
      tgt.aimPoint(_a);
      if (_a.distanceTo(end) < 0.9 + tgt.radius) {
        tgt.takeDamage(this.damage, { fire: this.fire });
        this.game.audio.play(this.kind === 'bolt' ? 'thunk' : 'hit');
        for (let i = 0; i < 6; i++) {
          P.glowP({
            x: end.x, y: end.y, z: end.z,
            vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3,
            color: this.fire ? 0xff8030 : 0xffffff, size: 0.06, life: 0.25, gravity: 8,
          });
        }
        return;
      }
    }
    // miss: puff of dirt where it lands
    P.dust(end.clone().setY(0.05), 0.4);
  }
}
