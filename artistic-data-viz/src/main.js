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
  if (loadingEl) loadingEl.textContent = `Erreur de chargement : ${err.message}`;
  throw err;
}
loadingEl?.remove();

const TOTAL_POINTS = data.length; // everything served; the slider/governor cap what renders

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
  console.warn("VITE_YT_API_KEY manquante : copie .env.example vers .env et renseigne ta clé.");
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
    '<span class="np-now">Now playing :</span>' +
    '<span class="np-title"></span>' +
    '<span class="np-artist"></span>' +
    '<span class="np-genre"></span>' +
  '</div>' +
  '<div class="np-buttons">' +
    '<button class="np-playpause" type="button" title="Lecture / Pause">⏸</button>' +
    '<button class="np-copy" type="button">⧉ Lien</button>' +
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
    npCopy.textContent = 'Copié !';
    setTimeout(() => { npCopy.textContent = '⧉ Lien'; }, 1500);
  } catch (err) {
    console.error("Copie impossible :", err);
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
      alert("Vidéo non trouvée.");
    }
  } catch (err) {
    console.error("Erreur recherche YouTube :", err);
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

// --- Sphere-count control (chip ⇄ panel) + adaptive FPS governor ---
// Shown as a percentage of the full dataset ("Capacity"), 2 decimals.
const pct = (n) => (n / TOTAL_POINTS * 100).toFixed(2);

let maxAllowed = Math.min(TOTAL_POINTS, 6000); // conservative start; governor adjusts up/down
let currentCount = maxAllowed;
let autoMode = true;

const chip = document.createElement('div');
chip.className = 'ui-pill';
chip.id = 'sphere-chip';
chip.textContent = '⚙ Settings'; // static when collapsed; the capacity % lives in the panel
document.body.appendChild(chip);

const panel = document.createElement('div');
panel.className = 'ui-pill';
panel.id = 'sphere-panel';
panel.innerHTML =
  '<div class="sp-row"><span>Capacity : <b class="sp-count"></b></span><button class="sp-close" type="button">×</button></div>' +
  '<input class="sp-range" type="range" min="500" step="100">' +
  '<label class="sp-auto"><input class="sp-autocb" type="checkbox" checked> Auto (perf)</label>';
document.body.appendChild(panel);
const spCount = panel.querySelector('.sp-count');
const range = panel.querySelector('.sp-range');
const autoCb = panel.querySelector('.sp-autocb');

chip.addEventListener('click', () => { panel.classList.add('open'); chip.style.display = 'none'; });
panel.querySelector('.sp-close').addEventListener('click', () => { panel.classList.remove('open'); chip.style.display = ''; });

function refreshLabels() {
  spCount.textContent = `${pct(currentCount)}%`;
}

function applyCount(n) {
  currentCount = Math.max(500, Math.min(maxAllowed, Math.round(n)));
  instancedMesh.count = currentCount;
  range.value = currentCount;
  refreshLabels();
}

function refreshBounds() {
  range.max = maxAllowed;
  if (currentCount > maxAllowed) applyCount(maxAllowed);
  else refreshLabels();
}

range.addEventListener('input', () => {
  autoMode = false;
  autoCb.checked = false;
  range.disabled = false;
  applyCount(+range.value);
});

autoCb.addEventListener('change', () => {
  autoMode = autoCb.checked;
  range.disabled = autoMode;
  if (autoMode) applyCount(maxAllowed);
});

range.disabled = autoMode;
applyCount(currentCount);

// FPS governor: keep the cap (maxAllowed) within what the device sustains. A dead band
// [50, 57] avoids oscillation; in Auto mode the rendered count follows the cap.
let govFrames = 0;
let govT0 = performance.now();
function governorTick(now) {
  govFrames++;
  const dt = now - govT0;
  if (dt < 1000) return;
  const fps = (govFrames * 1000) / dt;
  govFrames = 0;
  govT0 = now;

  let changed = false;
  if (fps < 50 && maxAllowed > 1000) {
    maxAllowed = Math.max(1000, Math.round(maxAllowed * 0.85));
    changed = true;
  } else if (fps > 57 && maxAllowed < TOTAL_POINTS) {
    maxAllowed = Math.min(TOTAL_POINTS, Math.round(maxAllowed * 1.15) + 250);
    changed = true;
  }
  if (changed) {
    refreshBounds();
    if (autoMode) applyCount(maxAllowed);
  }
}

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

  governorTick(now);

  renderer.autoClear = false;
  renderer.clear();
  renderer.render(bgScene, bgCamera);
  renderer.render(scene, camera);
};

const { bgScene, bgCamera } = createBackground();
animate();
