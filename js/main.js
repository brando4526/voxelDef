import { Game } from './game.js';

async function boot() {
  const msg = document.querySelector('.loading-msg');
  let config;
  try {
    const res = await fetch('data/config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch (err) {
    msg.innerHTML = `Could not load <b>data/config.json</b> (${err.message}).<br>Serve this folder with any static web server, e.g. <b>npx serve</b> or <b>python -m http.server</b>.`;
    console.error(err);
    return;
  }
  const game = new Game(config, document.getElementById('game'));
  window.voxelDefense = game; // handy for tweaking from the console
  try {
    await game.init();
  } catch (err) {
    msg.textContent = `Failed to start: ${err.message}`;
    console.error(err);
  }
}

boot();
