// src/background.js
import * as THREE from 'three';

export function createBackground() {
  const bgScene = new THREE.Scene();
  const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const geometry = new THREE.PlaneGeometry(2, 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      color1: { value: new THREE.Color(0x151b26) },
      color2: { value: new THREE.Color(0x4a6085) }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color1;
      uniform vec3 color2;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(mix(color1, color2, vUv.y), 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });

  const quad = new THREE.Mesh(geometry, material);
  bgScene.add(quad);

  return { bgScene, bgCamera };
}
