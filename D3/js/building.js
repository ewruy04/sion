
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const el = document.getElementById('app');


const scene = new THREE.Scene();

//camera
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(6, 6, 10);

//renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(el.clientWidth, el.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; 
el.appendChild(renderer.domElement);

//light
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);


const grid = new THREE.GridHelper(50, 50, 0xcccccc, 0xeeeeee);
grid.position.y = -0.01;
scene.add(grid);

//box
const buildingWidth = 4;    // X
const buildingDepth = 3;    // Z
const buildingHeight = 8;   // Y

function makeStripeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');

  // building-color
  g.fillStyle = '#717171ff';
  g.fillRect(0, 0, c.width, c.height);

  // building-window
  g.fillStyle = '#fffdcdff';
  for (let y = 20; y < c.height; y += 30) {
    g.fillRect(8, y, c.width - 16, 15);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

const wallMat = new THREE.MeshStandardMaterial({
  map: makeStripeTexture(),
  roughness: 0.7,
  metalness: 0.0
});

const geo = new THREE.BoxGeometry(buildingWidth, buildingHeight, buildingDepth);
const building = new THREE.Mesh(geo, wallMat);
building.position.y = buildingHeight / 2; 
scene.add(building);


// ----- 마우스 드래그 회전: OrbitControls -----
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;    
controls.minDistance = 5;
controls.maxDistance = 30;
controls.target.set(0, buildingHeight / 2, 0);
controls.update();

// resize
function onResize() {
  const w = el.clientWidth;
  const h = el.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// loop
function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();


//tool-tip
document.querySelectorAll('[hover-tooltip]').forEach(el => {
    let tooltip;

    el.addEventListener('mouseenter', e => {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = el.getAttribute('hover-tooltip');
        document.body.appendChild(tooltip);
        tooltip.classList.add('show');
    });

    el.addEventListener('mousemove', e => {
        if (tooltip) {
            tooltip.style.top = e.clientY + 'px';
            tooltip.style.left = e.clientX + 'px';
        }
    });

    el.addEventListener('mouseleave', e => {
        if (tooltip) {
            tooltip.remove();
            tooltip = null;
        }
    });
});
