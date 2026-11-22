import * as THREE from 'three';
import { World, CASTLE } from './world.js';
import { Particles } from './particles.js';
import { createEnemy } from './enemies.js';
import { createDefense } from './defenses.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';

// Viewed from the -X/-Z corner so the castle gate and its front towers face the camera.
const ISO_DIR = new THREE.Vector3(-1, 1, -1).normalize();
const ENEMY_TYPES = ['soldier', 'shieldSoldier', 'ram', 'bomber'];
const DIFFICULTY_ORDER = { soldier: 0, shieldSoldier: 1, ram: 1, bomber: 2 };
const SKY = 0x8fc6ff;

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(config, canvas) {
    this.config = config;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    this.zoom = 1;
    this.pan = new THREE.Vector3();
    this.audio = new Audio();
    this.ui = new UI(this);
    this.state = 'title';
    this.paused = false;
    this.speed = 1;
    this.fancy = true;
    this.enemies = [];
    this.projectiles = [];
    this.defenses = [];
    this.spawnQueue = [];
    this.keys = new Set();
    this.time = 0;
    this.selected = null;
    this.hovered = null;
    this.waveDuration = config.game.waveDurationSeconds;
  }

  async init() {
    this.ui.init();
    this.ui.show('loading');
    this.ui.setLoading(0.1, 'Building terrain...');
    await nextFrame();
    this.world = new World(this.scene);
    this.ui.setLoading(0.6, 'Spawning particles...');
    await nextFrame();
    this.particles = new Particles(this.scene);
    this.buildRangeRing();
    this.ui.setLoading(0.8, 'Painting icons...');
    await nextFrame();
    this.renderIcons();
    this.fitCamera();
    this.bindInput();
    this.ui.setLoading(1, 'Ready!');
    await nextFrame();
    this.toTitle();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---------------------------------------------------------------- camera
  fitCamera() {
    const cam = this.camera;
    cam.position.copy(ISO_DIR).multiplyScalar(200);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.world.getFocusPoints()) {
      const v = p.clone().applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    this.camRight = right;
    this.camUp = up;
    this.fit = {
      halfW: (maxX - minX) / 2 + 1.5,
      halfH: (maxY - minY) / 2 + 3.5,
      // shifted down so the bottom HUD does not cover the field
      center: new THREE.Vector3().addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2 - 2),
    };
    this.applyCamera();
  }

  applyCamera() {
    const cam = this.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / h;
    const halfH = Math.max(this.fit.halfH, this.fit.halfW / aspect);
    cam.left = -halfH * aspect;
    cam.right = halfH * aspect;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.zoom = this.zoom;
    cam.updateProjectionMatrix();
    const target = this.fit.center.clone().add(this.pan);
    const s = this.particles?.shake || 0;
    if (s > 0) target.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    cam.position.copy(target).addScaledVector(ISO_DIR, 200);
    cam.lookAt(target);
    this.viewHalfH = halfH;
  }

  panBy(dxPx, dyPx) {
    const unitsPerPx = (2 * this.viewHalfH) / this.zoom / window.innerHeight;
    this.pan.addScaledVector(this.camRight, -dxPx * unitsPerPx);
    this.pan.addScaledVector(this.camUp, dyPx * unitsPerPx);
    if (this.pan.length() > 30) this.pan.setLength(30);
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.applyCamera();
  }

  setFancy(on) {
    this.fancy = on;
    this.renderer.setPixelRatio(on ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = on;
    this.world.sun.castShadow = on;
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    this.onResize();
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const c = this.canvas;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hits = () => this.world.slots.map((s) => s.hit);
    const pick = (e) => {
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const h = ray.intersectObjects(hits(), false)[0];
      return h ? h.object.userData.slot : null;
    };
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
        if (down.moved && this.state !== 'title') this.panBy(dx, dy);
        down.lx = e.clientX;
        down.ly = e.clientY;
        return;
      }
      if (this.state === 'title' || this.paused) return;
      const s = pick(e);
      if (this.hovered && this.hovered !== s) this.hovered.hovered = false;
      this.hovered = s;
      if (s) s.hovered = true;
      c.style.cursor = s ? 'pointer' : 'default';
    });
    c.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || d.moved || d.button !== 0) return;
      if (this.state === 'title' || this.paused || this.state === 'gameover') return;
      const s = pick(e);
      this.audio.play('click');
      this.selectSlot(s && s !== this.selected ? s : null);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.state === 'title') return;
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.7, 2.6);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'Escape') {
        if (this.state === 'title' || this.state === 'gameover') {
          if (this.ui.current === 'howto' || this.ui.current === 'options') this.ui.show(this.ui.returnTo);
          return;
        }
        if (this.paused) {
          if (this.ui.current === 'pause') this.setPaused(false);
          else this.ui.show('pause');
        } else if (this.selected) this.selectSlot(null);
        else this.setPaused(true);
      }
      if (this.paused || this.state === 'title') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.startWave();
      }
      if (e.code === 'Digit1') this.setSpeed(1);
      if (e.code === 'Digit2') this.setSpeed(2);
      if (e.code === 'Digit3') this.setSpeed(3);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.state === 'wave') this.setPaused(true);
    });
    window.addEventListener('resize', () => this.onResize());
  }

  setSpeed(n) {
    this.speed = n;
  }

  setPaused(p) {
    if (this.state === 'title' || this.state === 'gameover') return;
    this.paused = p;
    this.ui.show(p ? 'pause' : null);
  }

  // ---------------------------------------------------------------- selection / range
  buildRangeRing() {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    this.ring = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.ring.add(line, disc);
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  showRange(slot, range) {
    if (range == null) {
      const sel = this.selected;
      if (sel?.defense) {
        slot = sel;
        range = sel.defense.range;
      } else {
        this.ring.visible = false;
        return;
      }
    }
    this.ring.visible = true;
    this.ring.position.set(slot.top.x, 0.05, slot.top.z);
    this.ring.scale.set(range, 1, range);
  }

  selectSlot(slot) {
    if (this.selected) this.selected.selected = false;
    this.selected = slot;
    if (slot) {
      slot.selected = true;
      this.ui.openSlot(slot);
    } else this.ui.closePanel();
    this.showRange(slot, slot?.defense ? slot.defense.range : null);
  }

  // ---------------------------------------------------------------- economy
  addCredits(n) {
    this.credits += n;
    this.ui.bumpCredits();
  }

  buyDefense(slot, type) {
    const cfg = this.config.defenses[type];
    if (this.state !== 'build' || slot.defense || this.credits < cfg.cost) {
      this.audio.play('deny');
      return;
    }
    this.credits -= cfg.cost;
    const d = createDefense(this, slot, type);
    slot.defense = d;
    this.defenses.push(d);
    this.audio.play('buy');
    this.particles.dust(slot.top, 1.2, 0xbfb49a);
    this.ui.chat(`Built <span class="c-yellow">${cfg.name}</span> on ${slot.label} <span class="c-gray">(-${cfg.cost})</span>`);
    this.ui.refreshPanel();
    this.showRange(slot, d.range);
  }

  upgradeDefense(slot, key) {
    const d = slot.defense;
    const up = d?.cfg.upgrades[key];
    if (this.state !== 'build' || !d || !d.canUpgrade(key) || this.credits < up.cost) {
      this.audio.play('deny');
      return;
    }
    this.credits -= up.cost;
    d.upgrade(key);
    this.audio.play('buy');
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.glowP({
        x: slot.top.x + Math.cos(a) * 1.6, y: slot.top.y + Math.random() * 0.5, z: slot.top.z + Math.sin(a) * 1.6,
        vx: 0, vy: 1.5 + Math.random() * 1.5, vz: 0, color: key === 'fire' ? 0xff9a30 : 0x80ff20, size: 0.1, life: 0.9,
      });
    }
    this.ui.chat(`Upgraded <span class="c-aqua">${up.name}</span> to level ${d.levels[key]} <span class="c-gray">(-${up.cost})</span>`);
    this.ui.refreshPanel();
    this.showRange(slot, d.range);
  }

  // ---------------------------------------------------------------- waves
  waveSpec(n) {
    const W = this.config.waves;
    const list = W.list;
    if (n <= list.length) return list[n - 1];
    const last = list[list.length - 1];
    const k = n - list.length;
    const B = W.beyondList;
    const grow = Math.pow(1 + B.countGrowthPerWave, k);
    const spec = {};
    for (const t of ENEMY_TYPES) spec[t] = Math.round((last[t] || 0) * grow);
    spec.speedMultiplier = Math.min(B.maxSpeedMultiplier, last.speedMultiplier + B.speedIncreasePerWave * k);
    spec.healthMultiplier = (last.healthMultiplier || 1) + B.healthIncreasePerWave * k;
    spec.clearBonus = last.clearBonus + B.clearBonusIncreasePerWave * k;
    const lastWindow = last.spawnWindowSeconds ?? this.config.game.spawnWindowSeconds;
    spec.spawnWindowSeconds = Math.max(B.minSpawnWindowSeconds ?? 0, lastWindow - (B.spawnWindowDecreasePerWave ?? 0) * k);
    return spec;
  }

  startWave() {
    if (this.state !== 'build' || this.paused) return;
    const spec = this.waveSpec(this.waveNumber);
    this.currentSpec = spec;
    const list = [];
    for (const t of ENEMY_TYPES) for (let i = 0; i < (spec[t] || 0); i++) list.push(t);
    // shuffle with a bias that pushes harder enemies later in the wave
    const keyed = list.map((t) => ({ t, k: Math.random() + DIFFICULTY_ORDER[t] * 0.35 }));
    keyed.sort((a, b) => a.k - b.k);
    // spawns are spread evenly over the wave's spawn window, starting after a short delay
    const first = this.config.game.firstSpawnDelaySeconds ?? 2;
    const window = Math.max(first, Math.min(spec.spawnWindowSeconds ?? this.config.game.spawnWindowSeconds, this.waveDuration - 5));
    const n = keyed.length;
    this.spawnQueue = keyed.map((e, i) => ({
      type: e.t,
      at: Math.max(0, first + (n > 1 ? (i / (n - 1)) * (window - first) : 0) + (Math.random() - 0.5) * Math.min(3, window / n)),
    })).sort((a, b) => a.at - b.at);
    this.waveTime = this.waveDuration;
    this.waveElapsed = 0;
    this.state = 'wave';
    this.audio.play('waveStart');
    const parts = ENEMY_TYPES.filter((t) => spec[t] > 0).map((t) => `${spec[t]} ${this.config.enemies[t].name}${spec[t] > 1 ? 's' : ''}`);
    this.ui.showTitle(`Wave ${this.waveNumber}`, 'The enemy approaches!');
    this.ui.chat(`<span class="c-red">Wave ${this.waveNumber}:</span> ${parts.join(', ')}`);
    this.ui.refreshPanel();
  }

  endWave() {
    const bonus = this.currentSpec.clearBonus;
    this.addCredits(bonus);
    this.audio.play('waveEnd');
    this.ui.showTitle(`Wave ${this.waveNumber} Complete!`, `+${bonus} credits`);
    this.ui.chat(`<span class="c-green">Wave ${this.waveNumber} survived!</span> Bonus <span class="c-gold">+${bonus}</span> credits`);
    this.wavesSurvived = this.waveNumber;
    this.waveNumber++;
    this.state = 'build';
    this.ui.refreshPanel();
  }

  spawnEnemy(type, mods) {
    const e = createEnemy(this, type, mods);
    this.enemies.push(e);
    return e;
  }

  onEnemyDeath(enemy, killed) {
    if (!killed || this.state === 'title') return;
    this.kills++;
    this.score += enemy.reward * 10;
    this.addCredits(enemy.reward);
    const p = enemy.object.position.clone();
    p.y += enemy.height + 0.4;
    this.ui.floatText(p, `+${enemy.reward}`, 'credit', 1.4, 1.2);
    this.audio.play('coin');
  }

  spawnDamageText(enemy, amount, fire) {
    if (!this.ui.showDamage || this.state === 'title') return;
    const p = enemy.object.position.clone();
    p.x += (Math.random() - 0.5) * 0.6;
    p.y += enemy.height + 0.1;
    const v = Math.round(amount * 10) / 10;
    this.ui.floatText(p, `-${v}`, `dmg${fire ? ' fire' : ''}`, 1.6, 0.6);
  }

  damageCastle(amount, pos, kind) {
    if (this.state === 'title' || this.state === 'gameover') return;
    this.castleHp = Math.max(0, this.castleHp - amount);
    this.audio.play(kind === 'ram' ? 'ram' : kind === 'sword' ? 'sword' : 'castleHit');
    this.ui.castleHit();
    const p = this.world.gatePos.clone().add(new THREE.Vector3(0, 3, (Math.random() - 0.5) * 2));
    this.ui.floatText(p, `-${amount}`, 'castle', 1.2, 1.0);
    if (kind === 'sword') {
      for (let i = 0; i < 4; i++) {
        this.particles.glowP({
          x: pos.x + 0.6, y: 0.9, z: pos.z, vx: -Math.random() * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2,
          color: 0xffffaa, size: 0.05, life: 0.25, gravity: 8,
        });
      }
    }
    if (this.castleHp <= 0) this.gameOver();
  }

  gameOver() {
    this.state = 'gameover';
    this.spawnQueue = [];
    this.selectSlot(null);
    const W = this.world;
    // castle collapses into a pile of cubes, staged from the top down
    W.castleMesh.updateMatrixWorld(true);
    this.particles.shatter(W.castleMesh, {
      maxPerMesh: 6500, speed: 1.4, life: 6, sizeMul: 1.0, delayByHeight: 0.09, center: CASTLE.center.clone().setY(-2),
    });
    W.castleMesh.visible = false;
    W.flag.visible = false;
    for (const slot of W.slots) {
      if (slot.isCastle && slot.defense) {
        this.particles.shatter(slot.defense.group, { maxPerMesh: 40, speed: 3 });
        slot.defense.dispose();
        this.defenses = this.defenses.filter((d) => d !== slot.defense);
        slot.defense = null;
      }
    }
    const token = (this.gameToken = (this.gameToken || 0) + 1);
    for (let i = 0; i < 7; i++) {
      setTimeout(() => {
        if (token !== this.gameToken) return;
        const p = CASTLE.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 2 + Math.random() * 8, (Math.random() - 0.5) * 10));
        this.particles.explosion(p, 1.6, { debrisColor: 0x9a9a9a });
        this.audio.play('explosion');
      }, i * 380);
    }
    this.particles.shake = 0.6;
    for (const e of this.enemies) if (e.state === 'attack') e.state = 'cheer';
    this.audio.play('gameOver');
    setTimeout(() => {
      if (this.state !== 'gameover' || token !== this.gameToken) return;
      document.getElementById('go-waves').textContent = String(this.wavesSurvived);
      document.getElementById('go-score').textContent = String(this.score + this.wavesSurvived * 250);
      this.ui.show('gameover');
    }, 4500);
  }

  // ---------------------------------------------------------------- lifecycle
  clearField() {
    this.gameToken = (this.gameToken || 0) + 1;
    for (const e of this.enemies) this.scene.remove(e.object);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const d of this.defenses) d.dispose();
    for (const s of this.world.slots) {
      s.defense = null;
      s.hovered = s.selected = false;
    }
    this.enemies = [];
    this.projectiles = [];
    this.defenses = [];
    this.spawnQueue = [];
    this.particles.clear();
    this.world.castleMesh.visible = true;
    this.world.flag.visible = true;
    this.selected = null;
    this.hovered = null;
    this.ring.visible = false;
    this.ui.clearFloaters();
  }

  resetStats() {
    this.credits = this.config.game.startingCredits;
    this.castleMaxHp = this.config.game.castleMaxHealth;
    this.castleHp = this.castleMaxHp;
    this.waveNumber = 1;
    this.wavesSurvived = 0;
    this.kills = 0;
    this.score = 0;
    this.waveTime = this.waveDuration;
    this.speed = 1;
    this.paused = false;
    this.ui.cache = {};
  }

  newGame() {
    this.clearField();
    this.resetStats();
    this.state = 'build';
    this.zoom = 1;
    this.pan.set(0, 0, 0);
    this.ui.closePanel();
    this.ui.clearChat();
    this.ui.show(null);
    this.ui.showTitle('Voxel Defense', 'Build your defenses, then start Wave 1', 3500);
    this.ui.chat('<span class="c-yellow">Welcome, commander!</span> Click a tower to build a defense.');
    this.ui.chat(`You have <span class="c-green">${this.credits}</span> credits.`);
  }

  toTitle() {
    this.clearField();
    this.resetStats();
    this.state = 'title';
    this.zoom = 1;
    this.pan.set(0, 0, 0);
    this.ui.returnTo = 'title';
    this.ui.show('title');
    // a small demo battle plays behind the title screen
    const demo = [['T3', 'archer'], ['T5', 'archer'], ['T6', 'ballista'], ['C2', 'catapult']];
    for (const [id, type] of demo) {
      const slot = this.world.slots.find((s) => s.id === id);
      const d = createDefense(this, slot, type);
      if (type === 'archer') d.upgrade('extraArcher');
      slot.defense = d;
      this.defenses.push(d);
    }
    this.demoTimer = 0;
  }

  // ---------------------------------------------------------------- main loop
  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    if (!this.paused) {
      const total = this.state === 'title' ? dt : dt * this.speed;
      const steps = Math.ceil(total / (1 / 30));
      for (let i = 0; i < steps; i++) this.simulate(total / steps);
    }

    // keyboard panning
    if (this.state !== 'title' && !this.paused) {
      const k = this.keys;
      const sp = 500 * dt;
      let dx = 0, dy = 0;
      if (k.has('KeyA') || k.has('ArrowLeft')) dx += sp;
      if (k.has('KeyD') || k.has('ArrowRight')) dx -= sp;
      if (k.has('KeyW') || k.has('ArrowUp')) dy += sp;
      if (k.has('KeyS') || k.has('ArrowDown')) dy -= sp;
      if (dx || dy) this.panBy(dx, dy);
    } else if (this.state === 'title') {
      this.pan.copy(this.camRight).multiplyScalar(Math.sin(this.time * 0.08) * 6);
    }

    this.applyCamera();
    this.ui.update(dt, this.camera);
    if (this.state !== 'title') this.ui.updateHUD();
    this.renderer.render(this.scene, this.camera);
  }

  simulate(dt) {
    this.world.update(dt, this.state);

    if (this.state === 'title') {
      this.demoTimer -= dt;
      if (this.demoTimer <= 0 && this.enemies.length < 14) {
        this.demoTimer = 1.8 + Math.random() * 1.5;
        const r = Math.random();
        this.spawnEnemy(r < 0.55 ? 'soldier' : r < 0.8 ? 'shieldSoldier' : r < 0.92 ? 'ram' : 'bomber', { speedMultiplier: 1.3, healthMultiplier: 1 });
      }
    }

    if (this.state === 'wave') {
      this.waveTime -= dt;
      this.waveElapsed += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveElapsed) {
        const s = this.spawnQueue.shift();
        this.spawnEnemy(s.type, this.currentSpec);
      }
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.update(dt);
      if (this.state === 'title' && e.alive && e.state === 'attack') e.die(false);
    }
    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.state !== 'gameover') for (const d of this.defenses) d.update(dt);
    for (const p of this.projectiles) p.update(dt);
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.particles.update(dt);

    if (this.state === 'wave' && this.waveTime <= 0 && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.endWave();
    }

    // a damaged castle smokes, a badly damaged one burns
    if (this.state === 'build' || this.state === 'wave') {
      const f = this.castleHp / this.castleMaxHp;
      if (f < 0.6 && Math.random() < dt * (f < 0.3 ? 14 : 6)) {
        const p = CASTLE.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 11, 6 + Math.random() * 4, (Math.random() - 0.5) * 11));
        this.particles.smoke(p.x, p.y, p.z, { size: 0.6, life: 2.4, color: 0x3a3a3a, vy: 1.6, spread: 0.6 });
        if (f < 0.3) for (let i = 0; i < 3; i++) this.particles.flames(p.x, p.y, p.z, 0.6, 0.22);
      }
    }
  }

  // ---------------------------------------------------------------- icons
  /** Renders the real 3D models into small images for the UI (Minecraft-style item icons). */
  renderIcons() {
    const r = this.renderer;
    const S = 96;
    const pr = r.getPixelRatio();
    const iconScene = new THREE.Scene();
    iconScene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 2.2);
    dl.position.set(3, 6, 4);
    iconScene.add(dl);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const dir = new THREE.Vector3(0.9, 0.75, 1.3).normalize();
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const ctx = out.getContext('2d');
    const stub = { glowP() {}, flames() {}, smoke() {} };
    const fake = {
      scene: iconScene, config: this.config, enemies: [], projectiles: [], audio: this.audio, particles: stub,
      world: this.world, onEnemyDeath() {}, damageCastle() {},
    };

    const snap = (obj, fill = 0.9) => {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3();
      obj.traverse((o) => {
        if (o.isMesh && o.visible) box.expandByObject(o);
      });
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      cam.position.copy(sphere.center).addScaledVector(dir, 50);
      cam.lookAt(sphere.center);
      const rad = sphere.radius * fill;
      cam.left = -rad; cam.right = rad; cam.top = rad; cam.bottom = -rad;
      cam.updateProjectionMatrix();
      r.setScissorTest(true);
      r.setScissor(0, 0, S, S);
      r.setViewport(0, 0, S, S);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(iconScene, cam);
      ctx.clearRect(0, 0, S, S);
      const c = r.domElement;
      ctx.drawImage(c, 0, c.height - S * pr, S * pr, S * pr, 0, 0, S, S);
      return out.toDataURL();
    };

    const slot = { top: new THREE.Vector3(), id: 'icon' };
    const defIcons = {};
    for (const type of ['archer', 'ballista', 'catapult']) {
      const d = createDefense(fake, slot, type);
      if (type === 'archer') {
        const a = d.archers[0];
        a.rig.root.rotation.y = 0;
        a.aimW = 1;
        a.draw = 0.8;
        a.target = true;
        a.aimLocal.set(0, 0.1, 1).normalize();
        a.pose();
      } else {
        d.yawGroup.rotation.y = 0;
        d.cooldown = 0;
        d.update(0);
      }
      defIcons[type] = snap(d.group, type === 'archer' ? 0.75 : 0.85);
      iconScene.remove(d.group);
    }
    const enemyIcons = {};
    for (const type of ENEMY_TYPES) {
      const e = createEnemy(fake, type, { speedMultiplier: 1, healthMultiplier: 1 });
      e.animate(0.05);
      e.object.position.set(0, 0, 0);
      e.object.rotation.y = 0;
      if (e.healthBar) e.healthBar.group.visible = false;
      enemyIcons[type] = snap(e.object, type === 'ram' ? 0.85 : 0.75);
      iconScene.remove(e.object);
    }

    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, window.innerHeight);
    r.setClearColor(SKY, 1);
    this.ui.setDefenseIcons(defIcons);
    this.ui.enemyIcons = enemyIcons;
  }
}
