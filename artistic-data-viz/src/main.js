import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { createBackground } from './background.js';
import { initYoutubePlayer, playerReady } from './yt_player.js';

const MAX_POINTS = 5000;
const loadingEl = document.getElementById('loading');

let rawData;
try {
  const res = await fetch(`${import.meta.env.BASE_URL}spotify_clustered_3d.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  rawData = await res.json();
} catch (err) {
  if (loadingEl) loadingEl.textContent = `Erreur de chargement : ${err.message}`;
  throw err;
}

const data = rawData.slice(0, MAX_POINTS);
loadingEl?.remove();

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

// MeshBasicMaterial: no lighting calculations, instance colors applied directly
const geometry = new THREE.SphereGeometry(0.1, 6, 6);
const material = new THREE.MeshBasicMaterial();
const count = data.length;
const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
scene.add(instancedMesh);

const dummy = new THREE.Object3D();
const songData = [];
const baseColors = [];

data.forEach((track, i) => {
  dummy.position.set(track.x, track.y, track.z);
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);

  const color = new THREE.Color(clusterColors[track.cluster % clusterColors.length]);
  instancedMesh.setColorAt(i, color);
  baseColors.push(color);

  songData.push({
    x: track.x,
    y: track.y,
    z: track.z,
    cluster: track.cluster,
    artist: track.artist_name || "Unknown Artist",
    title: track.track_name   || "Unknown track",
    genre: track.genre        || "Unknown genre"
  });
});

instancedMesh.instanceMatrix.needsUpdate = true;
instancedMesh.instanceColor.needsUpdate = true;

// Pre-allocated scratch objects (no per-frame heap allocations)
const flickerColor = new THREE.Color();
const white = new THREE.Color(0xffffff);

// --- Picking (depth-aware raycast against the InstancedMesh) ---
// A hit means the cursor is genuinely over the sphere's rendered geometry, and
// intersections come back sorted by distance — so the front-most sphere wins and
// spheres occluded behind it are never returned.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function raycastInstance(clientX, clientY) {
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(instancedMesh)[0];
  return hit ? hit.instanceId : null;
}

// Mouse: a single ray — you select a sphere by touching it with the cursor.
const pickMouse = raycastInstance;

// Touch: a fingertip rarely lands a single ray on a sphere this small, so probe a
// few offsets around the tap (center first, then outward) and take the first hit.
// Forgiving, while each individual ray still respects occlusion.
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

// --- Tooltip ---
// A single screen-space element anchored to the upper-right of the cursor (rather
// than centered on the sphere) so the pointer never covers the text. `labelIndex`
// also drives the in-scene highlight in the render loop.
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
  }
  // Anchor the tooltip's lower-left near the cursor; CSS translateY(-100%) lifts it
  // above, so it sits to the upper-right.
  tooltip.style.left = `${clientX + TOOLTIP_OFFSET_PX}px`;
  tooltip.style.top = `${clientY - TOOLTIP_OFFSET_PX}px`;
  tooltip.classList.add('visible');
}

function hideLabel() {
  if (labelIndex === null) return;
  labelIndex = null;
  tooltip.classList.remove('visible');
}

// --- Playback ---
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
    } else {
      alert("Vidéo non trouvée.");
    }
  } catch (err) {
    console.error("Erreur recherche YouTube :", err);
  }
}

// --- Pointer input (mouse + touch + pen, unified) ---
// A press that travels more than this is a camera rotation, not a selection.
const DRAG_THRESHOLD_PX = 6;
const canvas = renderer.domElement;
let pressX = 0;
let pressY = 0;

canvas.addEventListener('pointerdown', (e) => {
  pressX = e.clientX;
  pressY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  // Ignore the end of a drag (rotation); only a genuine tap/click selects.
  if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > DRAG_THRESHOLD_PX) return;
  const index = e.pointerType === 'touch'
    ? pickTouch(e.clientX, e.clientY)
    : pickMouse(e.clientX, e.clientY);
  if (index === null) { hideLabel(); return; } // tap on empty space dismisses
  showLabel(index, e.clientX, e.clientY);
  playTrack(index);
});

// Hover tooltips apply to a mouse only, and only while no button is pressed.
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
  const index = pickMouse(e.clientX, e.clientY);
  if (index === null) hideLabel();
  else showLabel(index, e.clientX, e.clientY);
});

const animate = () => {
  requestAnimationFrame(animate);
  controls.update();

  const time = performance.now() * 0.001;

  for (let i = 0; i < count; i++) {
    dummy.position.set(songData[i].x, songData[i].y + Math.sin(time + i) * 0.05, songData[i].z);
    dummy.scale.setScalar(i === labelIndex ? 2.6 : 1); // enlarge the active sphere
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < count; i++) {
    if (i === labelIndex) flickerColor.copy(white); // highlight the active sphere
    else flickerColor.copy(baseColors[i]).lerp(white, 0.1 * Math.sin(time * 4 + i));
    instancedMesh.setColorAt(i, flickerColor);
  }
  instancedMesh.instanceColor.needsUpdate = true;

  renderer.autoClear = false;
  renderer.clear();
  renderer.render(bgScene, bgCamera);
  renderer.render(scene, camera);
};

const { bgScene, bgCamera } = createBackground();
animate();
