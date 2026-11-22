import * as THREE from 'three';

export const voxelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const FACES = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];

const tmpColor = new THREE.Color();

/** Small seeded RNG so procedural content is stable between reloads. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sharedRng = makeRng(1337);

/** Returns a hex color randomly brightened/darkened by up to `amount`. */
export function vary(hex, amount = 0.08, rng = sharedRng) {
  tmpColor.setHex(hex);
  const f = 1 + (rng() * 2 - 1) * amount;
  tmpColor.r = Math.min(1, tmpColor.r * f);
  tmpColor.g = Math.min(1, tmpColor.g * f);
  tmpColor.b = Math.min(1, tmpColor.b * f);
  return tmpColor.getHex();
}

export class VoxelGrid {
  constructor() {
    this.map = new Map();
  }

  static key(x, y, z) {
    return `${x},${y},${z}`;
  }

  set(x, y, z, color) {
    const k = VoxelGrid.key(x, y, z);
    if (color === null || color === undefined) this.map.delete(k);
    else this.map.set(k, { x, y, z, color });
    return this;
  }

  get(x, y, z) {
    return this.map.get(VoxelGrid.key(x, y, z));
  }

  has(x, y, z) {
    return this.map.has(VoxelGrid.key(x, y, z));
  }

  /** Fill [x0,x1) x [y0,y1) x [z0,z1). `color` may be a hex or fn(x,y,z) returning hex/null. */
  box(x0, y0, z0, x1, y1, z1, color) {
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++) {
          const c = typeof color === 'function' ? color(x, y, z) : color;
          this.set(x, y, z, c);
        }
    return this;
  }

  get size() {
    return this.map.size;
  }

  /**
   * Builds a face-culled geometry. offset is applied after scaling.
   * Also returns the surface voxels (for particle effects) in geometry-local units.
   */
  build(scale = 1, offset = [0, 0, 0]) {
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const surface = [];
    const c = new THREE.Color();
    for (const v of this.map.values()) {
      c.setHex(v.color);
      let exposed = false;
      for (const face of FACES) {
        const [dx, dy, dz] = face.dir;
        if (this.has(v.x + dx, v.y + dy, v.z + dz)) continue;
        exposed = true;
        const ndx = positions.length / 3;
        // subtle per-face shading to emphasize the blocky look
        const shade = dy === 1 ? 1 : dy === -1 ? 0.7 : dx !== 0 ? 0.88 : 0.94;
        for (const corner of face.corners) {
          positions.push(
            (v.x + corner[0]) * scale + offset[0],
            (v.y + corner[1]) * scale + offset[1],
            (v.z + corner[2]) * scale + offset[2],
          );
          normals.push(dx, dy, dz);
          colors.push(c.r * shade, c.g * shade, c.b * shade);
        }
        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
      }
      if (exposed) {
        surface.push({
          x: (v.x + 0.5) * scale + offset[0],
          y: (v.y + 0.5) * scale + offset[1],
          z: (v.z + 0.5) * scale + offset[2],
          color: v.color,
        });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    geo.userData.voxels = surface;
    geo.userData.voxelSize = scale;
    return geo;
  }

  /** Convenience: build a mesh (shadow casting) with the shared voxel material. */
  mesh(scale = 1, offset = [0, 0, 0], material = voxelMaterial) {
    const m = new THREE.Mesh(this.build(scale, offset), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/** Mesh from a prebuilt (shared) voxel geometry. */
export function voxelMesh(geometry, material = voxelMaterial) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cache builder: builds the geometry once and reuses it. */
const geoCache = new Map();
export function cachedGeometry(key, builder) {
  if (!geoCache.has(key)) geoCache.set(key, builder());
  return geoCache.get(key);
}
