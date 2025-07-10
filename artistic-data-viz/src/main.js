import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { createBackground } from './background.js';
import { initYoutubePlayer, playerReady } from './yt_player.js';
import data from './spotify_data/spotify_clustered_3d.json';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 65;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

initYoutubePlayer();

window.addEventListener('click', async () => {
  if (hoveredIndex !== null) {
    const track = songData[hoveredIndex];
    const query = encodeURIComponent(`${track.artist} ${track.title}`);

    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${query}&key=AIzaSyBMIrVRwi8bWmz_-Yx0RfUAt_0fcGjjXys`);
      const data = await res.json();
      const videoId = data.items[0]?.id?.videoId;

      if (videoId) {
        const player = await playerReady; // C’est ici que tu "définis" player
        player.loadVideoById(videoId);
      } else {
        alert("Vidéo non trouvée.");
      }
    } catch (err) {
      console.error("Erreur recherche YouTube :", err);
    }
  }
});

// Colors
const clusterColors = [
  0x9e0142,
  0xd53e4f,
  0xf46d43,
  0xfdae61,
  0xfee08b,
  0xe6f598,
  0xabdda4,
  0x66c2a5,
  0x3288bd,
  0x5e4fa2
];

// InstancedMesh setup
const geometry = new THREE.SphereGeometry(0.1, 4, 4);
const material = new THREE.MeshStandardMaterial({ color: "0xffffff" });
const count = data.length;
const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
scene.add(instancedMesh);

// Prepare instance data
const dummy = new THREE.Object3D();
const colors = [];
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

// Hover logic (project to 2D and find closest)
let hoveredIndex = null;
let currentLabel = null;
const mouse = new THREE.Vector2();

window.addEventListener('mousemove', (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
});

// Projection util
const vector = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const ray = new THREE.Raycaster();

const animate = () => {
  requestAnimationFrame(animate);
  controls.update();

  // Project all points & find closest
  let closestIndex = null;
  let minDist = 20;

  for (let i = 0; i < songData.length; i++) {
    tempPos.set(songData[i].x, songData[i].y, songData[i].z);
    vector.copy(tempPos).project(camera);

    const screenX = (vector.x + 1) / 2 * window.innerWidth;
    const screenY = (-vector.y + 1) / 2 * window.innerHeight;

    const dx = screenX - mouse.x;
    const dy = screenY - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist) {
      minDist = dist;
      closestIndex = i;
    }
  }

  if (closestIndex !== null && closestIndex !== hoveredIndex) {
    // Remove old label
    if (currentLabel) {
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
    if (currentLabel) {
      const element = currentLabel.element;
      element.classList.remove('visible');
      setTimeout(() => {
        scene.remove(currentLabel);
        currentLabel = null;
      }, 300);
    }
    hoveredIndex = null;
  }

  const time = performance.now() * 0.001;
  for (let i = 0; i < count; i++) {
    dummy.position.set(songData[i].x, songData[i].y + Math.sin(time + i) * 0.05, songData[i].z);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < count; i++) {
    const hsl = {};
    baseColors[i].getHSL(hsl);
    hsl.l = 0.4 + 0.2 * Math.sin(time * 3 + i);
    const flickered = baseColors[i].clone().lerp(new THREE.Color(0xffffff), 0.1 * Math.sin(time * 4 + i));
    instancedMesh.setColorAt(i, flickered);
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
