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

let hoveredIndex = null;
let currentLabel = null;
const mouse = { x: -9999, y: -9999 };
let lastMouseX = -9999;
let lastMouseY = -9999;

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

window.addEventListener('click', async () => {
  if (hoveredIndex === null) return;
  const track = songData[hoveredIndex];
  const query = encodeURIComponent(`${track.artist} ${track.title}`);
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${query}&key=${YT_API_KEY}`);
    const json = await res.json();
    const videoId = json.items[0]?.id?.videoId;
    if (videoId) {
      const player = await playerReady;
      player.loadVideoById(videoId);
    } else {
      alert("Vidéo non trouvée.");
    }
  } catch (err) {
    console.error("Erreur recherche YouTube :", err);
  }
});

// Pre-allocated to avoid per-frame heap allocations
const vector = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const flickerColor = new THREE.Color();
const white = new THREE.Color(0xffffff);

const animate = () => {
  requestAnimationFrame(animate);
  controls.update();

  // Hover: skip projection pass if mouse hasn't moved
  if (mouse.x !== lastMouseX || mouse.y !== lastMouseY) {
    lastMouseX = mouse.x;
    lastMouseY = mouse.y;

    let closestIndex = null;
    let minDistSq = 20 * 20;

    for (let i = 0; i < count; i++) {
      tempPos.set(songData[i].x, songData[i].y, songData[i].z);
      vector.copy(tempPos).project(camera);

      const screenX = (vector.x + 1) / 2 * window.innerWidth;
      const screenY = (-vector.y + 1) / 2 * window.innerHeight;
      const dx = screenX - mouse.x;
      const dy = screenY - mouse.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestIndex = i;
      }
    }

    if (closestIndex !== null && closestIndex !== hoveredIndex) {
      if (currentLabel) {
        currentLabel.element.remove();
        scene.remove(currentLabel);
        currentLabel = null;
      }

      const track = songData[closestIndex];
      const div = document.createElement('div');
      div.className = 'label visible';
      div.textContent = `${track.artist} - ${track.title}, ${track.genre}`;
      div.style.color = '#fff';
      div.style.fontSize = '14px';
      div.style.padding = '4px 8px';
      div.style.background = 'rgba(0,0,0,0.7)';
      div.style.borderRadius = '8px';

      currentLabel = new CSS2DObject(div);
      currentLabel.position.set(track.x, track.y + 0.15, track.z);
      scene.add(currentLabel);
      hoveredIndex = closestIndex;
    } else if (closestIndex === null && currentLabel) {
      // Capture ref before async timeout so reassignment doesn't corrupt it
      const labelToRemove = currentLabel;
      currentLabel = null;
      hoveredIndex = null;
      labelToRemove.element.classList.remove('visible');
      setTimeout(() => {
        labelToRemove.element.remove();
        scene.remove(labelToRemove);
      }, 300);
    }
  }

  const time = performance.now() * 0.001;

  for (let i = 0; i < count; i++) {
    dummy.position.set(songData[i].x, songData[i].y + Math.sin(time + i) * 0.05, songData[i].z);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < count; i++) {
    flickerColor.copy(baseColors[i]).lerp(white, 0.1 * Math.sin(time * 4 + i));
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
