import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { createBackground } from './background.js';
import { initYoutubePlayer, playerReady } from './yt_player.js';

const loadingEl = document.getElementById('loading');

let data;
try {
  const res = await fetch(`${import.meta.env.BASE_URL}spotify_clustered_3d.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  data = await res.json();
} catch (err) {
  if (loadingEl) loadingEl.textContent = `Loading error: ${err.message}`;
  throw err;
}
loadingEl?.remove();

const TOTAL_POINTS = data.length; // everything served; the slider caps how many render

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 65;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Keep the camera within range of the cloud (which spans roughly ±50 units).
controls.minDistance = 15;
controls.maxDistance = 150;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

const YT_API_KEY = import.meta.env.VITE_YT_API_KEY;
if (!YT_API_KEY) {
  console.warn("VITE_YT_API_KEY missing: copy .env.example to .env and set your key.");
}

initYoutubePlayer();

const clusterColors = [
  0x9e0142, 0xd53e4f, 0xf46d43, 0xfdae61, 0xfee08b,
  0xe6f598, 0xabdda4, 0x66c2a5, 0x3288bd, 0x5e4fa2
];

// --- Instances: positions/colors set once; the float + flicker animation and the
// selection highlight run entirely on the GPU (a uTime/uSelected uniform), so the
// per-frame CPU cost is flat regardless of how many spheres are shown. ---
const geometry = new THREE.SphereGeometry(0.1, 6, 6);
const ids = new Float32Array(TOTAL_POINTS).map((_, i) => i);
geometry.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));

const uTime = { value: 0 };
const uSelected = { value: -1 };
const material = new THREE.MeshBasicMaterial();
material.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = uTime;
  shader.uniforms.uSelected = uSelected;

  shader.vertexShader =
    'uniform float uTime;\nuniform float uSelected;\nattribute float aId;\nvarying float vFlicker;\nvarying float vSel;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        'vSel = (abs(aId - uSelected) < 0.5) ? 1.0 : 0.0;',
        'transformed *= mix(1.0, 2.6, vSel);',        // enlarge the selected sphere
        'transformed.y += sin(uTime + aId) * 0.05;',  // vertical floating
        'vFlicker = 0.1 * sin(uTime * 4.0 + aId);',   // brightness flicker
      ].join('\n')
    );

  shader.fragmentShader =
    'varying float vFlicker;\nvarying float vSel;\n' +
    shader.fragmentShader.replace(
      '#include <color_fragment>',
      [
        '#include <color_fragment>',
        'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFlicker);', // flicker (may extrapolate)
        'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vSel);',     // pure white when selected
      ].join('\n')
    );
};

const instancedMesh = new THREE.InstancedMesh(geometry, material, TOTAL_POINTS);
scene.add(instancedMesh);

const dummy = new THREE.Object3D();
const songData = [];

data.forEach((track, i) => {
  dummy.position.set(track.x, track.y, track.z);
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
  instancedMesh.setColorAt(i, new THREE.Color(clusterColors[track.cluster % clusterColors.length]));

  songData.push({
    x: track.x,
    y: track.y,
    z: track.z,
    artist: track.artist_name || "Unknown Artist",
    title: track.track_name   || "Unknown track",
    genre: track.genre        || "Unknown genre"
  });
});
instancedMesh.instanceMatrix.needsUpdate = true;
instancedMesh.instanceColor.needsUpdate = true;

// --- Picking (depth-aware raycast against the InstancedMesh) ---
// intersectObject only tests active instances (respects instancedMesh.count) and returns
// hits sorted by distance, so the front-most visible sphere wins (occlusion handled).
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function raycastInstance(clientX, clientY) {
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(instancedMesh)[0];
  return hit ? hit.instanceId : null;
}

// Touch: a fingertip rarely lands a single ray on a sphere this small, so probe a few
// offsets around the tap (center first, then outward) and take the first hit.
const TOUCH_PROBES = [
  [0, 0],
  [12, 0], [-12, 0], [0, 12], [0, -12], [9, 9], [-9, 9], [9, -9], [-9, -9],
  [24, 0], [-24, 0], [0, 24], [0, -24], [17, 17], [-17, 17], [17, -17], [-17, -17],
];
function pickTouch(clientX, clientY) {
  for (const [ox, oy] of TOUCH_PROBES) {
    const id = raycastInstance(clientX + ox, clientY + oy);
    if (id !== null) return id;
  }
  return null;
}

// --- Tooltip (anchored to the upper-right of the cursor) ---
let labelIndex = null;
// The last clicked sphere stays highlighted indefinitely (until another is clicked).
// Hover highlights transiently; when hover ends the highlight returns to this.
let selectedIndex = -1;
const TOOLTIP_OFFSET_PX = 14;
const tooltip = document.createElement('div');
tooltip.className = 'label';
document.body.appendChild(tooltip);

function showLabel(index, clientX, clientY) {
  if (index !== labelIndex) {
    const track = songData[index];
    tooltip.textContent = `${track.artist} - ${track.title}, ${track.genre}`;
    labelIndex = index;
    uSelected.value = index; // drives the GPU highlight
  }
  tooltip.style.left = `${clientX + TOOLTIP_OFFSET_PX}px`;
  tooltip.style.top = `${clientY - TOOLTIP_OFFSET_PX}px`;
  tooltip.classList.add('visible');
}

function hideLabel() {
  if (labelIndex === null) return;
  labelIndex = null;
  // Fall back to the persistent click selection instead of clearing the highlight.
  uSelected.value = selectedIndex;
  tooltip.classList.remove('visible');
}

// --- "My Songs" panel: now-playing header + a collapsible play history.
// The YouTube iframe itself stays hidden; this panel is the only player UI. ---
const HISTORY_KEY = 'artisticdataviz.history';
const FAVORITES_KEY = 'artisticdataviz.favorites';
const HISTORY_MAX = 50;

let currentTrack = null;
let history = [];
let favorites = [];
try {
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY));
  if (Array.isArray(saved)) history = saved.slice(0, HISTORY_MAX);
} catch { /* ignore corrupt/blocked storage */ }
try {
  const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY));
  if (Array.isArray(saved)) favorites = saved;
} catch { /* ignore corrupt/blocked storage */ }

const nowPlaying = document.createElement('div');
nowPlaying.className = 'ui-pill';
nowPlaying.id = 'nowplaying';
nowPlaying.innerHTML =
  '<button class="np-collapse" type="button" title="Collapse">×</button>' +
  '<div class="np-body">' +
    '<div class="np-main">' +
      '<div class="np-text">' +
        '<span class="np-now">My Songs</span>' +
        '<span class="np-default">Browse and select any point!</span>' +
        '<span class="np-title"></span>' +
        '<span class="np-artist"></span>' +
        '<span class="np-genre"></span>' +
      '</div>' +
      '<div class="np-buttons">' +
        '<button class="np-playpause" type="button" title="Play / Pause"></button>' +
        '<button class="np-copy" type="button">⧉</button>' +
        '<button class="np-star" type="button" title="Add to favorites">☆</button>' +
      '</div>' +
    '</div>' +
    '<button class="np-favorites-toggle" type="button"></button>' +
    '<div class="np-favorites"></div>' +
    '<button class="np-history-toggle" type="button"></button>' +
    '<div class="np-history"></div>' +
  '</div>';
document.body.appendChild(nowPlaying);
nowPlaying.classList.add('visible');
const npCollapse = nowPlaying.querySelector('.np-collapse');
const npBody = nowPlaying.querySelector('.np-body');
const npNow = nowPlaying.querySelector('.np-now');
const npDefault = nowPlaying.querySelector('.np-default');
const npTitle = nowPlaying.querySelector('.np-title');
const npArtist = nowPlaying.querySelector('.np-artist');
const npGenre = nowPlaying.querySelector('.np-genre');
const npButtons = nowPlaying.querySelector('.np-buttons');
const npPlayPause = nowPlaying.querySelector('.np-playpause');
const npCopy = nowPlaying.querySelector('.np-copy');
const npStar = nowPlaying.querySelector('.np-star');
const npFavoritesToggle = nowPlaying.querySelector('.np-favorites-toggle');
const npFavorites = nowPlaying.querySelector('.np-favorites');
const npHistoryToggle = nowPlaying.querySelector('.np-history-toggle');
const npHistory = nowPlaying.querySelector('.np-history');

// Initially hide the track info and buttons (shown on first play)
npButtons.style.display = 'none';

// Collapse/expand toggle
npCollapse.addEventListener('click', () => {
  const collapsed = nowPlaying.classList.toggle('collapsed');
  npCollapse.textContent = collapsed ? '♫' : '×';
});

// Text-presentation (U+FE0E) variants so the control renders as the same monochrome
// glyph as on desktop, instead of a colored emoji on mobile (Android default).
const ICON_PAUSE = '⏸︎';
const ICON_PLAY = '▶︎';
npPlayPause.textContent = ICON_PAUSE;

let ytPlayer = null;
playerReady.then((p) => {
  ytPlayer = p;
  ytPlayer.setVolume(currentVolume); // apply the chosen volume (default 50%) once ready
});

npPlayPause.addEventListener('click', () => {
  if (!ytPlayer) return;
  // 1 === YT.PlayerState.PLAYING
  if (ytPlayer.getPlayerState() === 1) {
    ytPlayer.pauseVideo();
    npPlayPause.textContent = ICON_PLAY;
  } else {
    ytPlayer.playVideo();
    npPlayPause.textContent = ICON_PAUSE;
  }
});

// Flash the header copy button (used both for the now-playing track and after a
// history-row copy, since a history click also makes that track the now-playing one).
async function copyLink(videoId) {
  if (!videoId) return;
  try {
    await navigator.clipboard.writeText(`https://youtu.be/${videoId}`);
    npCopy.textContent = '✓';
    setTimeout(() => { npCopy.textContent = '⧉'; }, 1500);
  } catch (err) {
    console.error("Copy failed:", err);
  }
}

npCopy.addEventListener('click', () => copyLink(currentTrack?.videoId));

// --- Star button: toggle the currently playing track in/out of favorites ---
npStar.addEventListener('click', () => {
  if (!currentTrack) return;
  toggleFavorite(currentTrack);
});

// --- Favorites & History: collapse/expand with mutual exclusion ---
let favoritesOpen = false;
let historyOpen = false;
renderFavorites();
renderHistory();

npFavoritesToggle.addEventListener('click', () => {
  favoritesOpen = !favoritesOpen;
  if (favoritesOpen) historyOpen = false;
  renderFavorites();
  renderHistory();
});

npHistoryToggle.addEventListener('click', () => {
  historyOpen = !historyOpen;
  if (historyOpen) favoritesOpen = false;
  renderFavorites();
  renderHistory();
});

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* storage blocked */ }
}

function saveFavorites() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* storage blocked */ }
}

function isFavorite(videoId) {
  return favorites.some((f) => f.videoId === videoId);
}

function addToFavorites(item) {
  if (isFavorite(item.videoId)) return;
  favorites.unshift({ title: item.title, artist: item.artist, genre: item.genre, videoId: item.videoId });
  saveFavorites();
  updateStarButton();
  renderFavorites();
  renderHistory();
}

function removeFromFavorites(videoId) {
  favorites = favorites.filter((f) => f.videoId !== videoId);
  saveFavorites();
  updateStarButton();
  renderFavorites();
  renderHistory();
}

function toggleFavorite(item) {
  if (isFavorite(item.videoId)) removeFromFavorites(item.videoId);
  else addToFavorites(item);
}

function updateStarButton() {
  npStar.textContent = (currentTrack && isFavorite(currentTrack.videoId)) ? '★' : '☆';
}

// On mobile, cap a list to 5 visible rows (the rest scroll). Measured from the
// 5th row's bottom so wrapped (2-line) titles still count as one item. On desktop
// the inline cap is cleared so the stylesheet's max-height applies.
const LIST_MOBILE_MAX_W = 600;
const LIST_VISIBLE_ROWS = 5;
function clampList(container) {
  container.style.maxHeight = '';
  if (window.innerWidth > LIST_MOBILE_MAX_W) return;
  const rows = container.children;
  if (rows.length <= LIST_VISIBLE_ROWS) return;
  const top = container.getBoundingClientRect().top;
  const last = rows[LIST_VISIBLE_ROWS - 1].getBoundingClientRect();
  container.style.maxHeight = `${Math.ceil(last.bottom - top)}px`;
}

function renderFavorites() {
  npFavoritesToggle.style.display = favorites.length ? '' : 'none';
  npFavoritesToggle.textContent = `Favorites · ${favorites.length} ${favoritesOpen ? '⌃' : '⌄'}`;
  nowPlaying.classList.toggle('favorites-open', favoritesOpen && favorites.length > 0);
  if (!favoritesOpen || !favorites.length) { npFavorites.innerHTML = ''; return; }

  npFavorites.innerHTML = '';
  favorites.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'hist-row';
    row.innerHTML =
      '<span class="hist-i">★</span>' +
      '<span class="hist-t"></span><span class="hist-a"></span>' +
      '<button class="hist-del" type="button" title="Remove from favorites" aria-label="Remove from favorites">✕</button>';
    row.querySelector('.hist-t').textContent = item.title;
    row.querySelector('.hist-a').textContent = ` · ${item.artist}`;
    row.addEventListener('click', () => playFromHistory(item));
    row.querySelector('.hist-del').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromFavorites(item.videoId);
    });
    npFavorites.appendChild(row);
  });
  clampList(npFavorites);
}

function renderHistory() {
  npHistoryToggle.style.display = history.length ? '' : 'none';
  npHistoryToggle.textContent = `History · ${history.length} ${historyOpen ? '⌃' : '⌄'}`;
  nowPlaying.classList.toggle('history-open', historyOpen && history.length > 0);
  if (!historyOpen || !history.length) { npHistory.innerHTML = ''; return; }

  npHistory.innerHTML = '';
  history.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const starred = isFavorite(item.videoId);
    row.innerHTML =
      '<span class="hist-i">♪</span>' +
      '<span class="hist-t"></span><span class="hist-a"></span>' +
      `<button class="hist-fav" type="button" title="${starred ? 'Remove from favorites' : 'Add to favorites'}">${starred ? '★' : '☆'}</button>` +
      '<button class="hist-del" type="button" title="Remove" aria-label="Remove from history">✕</button>';
    row.querySelector('.hist-t').textContent = item.title;
    row.querySelector('.hist-a').textContent = ` · ${item.artist}`;
    row.addEventListener('click', () => playFromHistory(item));
    row.querySelector('.hist-fav').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(item);
    });
    row.querySelector('.hist-del').addEventListener('click', (e) => {
      e.stopPropagation();
      history = history.filter((h) => h.videoId !== item.videoId);
      saveHistory();
      renderHistory();
    });
    npHistory.appendChild(row);
  });
  clampList(npHistory);
}

// Re-measure the open list when the viewport changes (rotation, breakpoint cross).
window.addEventListener('resize', () => {
  if (favoritesOpen) clampList(npFavorites);
  if (historyOpen) clampList(npHistory);
});

// Set the now-playing header. Any track being displaced moves into the history
// (deduped, capped); the incoming track is removed from the list so it never appears twice.
function setNowPlaying(track, videoId) {
  if (currentTrack && currentTrack.videoId !== videoId) {
    history = history.filter((h) => h.videoId !== currentTrack.videoId);
    history.unshift(currentTrack);
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  }
  history = history.filter((h) => h.videoId !== videoId);
  currentTrack = { title: track.title, artist: track.artist, genre: track.genre, videoId };

  npNow.style.display = 'none';
  npDefault.style.display = 'none';
  npButtons.style.display = '';
  npTitle.textContent = track.title;
  npArtist.textContent = track.artist;
  npGenre.textContent = track.genre;
  npPlayPause.textContent = ICON_PAUSE;
  updateStarButton();

  saveHistory();
  renderFavorites();
  renderHistory();
}

async function playFromHistory(item) {
  const player = await playerReady;
  player.loadVideoById(item.videoId);
  setNowPlaying(item, item.videoId);
}

async function playTrack(index) {
  const track = songData[index];
  const query = encodeURIComponent(`${track.artist} ${track.title}`);
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${query}&key=${YT_API_KEY}`);
    const json = await res.json();
    const videoId = json.items?.[0]?.id?.videoId;
    if (videoId) {
      const player = await playerReady;
      player.loadVideoById(videoId);
      setNowPlaying(track, videoId);
    } else {
      alert("Video not found.");
    }
  } catch (err) {
    console.error("YouTube search error:", err);
  }
}

// --- Pointer input (mouse + touch + pen, unified) ---
const DRAG_THRESHOLD_PX = 6;
const canvas = renderer.domElement;
let pressX = 0;
let pressY = 0;
let hoverX = 0;
let hoverY = 0;
let hoverDirty = false;

canvas.addEventListener('pointerdown', (e) => {
  pressX = e.clientX;
  pressY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  // Ignore the end of a drag (rotation); only a genuine tap/click selects.
  if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > DRAG_THRESHOLD_PX) return;
  const index = e.pointerType === 'touch'
    ? pickTouch(e.clientX, e.clientY)
    : raycastInstance(e.clientX, e.clientY);
  if (index === null) { hideLabel(); return; } // tap on empty space dismisses the tooltip (selection stays)
  selectedIndex = index; // persist the highlight on the clicked sphere
  showLabel(index, e.clientX, e.clientY);
  playTrack(index);
});

// Hover only flags the position; the raycast itself runs at most once per frame
// (cheap even at 45k instances) — see the animation loop.
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') {
    // Touch/pen have no hover: a tap shows the tooltip, but moving the view
    // afterwards should dismiss it (it would otherwise linger at the old spot).
    hideLabel();
    return;
  }
  if (e.buttons !== 0) return;
  hoverX = e.clientX;
  hoverY = e.clientY;
  hoverDirty = true;
});

// --- Sphere-count control (chip ⇄ panel) ---
// "Capacity" is shown as a percentage of the full dataset (2 decimals).
const pct = (n) => (n / TOTAL_POINTS * 100).toFixed(2);

let currentCount = Math.round(TOTAL_POINTS * 0.5); // default: 50% of the dataset

const chip = document.createElement('div');
chip.className = 'ui-pill';
chip.id = 'sphere-chip';
chip.textContent = '⚙ Settings'; // static when collapsed; the capacity % lives in the panel
document.body.appendChild(chip);

const panel = document.createElement('div');
panel.className = 'ui-pill';
panel.id = 'sphere-panel';
panel.innerHTML =
  '<div class="sp-row"><span>Capacity: <b class="sp-count"></b></span><button class="sp-close" type="button">×</button></div>' +
  `<input class="sp-range" type="range" min="500" max="${TOTAL_POINTS}" step="100">` +
  '<div class="sp-row"><span>Volume: <b class="sp-vol"></b></span></div>' +
  '<input class="sp-volume" type="range" min="0" max="100" step="1">';
document.body.appendChild(panel);
const spCount = panel.querySelector('.sp-count');
const range = panel.querySelector('.sp-range');
const spVol = panel.querySelector('.sp-vol');
const volRange = panel.querySelector('.sp-volume');

chip.addEventListener('click', () => { panel.classList.add('open'); chip.style.display = 'none'; });
panel.querySelector('.sp-close').addEventListener('click', () => { panel.classList.remove('open'); chip.style.display = ''; });

function applyCount(n) {
  currentCount = Math.max(500, Math.min(TOTAL_POINTS, Math.round(n)));
  instancedMesh.count = currentCount;
  range.value = currentCount;
  spCount.textContent = `${pct(currentCount)}%`;
}

range.addEventListener('input', () => applyCount(+range.value));
applyCount(currentCount);

// --- Volume control (drives the hidden YouTube player; default 50%, not persisted) ---
let currentVolume = 50;
function applyVolume(v) {
  currentVolume = Math.max(0, Math.min(100, Math.round(v)));
  volRange.value = currentVolume;
  spVol.textContent = `${currentVolume}%`;
  if (ytPlayer) { ytPlayer.unMute(); ytPlayer.setVolume(currentVolume); }
}
volRange.addEventListener('input', () => applyVolume(+volRange.value));
applyVolume(currentVolume);

// --- Render loop ---
const animate = () => {
  requestAnimationFrame(animate);
  const now = performance.now();
  controls.update();
  uTime.value = now * 0.001;

  // Hover pick: at most once per frame (bounds raycast cost at high instance counts).
  if (hoverDirty) {
    hoverDirty = false;
    const index = raycastInstance(hoverX, hoverY);
    if (index === null) hideLabel();
    else showLabel(index, hoverX, hoverY);
  }

  renderer.autoClear = false;
  renderer.clear();
  renderer.render(bgScene, bgCamera);
  renderer.render(scene, camera);
};

const { bgScene, bgCamera } = createBackground();
animate();
