import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** Sparse height map so settling debris stacks into piles instead of all lying at y=0. */
class PileMap {
  constructor(cell = 0.14) {
    this.cell = cell;
    this.map = new Map();
  }
  key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  get(k) {
    return this.map.get(k) || 0;
  }
  add(k, h) {
    const v = this.get(k) + h;
    if (v <= 0.0001) this.map.delete(k);
    else this.map.set(k, v);
  }
}

class Pool {
  constructor(scene, capacity, material, { castShadow = false } = {}) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    scene.add(this.mesh);
    this.items = [];
  }

  spawn(p) {
    if (this.items.length >= this.capacity) {
      // recycle the oldest particle
      const old = this.items.shift();
      old.dead = true;
      if (old.pileKey) this.pile?.add(old.pileKey, -old.pileH);
    }
    this.items.push(p);
    return p;
  }
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.solid = new Pool(scene, 9000, new THREE.MeshLambertMaterial({ color: 0xffffff }), { castShadow: true });
    this.glow = new Pool(
      scene,
      5000,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.pile = new PileMap();
    this.solid.pile = this.pile;
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 14, 1.6);
      l.userData.life = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.shake = 0;
  }

  clear() {
    for (const pool of [this.solid, this.glow]) {
      pool.items.length = 0;
      pool.mesh.count = 0;
    }
    this.pile.map.clear();
    for (const l of this.lights) l.intensity = 0;
  }

  /** Generic particle factory. */
  make(o) {
    return {
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      rx: o.rx ?? Math.random() * 6, ry: o.ry ?? Math.random() * 6, rz: o.rz ?? Math.random() * 6,
      avx: o.avx ?? 0, avy: o.avy ?? 0, avz: o.avz ?? 0,
      size: o.size || 0.1,
      life: 0,
      maxLife: o.life || 1,
      delay: o.delay || 0,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      ground: o.ground ?? false,
      settled: false,
      shrinkFrom: o.shrinkFrom ?? 0,
      grow: o.grow ?? 0,
      fade: o.fade ?? false,
      r: o.r, g: o.g, b: o.b,
      pileKey: null,
      pileH: 0,
    };
  }

  debris(x, y, z, color, size, vel, life = 3.5, delay = 0) {
    _c.setHex(color);
    return this.solid.spawn(this.make({
      x, y, z, vx: vel.x, vy: vel.y, vz: vel.z,
      avx: (Math.random() - 0.5) * 12, avy: (Math.random() - 0.5) * 6, avz: (Math.random() - 0.5) * 12,
      size, life, delay, gravity: 22, drag: 0.4, ground: true, shrinkFrom: 0.75,
      r: _c.r, g: _c.g, b: _c.b,
    }));
  }

  glowP(o) {
    _c.setHex(o.color);
    return this.glow.spawn(this.make({ ...o, r: _c.r, g: _c.g, b: _c.b, fade: true, shrinkFrom: o.shrinkFrom ?? 0.2 }));
  }

  smoke(x, y, z, { size = 0.35, life = 1.6, color = 0x6a6a6a, vy = 1.4, spread = 0.4 } = {}) {
    _c.setHex(color);
    return this.solid.spawn(this.make({
      x: x + (Math.random() - 0.5) * spread, y, z: z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.6, vy: vy * (0.6 + Math.random() * 0.6), vz: (Math.random() - 0.5) * 0.6,
      avx: Math.random() * 2, avy: Math.random() * 2,
      size, life, drag: 1.2, grow: 0.8, shrinkFrom: 0.3,
      r: _c.r, g: _c.g, b: _c.b,
    }));
  }

  /** Burst every surface voxel of meshes in `object` into falling cubes that pile up and vanish. */
  shatter(object, { maxPerMesh = 40, speed = 2.2, life = 3.6, sizeMul = 1.15, stride = 1, delayByHeight = 0, center = null } = {}) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const ctr = center || box.getCenter(new THREE.Vector3());
    object.traverse((m) => {
      if (!m.isMesh || !m.visible || !m.geometry?.userData?.voxels) return;
      const vox = m.geometry.userData.voxels;
      const step = Math.max(stride, Math.ceil(vox.length / maxPerMesh));
      m.getWorldScale(_s);
      const vsize = m.geometry.userData.voxelSize * _s.x * sizeMul;
      for (let i = (Math.random() * step) | 0; i < vox.length; i += step) {
        const v = vox[i];
        _p.set(v.x, v.y, v.z).applyMatrix4(m.matrixWorld);
        _v.subVectors(_p, ctr);
        _v.y = Math.max(0, _v.y) * 0.3;
        _v.normalize().multiplyScalar(speed * (0.3 + Math.random()));
        _v.y += Math.random() * speed * 0.8;
        const delay = delayByHeight ? Math.max(0, (box.max.y - _p.y) * delayByHeight * (0.6 + Math.random() * 0.8)) : 0;
        this.debris(_p.x, _p.y, _p.z, v.color, vsize * Math.max(1, step > 4 ? 1.4 : 1), _v, life + Math.random() * 1.2 + delay, delay);
      }
    });
  }

  explosion(pos, scale = 1, { fire = true, debrisColor = 0x5a4a3a } = {}) {
    const n = Math.round(40 * scale);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      const sp = (3 + Math.random() * 6) * scale;
      this.glowP({
        x: pos.x, y: pos.y + 0.3, z: pos.z, vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp,
        color: [0xffe27a, 0xffa53a, 0xff6a1f, 0xfff4c0][(Math.random() * 4) | 0],
        size: (0.18 + Math.random() * 0.3) * scale, life: 0.35 + Math.random() * 0.5, drag: 3, gravity: -2,
        avx: 5, avy: 5,
      });
    }
    for (let i = 0; i < 14 * scale; i++) this.smoke(pos.x, pos.y + 0.4, pos.z, { size: 0.5 * scale, life: 1.6 + Math.random(), spread: 1.2 * scale, vy: 2.2 });
    for (let i = 0; i < 10 * scale; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 6, (Math.random() - 0.5) * 7).multiplyScalar(Math.sqrt(scale));
      this.debris(pos.x, pos.y + 0.2, pos.z, debrisColor, 0.12 + Math.random() * 0.1, v, 1.6);
    }
    if (fire) this.flash(pos, 6 * scale, 0.35 + 0.2 * scale);
    this.shake = Math.max(this.shake, 0.12 * scale);
  }

  dust(pos, scale = 1, color = 0x9b8463) {
    for (let i = 0; i < 10 * scale; i++) this.smoke(pos.x, pos.y + 0.1, pos.z, { size: 0.3 * scale, life: 0.8 + Math.random() * 0.5, color, vy: 1.2, spread: 0.8 * scale });
    for (let i = 0; i < 8 * scale; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
      this.debris(pos.x, pos.y + 0.1, pos.z, color, 0.08 + Math.random() * 0.06, v, 1.2);
    }
  }

  flames(x, y, z, spread = 0.3, size = 0.12) {
    this.glowP({
      x: x + (Math.random() - 0.5) * spread, y, z: z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.4, vy: 1.4 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.4,
      color: Math.random() < 0.5 ? 0xff8a1f : 0xffd24a,
      size: size * (0.7 + Math.random() * 0.6), life: 0.35 + Math.random() * 0.35, drag: 1,
    });
    if (Math.random() < 0.06) this.smoke(x, y + 0.3, z, { size: size * 1.2, life: 0.7, color: 0x6a6a6a, vy: 1.2, spread });
  }

  trail(pos, { color = 0xffffff, size = 0.07, life = 0.35, glow = true } = {}) {
    if (glow) this.glowP({ x: pos.x, y: pos.y, z: pos.z, color, size, life, drag: 0, avx: 0, avy: 0, avz: 0, rx: 0, ry: 0, rz: 0 });
    else this.smoke(pos.x, pos.y, pos.z, { size, life, color, vy: 0.2, spread: 0.05 });
  }

  flash(pos, intensity, life) {
    const l = this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.set(pos.x, pos.y + 1.2, pos.z);
    l.intensity = intensity * 8;
    l.userData.max = intensity * 8;
    l.userData.life = life;
    l.userData.maxLife = life;
  }

  updatePool(pool, dt, isGlow) {
    const items = pool.items;
    const mesh = pool.mesh;
    const colors = mesh.instanceColor.array;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.dead) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        p.maxLife -= dt;
        // render in place while waiting (used for staged castle collapse)
      } else {
        p.life += dt;
        if (p.life >= p.maxLife) {
          if (p.pileKey) this.pile.add(p.pileKey, -p.pileH);
          continue;
        }
        if (!p.settled) {
          p.vy -= p.gravity * dt;
          const d = Math.max(0, 1 - p.drag * dt);
          p.vx *= d; p.vy *= p.gravity ? 1 : d; p.vz *= d;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          p.rx += p.avx * dt; p.ry += p.avy * dt; p.rz += p.avz * dt;
          if (p.ground) {
            const k = this.pile.key(p.x, p.z);
            const floor = this.pile.get(k) + p.size * 0.5;
            if (p.y <= floor && p.vy < 0) {
              p.y = floor;
              if (Math.abs(p.vy) < 2.5) {
                // come to rest lying flat, stacking on what is already there
                p.settled = true;
                p.rx = 0; p.rz = 0;
                p.pileKey = k;
                p.pileH = p.size * 0.9;
                this.pile.add(k, p.pileH);
              } else {
                p.vy = -p.vy * 0.3;
                p.vx *= 0.5; p.vz *= 0.5;
                p.avx *= 0.4; p.avz *= 0.4;
              }
            }
          }
        }
      }
      const t = p.life / p.maxLife;
      let scale = p.size * (1 + p.grow * t);
      if (p.shrinkFrom < 1 && t > p.shrinkFrom) scale *= 1 - (t - p.shrinkFrom) / (1 - p.shrinkFrom);
      _p.set(p.x, p.y, p.z);
      _q.setFromEuler(_e.set(p.rx, p.ry, p.rz));
      _s.setScalar(Math.max(0.0001, scale));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(w, _m);
      const f = isGlow && p.fade ? 1 - t * 0.7 : 1;
      colors[w * 3] = p.r * f;
      colors[w * 3 + 1] = p.g * f;
      colors[w * 3 + 2] = p.b * f;
      items[w++] = p;
    }
    items.length = w;
    mesh.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    this.updatePool(this.solid, dt, false);
    this.updatePool(this.glow, dt, true);
    for (const l of this.lights) {
      if (l.userData.life > 0) {
        l.userData.life -= dt;
        l.intensity = Math.max(0, l.userData.max * (l.userData.life / l.userData.maxLife));
      } else l.intensity = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 0.6);
  }
}
