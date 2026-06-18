import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
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

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

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
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
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

// Pre-allocated scratch objects (no per-frame / per-pick heap allocations)
const vector = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const flickerColor = new THREE.Color();
const white = new THREE.Color(0xffffff);

// --- Picking ---
// Spheres are tiny (r=0.1), so we pick the nearest one in screen space within a
// pixel radius rather than requiring an exact ray hit — far more forgiving.
function pickNearest(clientX, clientY, radiusPx) {
  let closest = null;
  let minDistSq = radiusPx * radiusPx;
  for (let i = 0; i < count; i++) {
    tempPos.set(songData[i].x, songData[i].y, songData[i].z);
    vector.copy(tempPos).project(camera);
    if (vector.z > 1) continue; // behind the camera / beyond far plane
    const screenX = (vector.x + 1) / 2 * window.innerWidth;
    const screenY = (-vector.y + 1) / 2 * window.innerHeight;
    const dx = screenX - clientX;
    const dy = screenY - clientY;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      closest = i;
    }
  }
  return closest;
}

// --- Label ---
let labelIndex = null;
let currentLabel = null;

function showLabel(index) {
  if (index === labelIndex) return;
  removeLabel(true);
  const track = songData[index];
  const div = document.createElement('div');
  div.className = 'label visible';
  div.textContent = `${track.artist} - ${track.title}, ${track.genre}`;
  currentLabel = new CSS2DObject(div);
  currentLabel.position.set(track.x, track.y + 0.15, track.z);
  scene.add(currentLabel);
  labelIndex = index;
}

function removeLabel(immediate = false) {
  if (!currentLabel) return;
  const label = currentLabel;
  currentLabel = null;
  labelIndex = null;
  if (immediate) {
    label.element.remove();
    scene.remove(label);
    return;
  }
  label.element.classList.remove('visible');
  setTimeout(() => {
    label.element.remove();
    scene.remove(label);
  }, 300);
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
  // Fingers are less precise than a cursor: give touch a larger hit radius.
  const radiusPx = e.pointerType === 'touch' ? 32 : 20;
  const index = pickNearest(e.clientX, e.clientY, radiusPx);
  if (index === null) return;
  showLabel(index);
  playTrack(index);
});

// Hover labels apply to a mouse only, and only while no button is pressed.
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
  const index = pickNearest(e.clientX, e.clientY, 20);
  if (index === null) removeLabel();
  else showLabel(index);
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
  labelRenderer.render(scene, camera);
};

const { bgScene, bgCamera } = createBackground();
animate();
