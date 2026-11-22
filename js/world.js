import * as THREE from 'three';
import { VoxelGrid, makeRng, vary, voxelMaterial } from './voxel.js';

export const FIELD_HALF = 60;

// Enemy route (world x,z). Grid-aligned segments read nicely with the isometric camera.
const WAYPOINTS = [
  [-58, 12],
  [-20, 12],
  [-20, -2],
  [-4, -2],
  [-4, -16],
  [8.6, -16],
];

// Castle footprint (world units)
export const CASTLE = { x0: 10, z0: -22, size: 12, center: new THREE.Vector3(16, 0, -16) };

// Six small towers: three on each side of the path (left/right of travel direction).
const TOWER_SPOTS = [
  { id: 'T1', x: -26, z: 7, side: 'left' },
  { id: 'T2', x: -14, z: 17, side: 'right' },
  { id: 'T3', x: -14, z: 3.5, side: 'right' },
  { id: 'T4', x: -26, z: -6, side: 'left' },
  { id: 'T5', x: -10, z: -9, side: 'left' },
  { id: 'T6', x: 2, z: -8.5, side: 'right' },
];
const TOWER_HEIGHT = 5;
const CASTLE_TOWER_HEIGHT = 9;

/** Polyline path with rounded corners and arc-length sampling. */
export class Path {
  constructor(waypoints, radius = 2.2) {
    const pts = [];
    const wp = waypoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    pts.push(wp[0].clone());
    for (let i = 1; i < wp.length - 1; i++) {
      const prev = wp[i - 1], cur = wp[i], next = wp[i + 1];
      const dIn = cur.clone().sub(prev).normalize();
      const dOut = next.clone().sub(cur).normalize();
      const a = cur.clone().addScaledVector(dIn, -radius);
      const b = cur.clone().addScaledVector(dOut, radius);
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        // quadratic bezier a -> cur -> b
        const p = new THREE.Vector3()
          .addScaledVector(a, (1 - t) * (1 - t))
          .addScaledVector(cur, 2 * (1 - t) * t)
          .addScaledVector(b, t * t);
        pts.push(p);
      }
    }
    pts.push(wp[wp.length - 1].clone());
    this.points = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  sample(d, outPos, outTan) {
    d = Math.max(0, Math.min(this.length, d));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const segLen = this.cum[hi] - this.cum[lo] || 1;
    const t = (d - this.cum[lo]) / segLen;
    const a = this.points[lo], b = this.points[hi];
    if (outPos) outPos.lerpVectors(a, b, t);
    if (outTan) outTan.subVectors(b, a).normalize();
    return outPos;
  }

  distanceToPoint(x, z) {
    let best = Infinity;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i];
      const abx = b.x - a.x, abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + abx * t - x, pz = a.z + abz * t - z;
      best = Math.min(best, Math.hypot(px, pz));
    }
    return best;
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.path = new Path(WAYPOINTS);
    this.slots = [];
    this.time = 0;
    this.rng = makeRng(2024);

    this.buildLights();
    this.buildGround();
    this.buildNature();
    this.buildTowers();
    this.buildCastle();

    this.gatePos = new THREE.Vector3(9, 0, -16);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x4f7a32, 1.25);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dd, 2.3);
    sun.position.set(-30, 60, 25);
    sun.target.position.set(-6, 0, -2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 160;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.group.add(sun, sun.target);
    this.sun = sun;
  }

  isNearPath(x, z, margin) {
    return this.path.distanceToPoint(x, z) < margin;
  }

  isBlocked(x, z, margin = 0) {
    if (this.isNearPath(x, z, 3 + margin)) return true;
    for (const t of TOWER_SPOTS) if (Math.abs(x - t.x) < 3.5 + margin && Math.abs(z - t.z) < 3.5 + margin) return true;
    if (x > CASTLE.x0 - 3 - margin && x < CASTLE.x0 + CASTLE.size + 3 + margin &&
        z > CASTLE.z0 - 3 - margin && z < CASTLE.z0 + CASTLE.size + 3 + margin) return true;
    return false;
  }

  /** True if the point would be visible with the default isometric framing. */
  isInView(x, z) {
    const s = (x - z) / Math.SQRT2, t = (x + z) / Math.SQRT2;
    return Math.abs(s) < 40 && Math.abs(t) < 42;
  }

  buildGround() {
    const rng = this.rng;
    const g = new VoxelGrid();
    const grass = [0x6cbb3c, 0x64b236, 0x72c142, 0x5fa831];
    const pathCols = [0xa4865a, 0x98794d, 0x8e7048, 0xab8f62];
    for (let x = -FIELD_HALF; x < FIELD_HALF; x++) {
      for (let z = -FIELD_HALF; z < FIELD_HALF; z++) {
        const cx = x + 0.5, cz = z + 0.5;
        const d = this.path.distanceToPoint(cx, cz);
        let col;
        if (d < 1.65) col = rng() < 0.12 ? vary(0x8a8a82, 0.1, rng) : vary(pathCols[(rng() * 4) | 0], 0.05, rng);
        else if (d < 2.1 && rng() < 0.45) col = vary(0x8c7d4e, 0.08, rng);
        else {
          const n = Math.sin(cx * 0.21) * Math.cos(cz * 0.17) + Math.sin((cx + cz) * 0.09);
          col = vary(grass[(rng() * 4) | 0], 0.05, rng);
          if (n > 0.9) col = vary(0x5a9e2e, 0.05, rng);
        }
        g.set(x, -1, z, col);
        // dirt layer below so field edges look like a voxel slab
        g.set(x, -2, z, 0x7a5636);
      }
    }
    const ground = g.mesh(1);
    ground.castShadow = false;
    this.group.add(ground);

    // Large backdrop plane so wide screens never see the void
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshLambertMaterial({ color: 0x5c9e35 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -2.05;
    plane.receiveShadow = true;
    this.group.add(plane);
  }

  buildNature() {
    const rng = this.rng;
    const nat = new VoxelGrid(); // scale 0.5
    const placed = [];
    const tryPlace = (minDist, margin) => {
      for (let i = 0; i < 80; i++) {
        const x = (rng() * 2 - 1) * (FIELD_HALF - 3);
        const z = (rng() * 2 - 1) * (FIELD_HALF - 3);
        if (!this.isInView(x, z) || this.isBlocked(x, z, margin)) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
        const p = { x, z };
        placed.push(p);
        return p;
      }
      return null;
    };

    const tree = (wx, wz, birch) => {
      const bx = Math.round(wx * 2), bz = Math.round(wz * 2);
      const h = 7 + ((rng() * 4) | 0);
      const bark = birch ? 0xe8e4d8 : 0x6b4a2b;
      for (let y = 0; y < h; y++)
        nat.box(bx, y, bz, bx + 2, y + 1, bz + 2, () => {
          if (birch && rng() < 0.25) return 0x2f2a26;
          return vary(bark, 0.07, rng);
        });
      const leaf = birch ? 0x7fb24a : 0x3f8f2a;
      const top = h;
      const layer = (y, r, chance = 1) => {
        for (let x = -r; x < r + 2; x++)
          for (let z = -r; z < r + 2; z++) {
            const edge = (x === -r || x === r + 1) && (z === -r || z === r + 1);
            if (edge && rng() < 0.7) continue;
            if (rng() > chance) continue;
            nat.set(bx + x, y, bz + z, vary(leaf, 0.12, rng));
          }
      };
      layer(top - 3, 4, 0.95);
      layer(top - 2, 4, 0.95);
      layer(top - 1, 3);
      layer(top, 3);
      layer(top + 1, 2);
      layer(top + 2, 1);
      // a few apples on oaks
      if (!birch) for (let i = 0; i < 3; i++) nat.set(bx - 3 + ((rng() * 7) | 0), top - 4, bz - 3 + ((rng() * 7) | 0), 0xc8302a);
    };

    const shrub = (wx, wz) => {
      const bx = Math.round(wx * 2), bz = Math.round(wz * 2);
      const w = 2 + ((rng() * 2) | 0);
      const col = rng() < 0.5 ? 0x3c8a2c : 0x4e9a36;
      for (let x = 0; x < w; x++)
        for (let z = 0; z < w; z++) {
          const hh = 1 + ((rng() * 2) | 0);
          for (let y = 0; y < hh; y++) nat.set(bx + x, y, bz + z, vary(col, 0.12, rng));
        }
      if (rng() < 0.5) nat.set(bx + ((rng() * w) | 0), 2, bz + ((rng() * w) | 0), rng() < 0.5 ? 0xd23c4a : 0x5a3fb8);
    };

    const rock = (wx, wz) => {
      const bx = Math.round(wx * 2), bz = Math.round(wz * 2);
      nat.box(bx, 0, bz, bx + 3, 1, bz + 2, () => vary(0x8b8b8b, 0.12, rng));
      nat.box(bx, 1, bz, bx + 2, 2, bz + 2, () => vary(0x9a9a9a, 0.12, rng));
    };

    for (let i = 0; i < 18; i++) {
      const p = tryPlace(5, 1.5);
      if (p) tree(p.x, p.z, rng() < 0.3);
    }
    for (let i = 0; i < 26; i++) {
      const p = tryPlace(2.5, 0.2);
      if (p) shrub(p.x, p.z);
    }
    for (let i = 0; i < 8; i++) {
      const p = tryPlace(3, 0.2);
      if (p) rock(p.x, p.z);
    }
    this.group.add(nat.mesh(0.5));

    // fine detail: tall grass and flowers (scale 1/8)
    const fine = new VoxelGrid();
    for (let i = 0; i < 380; i++) {
      const x = (rng() * 2 - 1) * (FIELD_HALF - 2);
      const z = (rng() * 2 - 1) * (FIELD_HALF - 2);
      if (!this.isInView(x, z) || this.isBlocked(x, z, -0.6)) continue;
      const bx = Math.round(x * 8), bz = Math.round(z * 8);
      const r = rng();
      if (r < 0.7) {
        for (let k = 0; k < 3; k++) {
          const ox = ((rng() * 5) | 0) - 2, oz = ((rng() * 5) | 0) - 2;
          const h = 2 + ((rng() * 3) | 0);
          for (let y = 0; y < h; y++) fine.set(bx + ox, y, bz + oz, vary(0x4f9a2a, 0.15, rng));
        }
      } else {
        const petal = [0xe8d23a, 0xd83a3a, 0xf0f0f0, 0x6a8ff0][(rng() * 4) | 0];
        for (let y = 0; y < 3; y++) fine.set(bx, y, bz, 0x3f8a22);
        fine.set(bx, 3, bz, 0xf2c94c);
        fine.set(bx + 1, 3, bz, petal); fine.set(bx - 1, 3, bz, petal);
        fine.set(bx, 3, bz + 1, petal); fine.set(bx, 3, bz - 1, petal);
      }
    }
    const fineMesh = fine.mesh(0.125);
    fineMesh.castShadow = false;
    this.group.add(fineMesh);
  }

  buildTowerGeometry(heightUnits, seed) {
    const rng = makeRng(seed);
    const g = new VoxelGrid();
    const H = heightUnits * 2;
    const stone = (x, y, z) => {
      const r = rng();
      if (r < 0.06 && y < 4) return vary(0x5e7f3a, 0.1, rng); // moss
      const brick = ((y + (x + z) * 0.5) | 0) % 2 === 0 ? 0x8f8f8f : 0x858585;
      return vary(brick, 0.1, rng);
    };
    g.box(0, 0, 0, 8, H, 8, stone);
    // base flare
    g.box(-1, 0, -1, 9, 2, 9, (x, y, z) => (x < 0 || x > 7 || z < 0 || z > 7 ? vary(0x6f6f6f, 0.1, rng) : null));
    g.box(0, 0, 0, 8, 2, 8, stone);
    // top floor planks
    g.box(1, H - 1, 1, 7, H, 7, (x) => vary(x % 2 ? 0xa07a45 : 0x94703f, 0.06, rng));
    // overhanging top ring
    g.box(-1, H - 2, -1, 9, H, 9, (x, y, z) => (x < 0 || x > 7 || z < 0 || z > 7 ? vary(0x7b7b7b, 0.1, rng) : g.get(x, y, z)?.color));
    // crenellations
    for (let x = -1; x <= 8; x++)
      for (let z = -1; z <= 8; z++) {
        const edge = x === -1 || x === 8 || z === -1 || z === 8;
        if (!edge) continue;
        if ((x + z) % 2 === 0) g.set(x, H, z, vary(0x8a8a8a, 0.1, rng));
      }
    // arrow slits / windows
    for (let y = 4; y < H - 3; y += 3) {
      g.set(3, y, 8 - 1, null); g.set(4, y, 7, 0x2a2420);
      g.set(0, y + 1, 4, 0x2a2420); g.set(7, y + 1, 3, 0x2a2420);
    }
    // door
    g.box(3, 0, 7, 5, 3, 8, 0x5a3c1e);
    return { geo: g.build(0.5, [-2, 0, -2]), top: heightUnits };
  }

  buildTowers() {
    const t = this.buildTowerGeometry(TOWER_HEIGHT, 77);
    for (const spot of TOWER_SPOTS) {
      const mesh = new THREE.Mesh(t.geo, voxelMaterial);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.set(spot.x, 0, spot.z);
      // vary door facing toward the path
      mesh.rotation.y = Math.round(Math.atan2(-spot.x, -spot.z) / (Math.PI / 2)) * (Math.PI / 2);
      this.group.add(mesh);
      this.addSlot(spot.id, new THREE.Vector3(spot.x, TOWER_HEIGHT, spot.z), mesh, `Tower ${spot.id.slice(1)}`, false);
    }
  }

  addSlot(id, top, structure, label, isCastle) {
    const height = top.y;
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, height + 2.5, 4.6),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(top.x, (height + 2.5) / 2, top.z);
    this.group.add(hit);

    // placement marker: floating gold plus + selection outline
    const marker = new THREE.Group();
    const plus = new VoxelGrid();
    plus.box(0, 1, 0, 3, 2, 1, 0xffd83a).box(1, 0, 0, 2, 3, 1, 0xffd83a);
    const plusMesh = plus.mesh(0.28, [-0.42, -0.42, -0.14], new THREE.MeshBasicMaterial({ vertexColors: true }));
    plusMesh.castShadow = false;
    plusMesh.position.y = 1.4;
    marker.add(plusMesh);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(3.4, 0.1, 3.4)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    outline.position.y = 0.06;
    marker.add(outline);
    marker.position.copy(top);
    this.group.add(marker);

    const slot = { id, label, top: top.clone(), hit, marker, plusMesh, outline, defense: null, isCastle, structure };
    hit.userData.slot = slot;
    this.slots.push(slot);
  }

  buildCastle() {
    const rng = makeRng(99);
    const g = new VoxelGrid();
    const N = CASTLE.size * 2; // 24 voxels
    const WALL_H = 12, TOWER_H = CASTLE_TOWER_HEIGHT * 2, KEEP_H = 24;
    const stone = (x, y, z) => {
      const r = rng();
      if (r < 0.04 && y < 5) return vary(0x5e7f3a, 0.1, rng);
      const brick = ((y + ((x + z) >> 1)) & 1) ? 0x9c9c9c : 0x929292;
      return vary(brick, 0.08, rng);
    };
    const dark = (x, y, z) => vary(0x7c7c7c, 0.08, rng);

    // courtyard floor
    g.box(2, 0, 2, N - 2, 1, N - 2, () => vary(0x8d8d86, 0.1, rng));
    // curtain walls (2 thick)
    g.box(0, 0, 0, N, WALL_H, 2, stone);
    g.box(0, 0, N - 2, N, WALL_H, N, stone);
    g.box(0, 0, 0, 2, WALL_H, N, stone);
    g.box(N - 2, 0, 0, N, WALL_H, N, stone);
    // wall crenellations
    for (let i = 0; i < N; i++) {
      if (i % 2 === 0) {
        g.set(i, WALL_H, 0, stone(i, WALL_H, 0)); g.set(i, WALL_H, N - 1, stone(i, WALL_H, N - 1));
        g.set(0, WALL_H, i, stone(0, WALL_H, i)); g.set(N - 1, WALL_H, i, stone(N - 1, WALL_H, i));
      }
    }
    // corner towers 8x8
    const corners = [[0, 0], [N - 8, 0], [0, N - 8], [N - 8, N - 8]];
    for (const [cx, cz] of corners) {
      g.box(cx, 0, cz, cx + 8, TOWER_H, cz + 8, stone);
      g.box(cx - 1, TOWER_H - 2, cz - 1, cx + 9, TOWER_H, cz + 9, (x, y, z) =>
        x < cx || x >= cx + 8 || z < cz || z >= cz + 8 ? dark(x, y, z) : g.get(x, y, z)?.color);
      g.box(cx + 1, TOWER_H - 1, cz + 1, cx + 7, TOWER_H, cz + 7, (x) => vary(x % 2 ? 0xa07a45 : 0x94703f, 0.06, rng));
      for (let x = cx - 1; x <= cx + 8; x++)
        for (let z = cz - 1; z <= cz + 8; z++) {
          const edge = x === cx - 1 || x === cx + 8 || z === cz - 1 || z === cz + 8;
          if (edge && (x + z) % 2 === 0) g.set(x, TOWER_H, z, dark(x, TOWER_H, z));
        }
      for (let y = 5; y < TOWER_H - 3; y += 4) {
        g.set(cx, y, cz + 4, 0x2a2420); g.set(cx + 4, y, cz, 0x2a2420);
        g.set(cx + 7, y, cz + 3, 0x2a2420); g.set(cx + 3, y, cz + 7, 0x2a2420);
      }
    }
    // keep
    const k0 = 8, k1 = 16;
    g.box(k0, 0, k0, k1, KEEP_H, k1, stone);
    g.box(k0 - 1, KEEP_H - 2, k0 - 1, k1 + 1, KEEP_H, k1 + 1, (x, y, z) =>
      x < k0 || x >= k1 || z < k0 || z >= k1 ? dark(x, y, z) : g.get(x, y, z)?.color);
    for (let x = k0 - 1; x <= k1; x++)
      for (let z = k0 - 1; z <= k1; z++) {
        const edge = x === k0 - 1 || x === k1 || z === k0 - 1 || z === k1;
        if (edge && (x + z) % 2 === 0) g.set(x, KEEP_H, z, dark(x, KEEP_H, z));
      }
    // keep roof (blue slate pyramid)
    for (let l = 0; l < 4; l++) g.box(k0 + l, KEEP_H + l, k0 + l, k1 - l, KEEP_H + l + 1, k1 - l, () => vary(0x3b5a9a, 0.08, rng));
    for (let y = 6; y < KEEP_H - 4; y += 5) {
      g.set(k0 - 1 + 1, y, 11, null); g.set(k0, y, 11, 0xffd36b); g.set(k0, y, 12, 0xffd36b);
      g.set(11, y, k0, 0xffd36b); g.set(12, y, k0, 0xffd36b);
    }
    // gatehouse on west wall (x = 0), centered at z = 12
    g.box(-2, 0, 7, 3, 15, 17, stone);
    for (let z = 7; z < 17; z++) if (z % 2 === 1) g.set(-2, 15, z, dark(-2, 15, z));
    // gate opening with door and portcullis
    for (let z = 9; z < 15; z++) for (let y = 0; y < 8; y++) g.set(-2, y, z, null);
    g.box(-1, 0, 9, 0, 8, 15, (x, y, z) => ((y + z) % 3 === 0 ? 0x3a3a3e : vary(0x5a3c1e, 0.08, rng)));
    for (let z = 9; z < 15; z++) g.set(-2, 8, z, 0x3a3a3e);
    // banners beside the gate
    for (let y = 9; y < 13; y++) { g.set(-3, y, 8, 0xb02a2a); g.set(-3, y, 15, 0xb02a2a); }
    g.set(-3, 9, 8, 0xe8c040); g.set(-3, 9, 15, 0xe8c040);

    const mesh = g.mesh(0.5);
    mesh.position.set(CASTLE.x0, 0, CASTLE.z0);
    this.group.add(mesh);
    this.castleMesh = mesh;

    // flag pole + animated flag on keep roof
    const flagGroup = new THREE.Group();
    const poleG = new VoxelGrid().box(0, 0, 0, 1, 12, 1, 0x5a4630);
    flagGroup.add(poleG.mesh(0.25));
    this.flagCols = [];
    for (let i = 0; i < 6; i++) {
      const col = new VoxelGrid().box(0, 0, 0, 1, 5, 1, (x, y) => (y === 2 && i > 1 && i < 4 ? 0xf2d04a : i % 2 ? 0xc0302a : 0xb02a24));
      const m = col.mesh(0.25);
      m.position.set(0.25 + i * 0.25, 1.75, 0);
      flagGroup.add(m);
      this.flagCols.push(m);
    }
    flagGroup.position.set(CASTLE.center.x - 0.12, KEEP_H * 0.5 + 2, CASTLE.center.z - 0.12);
    this.group.add(flagGroup);
    this.flag = flagGroup;

    // defense slots on the two front (west) castle towers
    const topY = CASTLE_TOWER_HEIGHT;
    this.addSlot('C1', new THREE.Vector3(CASTLE.x0 + 2, topY, CASTLE.z0 + 2), mesh, 'Castle Tower North', true);
    this.addSlot('C2', new THREE.Vector3(CASTLE.x0 + 2, topY, CASTLE.z0 + CASTLE.size - 2), mesh, 'Castle Tower South', true);
  }

  /** Points to keep in view for camera framing. */
  getFocusPoints() {
    const pts = [];
    for (const s of this.slots) pts.push(s.top.clone(), s.top.clone().setY(0));
    for (const x of [CASTLE.x0, CASTLE.x0 + CASTLE.size])
      for (const z of [CASTLE.z0, CASTLE.z0 + CASTLE.size])
        pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 14, z));
    for (const p of this.path.points) if (p.x > -36) pts.push(p.clone());
    return pts;
  }

  update(dt, phase) {
    this.time += dt;
    const t = this.time;
    this.flagCols.forEach((m, i) => {
      m.position.z = Math.sin(t * 4 - i * 0.8) * 0.06 * i;
    });
    for (const slot of this.slots) {
      const show = !slot.defense && phase === 'build';
      slot.marker.visible = !!(show || slot.hovered || slot.selected);
      slot.plusMesh.visible = !slot.defense && phase === 'build';
      slot.plusMesh.position.y = 1.4 + Math.sin(t * 2.5 + slot.top.x) * 0.15;
      slot.plusMesh.rotation.y = t * 1.5;
      const col = slot.selected ? 0xffe066 : slot.hovered ? 0xffffff : 0x9cff7a;
      slot.outline.material.color.setHex(col);
      slot.outline.material.opacity = slot.selected || slot.hovered ? 1 : 0.5 + Math.sin(t * 4) * 0.3;
    }
  }
}
