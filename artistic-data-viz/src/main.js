import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { createBackground } from './background.js';
import { initYoutubePlayer, playerReady } from './yt_player.js';

// ===== TEMP diagnostic harness (mobile white-screen). Remove after diagnosis. =====
const dbgEl = document.createElement('div');
dbgEl.style.cssText =
  'position:fixed;top:0;left:0;right:0;z-index:9999;max-height:60%;overflow:auto;' +
  'background:rgba(0,0,0,.82);color:#5f5;font:12px/1.45 monospace;padding:6px 8px;white-space:pre-wrap;';
document.body.appendChild(dbgEl);
const dbg = (m) => { dbgEl.textContent += m + '\n'; };
const fatal = (m) => { dbgEl.style.color = '#f66'; dbg('FATAL: ' + m); };
window.addEventListener('error', (e) =>
  fatal(`${e.message || ''} @ ${(e.filename || '').split('/').pop()}:${e.lineno || ''}` + (e.error?.stack ? '\n' + e.error.stack : '')));
window.addEventListener('unhandledrejection', (e) =>
  fatal('promise: ' + (e.reason?.message || e.reason) + (e.reason?.stack ? '\n' + e.reason.stack : '')));
const _consoleError = console.error.bind(console);
console.error = (...a) => { fatal('console.error: ' + a.map((x) => x?.message || String(x)).join(' ')); _consoleError(...a); };
dbg('ua: ' + navigator.userAgent.slice(0, 60));
dbg('dpr: ' + window.devicePixelRatio + ' | vw: ' + window.innerWidth + 'x' + window.innerHeight);
dbg('boot ok');
// ===== end diagnostic harness =====

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
dbg('data ok: ' + TOTAL_POINTS + ' points');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 65;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
dbg('renderer ok | webgl2=' + renderer.capabilities.isWebGL2 +
    ' maxTex=' + renderer.capabilities.maxTextureSize +
    ' maxAttr=' + renderer.capabilities.maxAttributes);
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fatal('WEBGL CONTEXT LOST'); });

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
dbg('instancedMesh allocated (' + TOTAL_POINTS + ')');

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
dbg('instances filled');

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
  uSelected.value = -1;
  tooltip.classList.remove('visible');
}

// --- "Now playing" banner + copy (the YouTube iframe itself is hidden) ---
let currentVideoId = null;
const nowPlaying = document.createElement('div');
nowPlaying.className = 'ui-pill';
nowPlaying.id = 'nowplaying';
nowPlaying.innerHTML =
  '<div class="np-text">' +
    '<span class="np-now">Now playing:</span>' +
    '<span class="np-title"></span>' +
    '<span class="np-artist"></span>' +
    '<span class="np-genre"></span>' +
  '</div>' +
  '<div class="np-buttons">' +
    '<button class="np-playpause" type="button" title="Play / Pause">⏸</button>' +
    '<button class="np-copy" type="button">⧉ Link</button>' +
  '</div>';
document.body.appendChild(nowPlaying);
const npTitle = nowPlaying.querySelector('.np-title');
const npArtist = nowPlaying.querySelector('.np-artist');
const npGenre = nowPlaying.querySelector('.np-genre');
const npPlayPause = nowPlaying.querySelector('.np-playpause');
const npCopy = nowPlaying.querySelector('.np-copy');

let ytPlayer = null;
playerReady.then((p) => { ytPlayer = p; });

npPlayPause.addEventListener('click', () => {
  if (!ytPlayer) return;
  // 1 === YT.PlayerState.PLAYING
  if (ytPlayer.getPlayerState() === 1) {
    ytPlayer.pauseVideo();
    npPlayPause.textContent = '▶';
  } else {
    ytPlayer.playVideo();
    npPlayPause.textContent = '⏸';
  }
});

npCopy.addEventListener('click', async () => {
  if (!currentVideoId) return;
  try {
    await navigator.clipboard.writeText(`https://youtu.be/${currentVideoId}`);
    npCopy.textContent = 'Copied!';
    setTimeout(() => { npCopy.textContent = '⧉ Link'; }, 1500);
  } catch (err) {
    console.error("Copy failed:", err);
  }
});

function showNowPlaying(track, videoId) {
  currentVideoId = videoId;
  npTitle.textContent = track.title;
  npArtist.textContent = track.artist;
  npGenre.textContent = track.genre;
  npPlayPause.textContent = '⏸'; // a freshly loaded track auto-plays
  nowPlaying.classList.add('visible');
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
      showNowPlaying(track, videoId);
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
  if (index === null) { hideLabel(); return; } // tap on empty space dismisses
  showLabel(index, e.clientX, e.clientY);
  playTrack(index);
});

// Hover only flags the position; the raycast itself runs at most once per frame
// (cheap even at 45k instances) — see the animation loop.
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
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
  `<input class="sp-range" type="range" min="500" max="${TOTAL_POINTS}" step="100">`;
document.body.appendChild(panel);
const spCount = panel.querySelector('.sp-count');
const range = panel.querySelector('.sp-range');

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
dbg('initial count = ' + currentCount + ' (' + pct(currentCount) + '%)');

// --- Render loop ---
let firstFrame = true;
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

  if (firstFrame) { firstFrame = false; dbg('first frame rendered ✓'); }
};

const { bgScene, bgCamera } = createBackground();
animate();
