import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('viewer');

// ───────── Renderer / Scene / Camera ─────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
    55,
    (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
    0.1,
    5000
);
camera.position.set(180, 240, 300); // 기본 포지션

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 60, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.7));

// ───────── 데이터(좌표만) 로드 ─────────
// draw 저장 형식 예:
// sessionStorage.setItem('floorCoordsPayload', JSON.stringify({ coords:[[x,y],…], canvas:{w:1600,h:1000}, ts:… }))
let baseHeight = 600;     // y-Down 캔버스 처리 기준치
let rawData = null;       // [[x,y], …]  (y는 아래로 증가하는 좌표로 맞춰 둠)

// ① draw 좌표 우선, ② 없으면 OSM 좌표(위경도) 자동 인식
try {
    const raw = sessionStorage.getItem('floorCoordsPayload');
    if (raw) {
        const payload = JSON.parse(raw);
        if (Array.isArray(payload?.coords) && payload.coords.length >= 3) {
            const a0 = payload.coords[0];
            if (Array.isArray(a0) && a0.length === 2) {
                // 위경도인지 판정
                const isLonLat = Math.abs(a0[0]) <= 180 && Math.abs(a0[1]) <= 90;
                if (isLonLat) {
                    const { canvasCoords, heightLike } = lonlatToCanvasCoords(payload.coords);
                    rawData = canvasCoords;
                    baseHeight = heightLike || 600;
                } else {
                    rawData = payload.coords;
                    if (payload?.canvas?.h) baseHeight = Number(payload.canvas.h) || 600;
                }
            }
        }
    }
    // 보조: 별도 키에 OSM 좌표 저장한 경우 허용
    if (!rawData) {
        const s = sessionStorage.getItem('osmPolygon');
        if (s) {
            const osm = JSON.parse(s);
            if (Array.isArray(osm?.coords) && osm.coords.length >= 3) {
                const { canvasCoords, heightLike } = lonlatToCanvasCoords(osm.coords);
                rawData = canvasCoords;
                baseHeight = heightLike || 600;
            }
        }
    }
} catch (e) {
    console.warn('coords load failed:', e);
}

// ───────── lon/lat → 로컬 평면(미터) → 캔버스(y-Down) 변환 ─────────
function lonlatToCanvasCoords(lonlatRing) {
    // 기준 위도(평균)
    const lat0 = lonlatRing.reduce((s, [, lat]) => s + lat, 0) / lonlatRing.length;
    const rad = Math.PI / 180;
    const mPerDegX = 111320 * Math.cos(lat0 * rad);
    const mPerDegY = 110540;

    // (lon,lat) → meter
    const meters = lonlatRing.map(([lon, lat]) => [lon * mPerDegX, lat * mPerDegY]);

    // 원점 정규화
    const xs = meters.map(p => p[0]), ys = meters.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const nx = meters.map(([x, y]) => [x - minX, y - minY]);

    // y-Down 캔버스 좌표로 반전 (상하 반전)
    const maxY = Math.max(...nx.map(p => p[1]));
    const canvas = nx.map(([x, y]) => [x, maxY - y]);

    // 픽셀 느낌으로 스케일(최대 변 1600 안쪽)
    const maxX = Math.max(...canvas.map(p => p[0]));
    const width = maxX || 1;
    const height = maxY || 1;
    const maxDim = Math.max(width, height);
    const scale = (maxDim > 1600) ? (1600 / maxDim) : 1.0;

    const canvasScaled = canvas.map(([x, y]) => [x * scale, y * scale]);

    return { canvasCoords: canvasScaled, heightLike: Math.max(height * scale, 600) };
}

// ───────── 빌딩 그룹 ─────────
const buildingGroup = new THREE.Group();
buildingGroup.name = 'buildingGroup';
scene.add(buildingGroup);

const WALLS_GROUP_NAME = 'wallsGroup';

// ───────── 모드 & UI ─────────
let mode = 'img';
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const PREV_PAGE_URL = 'building_osm.html';
const NEXT_PAGE_URL = 'floor_add.html';

function setMode(next) {
    mode = next;
    const imgMode = document.querySelector('.img-mode');
    const floorMode = document.querySelector('.floor-mode');
    if (imgMode) imgMode.style.display = (mode === 'img') ? 'flex' : 'none';
    if (floorMode) floorMode.style.display = (mode === 'floor') ? 'flex' : 'none';
    const nextBtn = document.getElementById('btnNext');
    const saveBtn = document.getElementById('btnSaveLevels');
    if (nextBtn) nextBtn.style.display = (mode === 'img') ? 'inline-block' : 'none';
    if (saveBtn) saveBtn.style.display = (mode === 'floor') ? 'inline-block' : 'none';
}
btnPrev?.addEventListener('click', () => { if (mode === 'img') window.location.href = PREV_PAGE_URL; else setMode('img'); });
btnNext?.addEventListener('click', () => { if (mode === 'img') setMode('floor'); else window.location.href = NEXT_PAGE_URL; });

// ───────── 상태값 ─────────
let buildingBox = new THREE.Box3();
let baseY = 0, roofY = 0;
let userBoundaries = [];
let boundaryLinesGroup = null;
let footprintTemplate = null;
let floorWorldY = 0;

function updateBuildingBox() {
    buildingBox.setFromObject(buildingGroup);
    baseY = buildingBox.min.y;
    roofY = buildingBox.max.y;
}

// ───────── 코너/구간/리본 유틸 ─────────
function findCornersStraightOnly(pts, angleMarginDeg = 25) {
    const N = pts.length;
    const corners = [0];
    for (let i = 0; i < N; i++) {
        const im1 = (i - 1 + N) % N, ip1 = (i + 1) % N;
        const b = pts[i], a = pts[im1], c = pts[ip1];
        const v1 = new THREE.Vector2(a.x - b.x, a.y - b.y).normalize();
        const v2 = new THREE.Vector2(c.x - b.x, c.y - b.y).normalize();
        const dot = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
        const deg = THREE.MathUtils.radToDeg(Math.acos(dot));
        if (deg < (180 - angleMarginDeg)) corners.push(i);
    }
    return [...new Set(corners)].sort((a, b) => a - b);
}
function sharpestCornerIndex(pts) {
    let best = 0, bestDeg = 180, N = pts.length;
    for (let i = 0; i < N; i++) {
        const im1 = (i - 1 + N) % N, ip1 = (i + 1) % N;
        const b = pts[i], a = pts[im1], c = pts[ip1];
        const v1 = new THREE.Vector2(a.x - b.x, a.y - b.y).normalize();
        const v2 = new THREE.Vector2(c.x - b.x, c.y - b.y).normalize();
        const deg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1)));
        if (deg < bestDeg) { bestDeg = deg; best = i; }
    }
    return best;
}
function toFacadeRanges(N, cornerIdxs) {
    if (cornerIdxs.length <= 1) return [[0, 0]];
    const ranges = [];
    for (let i = 0; i < cornerIdxs.length; i++) {
        const s = cornerIdxs[i];
        const e = cornerIdxs[(i + 1) % cornerIdxs.length];
        ranges.push([s, e]);
    }
    return ranges;
}
// 배열 회전(가장 뾰족한 코너를 시작점으로)
function rotateArray(arr, startIdx) {
    const N = arr.length;
    if (!N) return [];
    const s = ((startIdx % N) + N) % N;
    const out = new Array(N);
    for (let i = 0; i < N; i++) out[i] = arr[(s + i) % N];
    return out;
}

function buildRibbonFromRange(pts, cx, cz, H, iStart, iEnd, color = 0x9bb0c1) {
    const N = pts.length;
    if (N < 2) return null;

    const seq = [];
    if (iEnd === iStart) {
        for (let k = 0; k < N; k++) seq.push((iStart + k) % N);
        seq.push(iStart);
    } else {
        let i = iStart;
        seq.push(i);
        while (i !== iEnd) { i = (i + 1) % N; seq.push(i); }
    }
    if (seq.length < 2) return null;

    const ringBottom = [], ringTop = [];
    for (const idx of seq) {
        const v = pts[idx];
        const x = v.x - cx, z = v.y - cz;
        ringBottom.push(new THREE.Vector3(x, 0, z));
        ringTop.push(new THREE.Vector3(x, H, z));
    }

    const L = ringBottom.length;
    const positions = new Float32Array(L * 2 * 3);
    const uvs = new Float32Array(L * 2 * 2);
    const indices = [];

    for (let i = 0; i < L; i++) {
        const iBot = i * 2, iTop = i * 2 + 1;
        const pB = ringBottom[i], pT = ringTop[i];
        positions.set([pB.x, pB.y, pB.z], iBot * 3);
        positions.set([pT.x, pT.y, pT.z], iTop * 3);

        const u = (L === 1) ? 0 : (i / (L - 1));
        uvs.set([u, 0], iBot * 2);
        uvs.set([u, 1], iTop * 2);
    }
    for (let i = 0; i < L - 1; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        indices.push(a, b, d, a, d, c);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
}

function autoFrame(object, { fitOffset = 1.25 } = {}) {
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    const fovV = THREE.MathUtils.degToRad(camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    const distV = (sphere.radius * fitOffset) / Math.sin(fovV / 2);
    const distH = (sphere.radius * fitOffset) / Math.sin(fovH / 2);
    const distance = Math.max(distV, distH);

    const dir = new THREE.Vector3(1, 1, 1).normalize();
    controls.target.copy(center);
    camera.position.copy(center).add(dir.multiplyScalar(distance));

    const maxDim = Math.max(size.x, size.y, size.z);
    camera.near = Math.max(distance / 1000, 0.01);
    camera.far = distance + maxDim * 20;
    camera.updateProjectionMatrix();
    controls.update();
}

// ───────── 메인 빌드 ─────────
function buildFromPolygon(rawData, baseHeight, floors) {
    if (!rawData || rawData.length < 3) return;

    // px 좌표 → 벡터
    const polygonPx = rawData.map(([x, y]) => ({ x, y }));

    // 스케일/높이
    const PX_TO_UNIT = 0.3;
    const UNIT_PER_FLOOR = 3.6;
    const H = floors * UNIT_PER_FLOOR;

    // 캔버스 y-Down → 3D(XZ) 변환
    const to3D = (p) => new THREE.Vector2(p.x * PX_TO_UNIT, (baseHeight - p.y) * PX_TO_UNIT);

    let pts = polygonPx.map(to3D);
    const startAt = sharpestCornerIndex(pts);
    pts = rotateArray(pts, startAt);

    const minX = Math.min(...pts.map(v => v.x));
    const maxX = Math.max(...pts.map(v => v.x));
    const minZ = Math.min(...pts.map(v => v.y));
    const maxZ = Math.max(...pts.map(v => v.y));
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

    // 초기화
    buildingGroup.clear();
    const wallsGroup = new THREE.Group();
    wallsGroup.name = WALLS_GROUP_NAME;
    buildingGroup.add(wallsGroup);
    buildingGroup.position.y = -20;

    // 파사드 리본
    const cornerIdxs = findCornersStraightOnly(pts, 25);
    let ranges = toFacadeRanges(pts.length, cornerIdxs);
    let facadeNo = 0;
    for (const [s, e] of ranges) {
        const ribbon = buildRibbonFromRange(pts, cx, cz, H, s, e);
        if (!ribbon) continue;
        ribbon.material.color.setHSL((facadeNo % 12) / 12, 0.5, 0.5);
        ribbon.name = `facade-${facadeNo++}`;
        wallsGroup.add(ribbon);
    }

    // 바닥/지붕
    const capShape = new THREE.Shape();
    pts.forEach((v, i) => {
        const x = v.x - cx, z = v.y - cz;
        if (i === 0) capShape.moveTo(x, z); else capShape.lineTo(x, z);
    });
    capShape.closePath();

    const capGeo = new THREE.ShapeGeometry(capShape);
    capGeo.rotateX(-Math.PI / 2);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x9bb0c1, side: THREE.DoubleSide });

    const floor = new THREE.Mesh(capGeo.clone(), capMat.clone());
    floor.name = 'floorCap'; floor.position.y = 0; floor.rotateX(Math.PI);

    const roof = new THREE.Mesh(capGeo.clone(), capMat.clone());
    roof.name = 'roofCap'; roof.position.y = H; roof.rotateX(Math.PI);

    wallsGroup.add(floor, roof);

    // 경계 라인 템플릿 준비(층 라인용)
    if (footprintTemplate) { footprintTemplate.geometry?.dispose?.(); footprintTemplate = null; }
    const edgesGeo = new THREE.EdgesGeometry(floor.geometry, 1);
    edgesGeo.rotateX(-Math.PI / 2);
    floor.updateWorldMatrix(true, true);
    const tmpLine = new THREE.LineSegments(edgesGeo);
    tmpLine.applyMatrix4(floor.matrixWorld);
    const wp = new THREE.Vector3();
    floor.getWorldPosition(wp);
    floorWorldY = wp.y;
    footprintTemplate = tmpLine;

    updateBuildingBox();
    userBoundaries = userBoundaries.filter(y => y > baseY && y < roofY);
    drawBoundaryLines();

    autoFrame(buildingGroup, { fitOffset: 1.25 });
}

// ───────── UI: 층수/생성 ─────────
const floorsInput = document.getElementById('floors');
const buildBtn = document.getElementById('createBuilding');

function createBuilding() {
    if (!rawData) return; // 좌표 없으면 아무것도 생성하지 않음
    const floors = Math.max(1, Number(floorsInput?.value || 1));
    buildFromPolygon(rawData, baseHeight, floors);
}
createBuilding();
buildBtn?.addEventListener('click', createBuilding);


// ───────── 텍스처 더블클릭 적용 ─────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const fileInput = document.getElementById('fileInput');
let pendingWall = null;

function raycast(evt, targets) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(targets, true);
    return hits[0] || null;
}
function getWallsChildren() {
    const g = buildingGroup.getObjectByName(WALLS_GROUP_NAME);
    if (!g) return [];
    return g.children.filter(o => o.name?.startsWith('facade-'));
}
function getWallsOnly() { return getWallsChildren(); }

renderer.domElement.addEventListener('dblclick', (e) => {
    if (mode !== 'img') return;
    const hit = raycast(e, getWallsChildren());
    if (!hit) return;
    pendingWall = hit.object;
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
});

fileInput?.addEventListener('change', (e) => {
    if (mode !== 'img') return;
    const f = e.target.files?.[0];
    if (!f || !pendingWall) return;

    const applyTextureFromUrl = (url) => {
        const loader = new THREE.TextureLoader();
        loader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;
            tex.needsUpdate = true;

            const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
            pendingWall.material = mat;
            pendingWall = null;
        });
    };
    const blobUrl = URL.createObjectURL(f);
    applyTextureFromUrl(blobUrl);
});

// ───────── 층/경계선 ─────────
const MIN_GAP = 0.5;
const SNAP = 0.1;
const STORAGE_KEY = 'levels:B001';
function snap(v) { return Math.round(v / SNAP) * SNAP; }
function currentBoundaries() { return [baseY, ...userBoundaries, roofY]; }

function addBoundary(y) {
    updateBuildingBox();
    if (!(y > baseY && y < roofY)) return false;
    y = snap(y);
    const all = [baseY, ...userBoundaries, roofY].sort((a, b) => a - b);
    for (const b of all) { if (Math.abs(b - y) < MIN_GAP) return false; }
    userBoundaries.push(y);
    userBoundaries.sort((a, b) => a - b);
    drawBoundaryLines();
    return true;
}
function removeBoundaryNear(y) {
    updateBuildingBox();
    if (!userBoundaries.length) return false;
    const ySnap = snap(y);
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < userBoundaries.length; i++) {
        const d = Math.abs(userBoundaries[i] - ySnap);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const THRESH = Math.max(MIN_GAP * 1.5, SNAP * 2);
    if (bestIdx !== -1 && bestDist <= THRESH) {
        userBoundaries.splice(bestIdx, 1);
        drawBoundaryLines();
        return true;
    }
    return false;
}
function drawBoundaryLines() {
    if (boundaryLinesGroup) {
        boundaryLinesGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        scene.remove(boundaryLinesGroup);
        boundaryLinesGroup = null;
    }
    boundaryLinesGroup = new THREE.Group();
    scene.add(boundaryLinesGroup);

    if (!footprintTemplate) return;
    const boundaries = currentBoundaries();
    for (const y of boundaries) {
        const line = new THREE.LineSegments(
            footprintTemplate.geometry,
            new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.9 })
        );
        line.rotation.x = -Math.PI / 2;
        line.position.y = y;
        boundaryLinesGroup.add(line);
    }
}
renderer.domElement.addEventListener('click', (e) => {
    if (mode !== 'floor') return;
    const hit = raycast(e, getWallsOnly());
    if (!hit) return;
    const y = hit.point.y;
    if (e.altKey || e.metaKey) {
        if (removeBoundaryNear(y)) console.log('境界 削除'); else console.log('近い境界なし');
        return;
    }
    if (addBoundary(y)) console.log('境界 追加');
});
document.getElementById('btnSaveLevels')?.addEventListener('click', () => {
    const payload = { version: 1, buildingId: 'B001', baseY, roofY, userBoundaries: userBoundaries.slice(), boundaries: currentBoundaries() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.location.href = 'floor_add.html';
});
document.getElementById('btnClearGuides')?.addEventListener('click', () => {
    if (boundaryLinesGroup) { scene.remove(boundaryLinesGroup); boundaryLinesGroup = null; }
});

// ───────── 2D 외곽선 PNG 저장 ─────────
// 버튼이 없어도 단축키로 저장: Ctrl + Shift + S
function outlineToCanvas() {
    if (!rawData || rawData.length < 3) return null;
    const PAD = 16;
    const W = 1024, H = 1024;
    const xs = rawData.map(p => p[0]), ys = rawData.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.fillStyle = '#e5e7eb';

    ctx.beginPath();
    rawData.forEach(([x, y], i) => {
        const cx = (x - minX) * scale + PAD;
        const cy = (y - minY) * scale + PAD;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    return canvas;
}
function saveOutlinePng() {
    const c = outlineToCanvas();
    if (!c) return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'building_outline.png';
    a.click();
}
document.getElementById('btnSaveOutline')?.addEventListener('click', saveOutlinePng);
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 's')) {
        e.preventDefault();
        saveOutlinePng();
    }
});

// ───────── 리사이즈/렌더 ─────────
function onResize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

updateBuildingBox();
drawBoundaryLines();
