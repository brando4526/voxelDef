import * as THREE from 'three';

// ---------------------------------------------------------------- pixel art
const ICONS = {
  emerald: {
    pal: { k: '#0a3a1a', g: '#17dd62', l: '#b8ffd0', d: '#0e9a45' },
    px: ['....kk....', '...kggk...', '..kgllgk..', '.kglgggdk.', 'kglggggddk', 'kgggggdddk', '.kggggddk.', '..kgdddk..', '...kddk...', '....kk....'],
  },
  heart: {
    pal: { k: '#1a0505', w: '#ffc8c8', r: '#e01818', e: '#3a2a2a' },
    px: ['.kk...kk.', 'kwrk.krrk', 'kwrrkrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....'],
  },
  sword: {
    pal: { k: '#141414', w: '#ffffff', g: '#a8a8b8', b: '#4a4a52', h: '#6a4a2a' },
    px: ['........kk', '.......kwk', '......kwgk', '.....kwgk.', '....kwgk..', 'kk.kwgk...', 'kbkwgk....', '.kbbk.....', '.khkbk....', 'khk.kk....'],
  },
  clock: {
    pal: { k: '#2a2010', y: '#e8b830', w: '#f8f0d0' },
    px: ['...kkkk...', '.kkyyyykk.', '.kywwwwyk.', 'kywwwkwwyk', 'kywwwkwwyk', 'kywwwkkkyk', 'kywwwwwwyk', '.kywwwwyk.', '.kkyyyykk.', '...kkkk...'],
  },
  flame: {
    pal: { r: '#c83010', y: '#ff8a1a', o: '#ffc040', w: '#fff4a0' },
    px: ['....r.....', '...rr.....', '...ryr..r.', '..ryyr.rr.', '..ryyyrrr.', '.ryyoyyyr.', '.ryooooyr.', 'ryoowwooyr', 'ryowwwwoyr', '.rrooooorr'],
  },
  target: {
    pal: { k: '#1a1a1a', r: '#d02020', w: '#f0f0f0' },
    px: ['...kkkk...', '.kkrrrrkk.', '.krwwwwrk.', 'krwrrrrwrk', 'krwrkkrwrk', 'krwrkkrwrk', 'krwrrrrwrk', '.krwwwwrk.', '.kkrrrrkk.', '...kkkk...'],
  },
  plus: {
    pal: { k: '#1a1a1a', g: '#5ad13a' },
    px: ['...kkkk...', '...kggk...', '...kggk...', 'kkkkggkkkk', 'kggggggggk', 'kggggggggk', 'kkkkggkkkk', '...kggk...', '...kggk...', '...kkkk...'],
  },
  play: {
    pal: { k: '#1a1a1a', g: '#5ad13a', l: '#a8ff80' },
    px: ['kk........', 'klkk......', 'klggkk....', 'klggggkk..', 'kgggggggkk', 'kgggggggkk', 'kgggggkk..', 'kgggkk....', 'kgkk......', 'kk........'],
  },
  pause: {
    pal: { k: '#1a1a1a', w: '#e0e0e0' },
    px: ['..........', '.kkk..kkk.', '.kwk..kwk.', '.kwk..kwk.', '.kwk..kwk.', '.kwk..kwk.', '.kwk..kwk.', '.kwk..kwk.', '.kkk..kkk.', '..........'],
  },
  skull: {
    pal: { k: '#1a1a1a', w: '#e8e8d8' },
    px: ['.kkkkkkkk.', 'kwwwwwwwwk', 'kwwwwwwwwk', 'kwkkwwkkwk', 'kwkkwwkkwk', 'kwwwwwwwwk', '.kwwkkwwk.', '.kwwwwwwk.', '..kwkwkwk.', '..kkkkkk..'],
  },
};

function drawPixels(icon, variant) {
  const rows = icon.px;
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let col = icon.pal[ch];
      if (variant === 'empty' && (ch === 'r' || ch === 'w')) col = icon.pal.e;
      if (variant === 'half' && x >= 5 && (ch === 'r' || ch === 'w')) col = icon.pal.e;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return c.toDataURL();
}

function noiseTexture(base, spread, specks, size = 16, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let [r, g, b] = base;
      const f = 1 + (rnd() * 2 - 1) * spread;
      r *= f; g *= f; b *= f;
      if (specks && rnd() < specks.chance) [r, g, b] = specks.color;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  return `url(${c.toDataURL()})`;
}

const UPGRADE_ICON = { extraArcher: 'plus', speed: 'clock', damage: 'sword', fire: 'flame', area: 'target' };
const DEF_TYPES = ['archer', 'ballista', 'catapult'];
const ENEMY_TYPES = ['soldier', 'shieldSoldier', 'ram', 'bomber'];

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.icons = {};
    this.defenseIcons = {};
    this.enemyIcons = {};
    this.floaters = [];
    this.returnTo = 'title';
    this.current = null;
    this.cache = {};
    this.panelSig = '';
    this.showDamage = true;
    this.$ = (sel) => document.querySelector(sel);
  }

  init() {
    const root = document.documentElement.style;
    root.setProperty('--stone-tex', noiseTexture([200, 200, 200], 0.12, { chance: 0.08, color: [150, 150, 150] }, 16, 3));
    root.setProperty('--dirt-tex', noiseTexture([134, 96, 67], 0.15, { chance: 0.12, color: [95, 68, 48] }, 16, 11));
    for (const k of Object.keys(ICONS)) this.icons[k] = drawPixels(ICONS[k]);
    this.icons.heartHalf = drawPixels(ICONS.heart, 'half');
    this.icons.heartEmpty = drawPixels(ICONS.heart, 'empty');
    root.setProperty('--emerald-icon', `url(${this.icons.emerald})`);

    this.buildHotbar();
    this.buildHearts();
    this.bindMenus();
    this.tooltip = this.$('#tooltip');
    document.addEventListener('mousemove', (e) => this.moveTooltip(e));
  }

  // ------------------------------------------------------------ menus
  bindMenus() {
    const g = this.game;
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        g.audio.unlock();
        g.audio.play('click');
        const a = btn.dataset.action;
        switch (a) {
          case 'play': g.newGame(); break;
          case 'howto': this.openSub('howto'); break;
          case 'options': this.openSub('options'); break;
          case 'back': this.show(this.returnTo); break;
          case 'resume': g.setPaused(false); break;
          case 'quit': g.toTitle(); break;
          case 'retry': g.newGame(); break;
          case 'title': g.toTitle(); break;
          case 'toggle-sound':
            g.audio.enabled = !g.audio.enabled;
            this.refreshOptions();
            break;
          case 'toggle-graphics':
            g.setFancy(!g.fancy);
            this.refreshOptions();
            break;
          case 'toggle-damage':
            this.showDamage = !this.showDamage;
            this.refreshOptions();
            break;
        }
      });
    });
    this.$('#start-wave-btn').addEventListener('click', () => {
      g.audio.unlock();
      g.startWave();
    });
    this.$('#panel .panel-close').addEventListener('click', () => g.selectSlot(null));
  }

  refreshOptions() {
    const g = this.game;
    this.$('[data-action="toggle-sound"]').textContent = `Sound: ${g.audio.enabled ? 'ON' : 'OFF'}`;
    this.$('[data-action="toggle-graphics"]').textContent = `Graphics: ${g.fancy ? 'Fancy' : 'Fast'}`;
    this.$('[data-action="toggle-damage"]').textContent = `Damage Numbers: ${this.showDamage ? 'ON' : 'OFF'}`;
  }

  openSub(name) {
    this.returnTo = this.current;
    if (name === 'howto') this.buildHowTo();
    if (name === 'options') this.refreshOptions();
    this.show(name);
  }

  /** name: 'loading' | 'title' | 'howto' | 'options' | 'pause' | 'gameover' | null */
  show(name) {
    this.current = name;
    for (const id of ['loading', 'title-screen', 'howto-screen', 'options-screen', 'pause-screen', 'gameover-screen']) {
      this.$(`#${id}`).classList.add('hidden');
    }
    const map = { loading: 'loading', title: 'title-screen', howto: 'howto-screen', options: 'options-screen', pause: 'pause-screen', gameover: 'gameover-screen' };
    if (name) this.$(`#${map[name]}`).classList.remove('hidden');
    const inGame = this.game.state !== 'title';
    this.$('#hud').classList.toggle('hidden', !inGame);
    if (!inGame || name === 'gameover') this.closePanel();
    this.hideTooltip();
  }

  setLoading(frac, msg) {
    this.$('.loading-fill').style.width = `${Math.round(frac * 100)}%`;
    if (msg) this.$('.loading-msg').textContent = msg;
  }

  buildHowTo() {
    const c = this.game.config;
    const G = c.game;
    const cpd = G.creditsPerDifficulty;
    const rules = [
      `Enemies march along the path toward your castle in <b>waves</b> that last <b>${fmtTime(G.waveDurationSeconds)}</b>.`,
      `Each wave brings more enemies, faster enemies and tougher enemy types.`,
      `You start with <b>${G.startingCredits} credits</b>. Earn more by killing enemies and surviving waves.`,
      `Kills pay <span class="diff-easy">${cpd.easy}</span> / <span class="diff-medium">${cpd.medium}</span> / <span class="diff-hard">${cpd.hard}</span> credits for easy / medium / hard enemies.`,
      `Build and upgrade defenses only <b>before a wave starts</b>.`,
      `Place defenses on the <b>6 field towers</b> or the <b>2 castle towers</b>.`,
      `Flaming ammo burns enemies for <b>${G.fire.durationSeconds}s</b> at <b>${G.fire.damagePerSecond} HP/s</b>.`,
      `The game ends when the castle's health reaches zero.`,
    ];
    this.$('#howto-rules').innerHTML = rules.map((r) => `<li>${r}</li>`).join('');
    this.$('#howto-enemies').innerHTML = ENEMY_TYPES.map((t) => {
      const e = c.enemies[t];
      return `<div class="info-row"><div class="mc-slot">${this.enemyIcons[t] ? `<img src="${this.enemyIcons[t]}">` : ''}</div>
        <div><div class="name">${e.name} <span class="diff-${e.difficulty}">(${e.difficulty})</span></div>
        ${e.hitpoints} HP &middot; ${e.castleDamage} castle damage &middot; ${cpd[e.difficulty]} credit${cpd[e.difficulty] > 1 ? 's' : ''}<br>${e.description || ''}</div></div>`;
    }).join('');
    this.$('#howto-defenses').innerHTML = DEF_TYPES.map((t) => {
      const d = c.defenses[t];
      return `<div class="info-row"><div class="mc-slot"><img src="${this.defenseIcons[t] || ''}"></div>
        <div><div class="name">${d.name} &middot; <span class="c-green">${d.cost} credits</span></div>
        ${d.damage} damage &middot; every ${d.fireInterval}s &middot; range ${d.range}${d.splashRadius ? ` &middot; splash ${d.splashRadius}` : ''}<br>${d.description || ''}</div></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ HUD
  buildHotbar() {
    const hb = this.$('#hotbar');
    const g = this.game;
    const slots = [
      { id: 'start', icon: 'play', tip: () => `<div class="tt-title">Start Wave ${g.waveNumber + (g.state === 'build' ? 0 : 0)}</div><div class="tt-gray">Space</div>`, act: () => g.startWave() },
      { id: 'speed1', icon: 'clock', count: '1', tip: () => '<div class="tt-title">Normal Speed</div><div class="tt-gray">Key 1</div>', act: () => g.setSpeed(1) },
      { id: 'speed2', icon: 'clock', count: '2', tip: () => '<div class="tt-title">Double Speed</div><div class="tt-gray">Key 2</div>', act: () => g.setSpeed(2) },
      { id: 'speed3', icon: 'clock', count: '3', tip: () => '<div class="tt-title">Triple Speed</div><div class="tt-gray">Key 3</div>', act: () => g.setSpeed(3) },
      { id: 'enemies', icon: 'skull', tip: () => `<div class="tt-title">Enemies on field</div><div class="tt-gray">${g.enemies.length} alive</div>` },
      { id: 'archer', def: 'archer', tip: () => this.defCountTip('archer') },
      { id: 'ballista', def: 'ballista', tip: () => this.defCountTip('ballista') },
      { id: 'catapult', def: 'catapult', tip: () => this.defCountTip('catapult') },
      { id: 'pause', icon: 'pause', tip: () => '<div class="tt-title">Pause</div><div class="tt-gray">Esc</div>', act: () => g.setPaused(true) },
    ];
    hb.innerHTML = '';
    this.hot = {};
    for (const s of slots) {
      const el = document.createElement('div');
      el.className = 'hot-slot';
      el.innerHTML = `<img src="${s.icon ? this.icons[s.icon] : ''}"><span class="count">${s.count || ''}</span>`;
      el.addEventListener('mouseenter', () => this.showTooltip(s.tip()));
      el.addEventListener('mouseleave', () => this.hideTooltip());
      if (s.act) el.addEventListener('click', () => {
        if (el.classList.contains('disabled')) return;
        g.audio.unlock();
        g.audio.play('click');
        s.act();
      });
      hb.appendChild(el);
      this.hot[s.id] = el;
    }
  }

  defCountTip(type) {
    const n = this.game.defenses.filter((d) => d.type === type).length;
    return `<div class="tt-title">${this.game.config.defenses[type].name}</div><div class="tt-gray">${n} built</div>`;
  }

  setDefenseIcons(icons) {
    this.defenseIcons = icons;
    for (const t of DEF_TYPES) this.hot[t].querySelector('img').src = icons[t];
  }

  buildHearts() {
    const h = this.$('#hearts');
    h.innerHTML = '';
    this.heartEls = [];
    for (let i = 0; i < 10; i++) {
      const img = document.createElement('img');
      img.src = this.icons.heart;
      h.appendChild(img);
      this.heartEls.push(img);
    }
  }

  setText(key, sel, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    this.$(sel).textContent = value;
  }

  updateHUD() {
    const g = this.game;
    const hpFrac = Math.max(0, g.castleHp / g.castleMaxHp);
    const hpKey = Math.ceil(g.castleHp);
    if (this.cache.hp !== hpKey) {
      this.cache.hp = hpKey;
      this.$('.bossbar-fill').style.width = `${hpFrac * 100}%`;
      this.$('.bossbar-title').textContent = `Castle  ${Math.max(0, hpKey)} / ${g.castleMaxHp}`;
      const halves = Math.ceil(hpFrac * 20);
      this.heartEls.forEach((img, i) => {
        const v = halves - i * 2;
        img.src = v >= 2 ? this.icons.heart : v === 1 ? this.icons.heartHalf : this.icons.heartEmpty;
      });
      this.$('#hearts').classList.toggle('low', hpFrac <= 0.25 && hpFrac > 0);
    }
    this.setText('credits', '#credits-val', String(g.credits));
    this.setText('wave', '#sb-wave', String(g.waveNumber));
    const inWave = g.state === 'wave';
    const overtime = inWave && g.waveTime <= 0;
    this.setText('timeLabel', '#sb-time-label', overtime ? 'Overtime' : 'Time');
    this.setText('time', '#sb-time', inWave ? (overtime ? '--' : fmtTime(g.waveTime)) : fmtTime(g.waveDuration));
    this.setText('enemies', '#sb-enemies', String(g.enemies.length + (inWave ? g.spawnQueue.length : 0)));
    this.setText('kills', '#sb-kills', String(g.kills));
    this.setText('defs', '#sb-defenses', String(g.defenses.length));

    const xp = inWave ? 1 - Math.max(0, g.waveTime) / g.waveDuration : 0;
    const xpKey = Math.round(xp * 400);
    if (this.cache.xp !== xpKey) {
      this.cache.xp = xpKey;
      this.$('#xpbar-fill').style.width = `${xp * 100}%`;
    }

    const btn = this.$('#start-wave-btn');
    const showBtn = g.state === 'build';
    btn.classList.toggle('hidden', !showBtn);
    this.setText('btn', '#start-wave-btn', `Start Wave ${g.waveNumber}`);

    let action = '';
    if (g.state === 'build') action = g.defenses.length === 0 ? 'Click a tower to build your first defense' : 'Click a tower to build or upgrade';
    else if (overtime) action = '<span class="c-red">Overtime!</span> Defeat the remaining enemies';
    else if (inWave && g.spawnQueue.length === 0 && g.enemies.length === 0) action = 'Field clear. Holding the line...';
    if (this.cache.action !== action) {
      this.cache.action = action;
      this.$('#actionbar').innerHTML = action;
    }

    this.hot.start.classList.toggle('disabled', g.state !== 'build');
    for (const n of [1, 2, 3]) this.hot[`speed${n}`].classList.toggle('selected', g.speed === n);
    for (const t of DEF_TYPES) {
      const n = g.defenses.filter((d) => d.type === t).length;
      const c = this.hot[t].querySelector('.count');
      const txt = n ? String(n) : '';
      if (c.textContent !== txt) c.textContent = txt;
      this.hot[t].classList.toggle('disabled', n === 0);
    }
    const ec = this.hot.enemies.querySelector('.count');
    const en = String(g.enemies.length || '');
    if (ec.textContent !== en) ec.textContent = en;

    if (this.panelSlot) this.refreshPanel();
  }

  bumpCredits() {
    const el = this.$('#credits');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  castleHit() {
    const el = this.$('#bossbar');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  chat(html) {
    const c = this.$('#chat');
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = html;
    c.appendChild(line);
    while (c.children.length > 8) c.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), 7000);
    setTimeout(() => line.remove(), 8200);
  }

  clearChat() {
    this.$('#chat').innerHTML = '';
  }

  showTitle(main, sub = '', ms = 2600) {
    const t = this.$('#title-text');
    t.querySelector('.tt-main').innerHTML = main;
    t.querySelector('.tt-sub').innerHTML = sub;
    t.classList.add('show');
    clearTimeout(this.titleTimer);
    this.titleTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------ floaters
  floatText(pos, text, cls, rise = 1.2, life = 1.1) {
    if (this.floaters.length > 80) {
      const f = this.floaters.shift();
      f.el.remove();
    }
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.$('#floaters').appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), life: 0, maxLife: life, rise });
  }

  clearFloaters() {
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
  }

  update(dt, camera) {
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    this.floaters = this.floaters.filter((f) => {
      f.life += dt;
      if (f.life >= f.maxLife) {
        f.el.remove();
        return false;
      }
      f.pos.y += f.rise * dt;
      v.copy(f.pos).project(camera);
      f.el.style.left = `${((v.x + 1) / 2) * w}px`;
      f.el.style.top = `${((1 - v.y) / 2) * h}px`;
      f.el.style.opacity = String(Math.min(1, 2.5 * (1 - f.life / f.maxLife)));
      return true;
    });
  }

  // ------------------------------------------------------------ tooltip
  showTooltip(html) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
  }
  hideTooltip() {
    this.tooltip?.classList.add('hidden');
  }
  moveTooltip(e) {
    if (!this.tooltip || this.tooltip.classList.contains('hidden')) return;
    const r = this.tooltip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - 10 - r.height;
    if (x + r.width > window.innerWidth - 4) x = e.clientX - r.width - 14;
    if (y < 4) y = e.clientY + 18;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  // ------------------------------------------------------------ tower panel
  openSlot(slot) {
    this.panelSlot = slot;
    this.panelSig = '';
    this.$('#panel').classList.remove('hidden');
    this.refreshPanel();
  }

  closePanel() {
    this.panelSlot = null;
    this.$('#panel').classList.add('hidden');
    this.hideTooltip();
  }

  costHtml(cost) {
    const can = this.game.credits >= cost;
    return `<span class="cost ${can ? '' : 'cant'}"><span class="credit-icon"></span>${cost}</span>`;
  }

  refreshPanel() {
    const slot = this.panelSlot;
    if (!slot) return;
    const g = this.game;
    const d = slot.defense;
    const sig = `${slot.id}|${g.credits}|${g.state}|${d ? d.type + JSON.stringify(d.levels) : '-'}`;
    if (sig === this.panelSig) return;
    this.panelSig = sig;
    const canShop = g.state === 'build';
    this.$('#panel .panel-title').textContent = slot.label;
    const body = this.$('#panel .panel-body');
    const cfg = g.config.defenses;
    let html = '';
    if (!d) {
      html += canShop
        ? '<div class="panel-note">Choose a defense to build on this tower:</div>'
        : '<div class="panel-note warn">Defenses can only be built between waves.</div>';
      for (const t of DEF_TYPES) {
        const c = cfg[t];
        const ok = canShop && g.credits >= c.cost;
        html += `<div class="shop-row" data-type="${t}">
          <div class="mc-slot"><img src="${this.defenseIcons[t] || ''}"></div>
          <div class="row-main"><div class="row-name">${c.name}</div><div class="row-desc">${this.costHtml(c.cost)}</div></div>
          <button class="mc-btn small" data-buy="${t}" ${ok ? '' : 'disabled'}>Build</button>
        </div>`;
      }
    } else {
      const c = cfg[d.type];
      const count = d.type === 'archer' ? d.archers.length : '';
      html += `<div class="defense-head">
          <div class="mc-slot big"><img src="${this.defenseIcons[d.type] || ''}"><span class="count">${count}</span></div>
          <div><div class="row-name">${c.name}</div><div class="row-desc">Invested: ${d.spent} credits</div></div>
        </div>
        <div class="stats">${d.stats().map((s) => `<div><span>${s.k}</span><span>${s.v}</span></div>`).join('')}</div>
        <div class="panel-section">Upgrades</div>`;
      if (!canShop) html += '<div class="panel-note warn">Upgrades are available between waves.</div>';
      for (const [key, up] of Object.entries(c.upgrades)) {
        const lvl = d.levels[key];
        const maxed = lvl >= up.maxLevel;
        const ok = canShop && !maxed && g.credits >= up.cost;
        const pips = Array.from({ length: up.maxLevel }, (_, i) => `<div class="pip ${i < lvl ? 'on' : ''}"></div>`).join('');
        html += `<div class="upgrade-row" data-up="${key}">
          <div class="mc-slot"><img src="${this.icons[UPGRADE_ICON[key]] || this.icons.plus}"></div>
          <div class="row-main"><div class="row-name">${up.name}</div><div class="pips">${pips}</div></div>
          ${maxed ? '<button class="mc-btn small" disabled>MAX</button>' : `<button class="mc-btn small" data-upgrade="${key}" ${ok ? '' : 'disabled'}>${this.costHtml(up.cost)}</button>`}
        </div>`;
      }
    }
    body.innerHTML = html;
    this.hideTooltip();

    body.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => g.buyDefense(slot, b.dataset.buy)));
    body.querySelectorAll('[data-upgrade]').forEach((b) => b.addEventListener('click', () => g.upgradeDefense(slot, b.dataset.upgrade)));
    body.querySelectorAll('.shop-row').forEach((row) => {
      const t = row.dataset.type;
      row.addEventListener('mouseenter', () => {
        const c = cfg[t];
        g.showRange(slot, c.range);
        const ups = Object.values(c.upgrades).map((u) => u.name).join(', ');
        this.showTooltip(`<div class="tt-title">${c.name}</div>
          <div class="tt-gray">${c.description || ''}</div>
          <div class="tt-blue">${c.damage} damage${t === 'catapult' ? ' (area)' : ''}</div>
          <div class="tt-blue">Fires every ${c.fireInterval}s</div>
          <div class="tt-blue">Range ${c.range}${c.splashRadius ? `, splash ${c.splashRadius}` : ''}</div>
          <div class="tt-gold">Upgrades: ${ups}</div>
          <div class="tt-green">Cost: ${c.cost} credits</div>`);
      });
      row.addEventListener('mouseleave', () => {
        g.showRange(slot, null);
        this.hideTooltip();
      });
    });
    body.querySelectorAll('.upgrade-row').forEach((row) => {
      const key = row.dataset.up;
      const up = cfg[d.type].upgrades[key];
      row.addEventListener('mouseenter', () => {
        const lvl = d.levels[key];
        this.showTooltip(`<div class="tt-title">${up.name}</div>
          <div class="tt-gray">${up.description || ''}</div>
          <div class="tt-blue">Level ${lvl} / ${up.maxLevel}</div>
          ${lvl < up.maxLevel ? `<div class="tt-green">Cost: ${up.cost} credits</div>` : '<div class="tt-gold">Fully upgraded</div>'}`);
      });
      row.addEventListener('mouseleave', () => this.hideTooltip());
    });
  }
}
