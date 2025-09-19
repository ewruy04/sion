import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const container = document.getElementById('viewer');

/* ──────────────────────────────────────────────────────────
 * Renderer / Scene / Camera / Controls
 * ────────────────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f6fa);

const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 5000);
camera.position.set(200, 260, 320);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.7));

/* ──────────────────────────────────────────────────────────
 * Session / Defaults
 * ────────────────────────────────────────────────────────── */
const FALLBACK_BASE_HEIGHT = 600;
const FALLBACK_POLYGON = [
  [471,110],[833,110],[833,154],[515,154],[515,213],[739,213],[739,185],[913,185],[955,90],[997,185],
  [1012,185],[1012,348],[818,348],[818,353],[815,365],[811,378],[805,389],[797,400],[787,410],[777,419],
  [765,426],[753,432],[739,436],[725,439],[711,439],[697,439],[683,436],[670,432],[658,426],[646,419],
  [635,410],[626,400],[618,389],[612,378],[607,365],[605,353],[604,340],[605,327],[607,314],[612,301],
  [618,290],[626,279],[635,269],[646,260],[650,258],[471,258]
];

function isNum(n){ return typeof n==='number' && Number.isFinite(n); }
function isXY(a){ return Array.isArray(a) && a.length===2 && isNum(a[0]) && isNum(a[1]); }
function isValidPoly(p){ return Array.isArray(p) && p.length>=3 && p.every(isXY); }

function ellipseToPolygon({cx,cy,rx,ry,angle=0}, segments=64){
  const pts=[]; const s=Math.sin(angle), c=Math.cos(angle);
  for(let i=0;i<segments;i++){
    const t=(i/segments)*Math.PI*2;
    const x0=cx+rx*Math.cos(t), y0=cy+ry*Math.sin(t);
    const dx=x0-cx, dy=y0-cy;
    pts.push([ cx + dx*c - dy*s, cy + dx*s + dy*c ]);
  }
  return pts;
}
function polygonFromShapesJson(doc){
  if (!doc || !Array.isArray(doc.shapes) || !doc.shapes.length) return null;
  const outline = doc.shapes.find(s=>s.type==='polygon' && s.role==='outline' && Array.isArray(s.points) && s.points.length>=3);
  if (outline) return outline.points;
  const firstPoly = doc.shapes.find(s=>s.type==='polygon' && Array.isArray(s.points) && s.points.length>=3);
  if (firstPoly) return firstPoly.points;
  const firstEllipse = doc.shapes.find(s=>s.type==='ellipse' && isNum(s.cx)&&isNum(s.cy)&&isNum(s.rx)&&isNum(s.ry));
  if (firstEllipse) return ellipseToPolygon(firstEllipse, 64);
  return null;
}
function loadDraft(){
  try{
    const raw = sessionStorage.getItem('building:draft');
    if (raw){
      const d = JSON.parse(raw);
      if (d && isValidPoly(d.polygon)){
        return {
          polygon: d.polygon,
          baseHeight: isNum(d.baseHeight)? d.baseHeight : FALLBACK_BASE_HEIGHT,
          floors: isNum(d.floors)? Math.max(1, Math.round(d.floors)) : 10
        };
      }
    }
  }catch{}
  try{
    const raw2 = sessionStorage.getItem('floorShapesLatest');
    if (raw2){
      const doc = JSON.parse(raw2);
      const poly = polygonFromShapesJson(doc);
      const baseHeight = isNum(doc?.canvasSize?.height) ? doc.canvasSize.height : FALLBACK_BASE_HEIGHT;
      if (isValidPoly(poly)) return { polygon: poly, baseHeight, floors: 10, _doc: doc };
    }
  }catch{}
  return { polygon: FALLBACK_POLYGON, baseHeight: FALLBACK_BASE_HEIGHT, floors: 10 };
}
const draft = loadDraft();
let baseHeight = draft.baseHeight;
let initialFloors = draft.floors;

/* ──────────────────────────────────────────────────────────
 * Geometry/Range Utilities (wrap & culling)
 * ────────────────────────────────────────────────────────── */
function bboxFromPoints(pts){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const [x,y] of pts){ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; }
  return {minX,minY,maxX,maxY};
}
function aabbIntersects(a,b){ return !(a.maxX<b.minX || a.minX>b.maxX || a.maxY<b.minY || a.minY>b.maxY); }
function pointInPoly([x,y], poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i],[xj,yj]=poly[j];
    const hit=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}
function polyPerimeter(pts){
  let L=0;
  for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; L+=Math.hypot(b[0]-a[0], b[1]-a[1]);}
  return L;
}
function inflateRanges(ranges, padU){ if(!ranges?.length||padU<=0) return ranges||[]; return ranges.map(([a,b])=>[Math.max(0,a-padU), Math.min(1,b+padU)]); }
function expandRanges(ranges, du){ if(!ranges?.length||du<=0) return ranges||[]; return ranges.map(([a,b])=>[Math.max(0,a-du), Math.min(1,b+du)]); }
function computeBlockedURanges(shapePts, blockerPolys){
  const N=shapePts.length; if(!N) return [];
  const segLen=new Array(N); let total=0;
  for(let i=0;i<N;i++){ const a=shapePts[i], b=shapePts[(i+1)%N]; const L=Math.hypot(b[0]-a[0], b[1]-a[1]); segLen[i]=L; total+=L; }
  const segU=new Array(N); let acc=0;
  for(let i=0;i<N;i++){ segU[i]=[acc/total,(acc+segLen[i])/total]; acc+=segLen[i]; }
  let cx=0,cy=0; for(const [x,y] of shapePts){cx+=x;cy+=y;} cx/=N; cy/=N;
  const blockedFlag=new Array(N).fill(false);
  for(let i=0;i<N;i++){
    const a=shapePts[i], b=shapePts[(i+1)%N];
    let mid=[(a[0]+b[0])*0.5,(a[1]+b[1])*0.5];
    const dx=cx-mid[0], dy=cy-mid[1]; const L=Math.hypot(dx,dy)||1;
    mid=[mid[0]+dx/L*1.5, mid[1]+dy/L*1.5];
    for(const poly of blockerPolys||[]){ if(poly?.length>=3 && pointInPoly(mid, poly)){ blockedFlag[i]=true; break; } }
  }
  const EPS=1e-4, ranges=[]; let i=0;
  while(i<N){
    if(!blockedFlag[i]){ i++; continue; }
    let j=i+1; while(j<N && blockedFlag[j]) j++;
    const [u0]=segU[i]; const [,u1]=segU[j-1];
    if(u1-u0>EPS) ranges.push([u0,u1]); i=j;
  }
  if(ranges.length>=2 && blockedFlag[0] && blockedFlag[N-1]){
    const first=ranges[0], last=ranges[ranges.length-1]; ranges[0]=[last[0], first[1]]; ranges.pop();
  }
  return ranges;
}
function complementRanges(blocked){
  const EPS=1e-4;
  if(!blocked?.length) return [[0,1]];
  blocked=blocked.slice().sort((a,b)=>a[0]-b[0]);
  const out=[]; let cur=0;
  for(const [a,b] of blocked){ if(a-cur>EPS) out.push([cur,a]); cur=Math.max(cur,b); }
  if(1-cur>EPS) out.push([cur,1]);
  return out;
}
function intersectRanges(ranges, clip){
  const out=[]; if(!ranges?.length) return out;
  const [c0,c1]=clip;
  for(const [a,b] of ranges){
    const A=Math.max(a,c0), B=Math.min(b,c1);
    if(B-A>1e-6) out.push([A,B]);
  }
  return out;
}
function sampleEllipse({cx,cy,rx,ry,angle=0}, segments=72){
  const pts=[]; const cosR=Math.cos(angle), sinR=Math.sin(angle);
  for(let i=0;i<segments;i++){ const t=(i/segments)*Math.PI*2; const ex=rx*Math.cos(t), ey=ry*Math.sin(t);
    const rxed=ex*cosR - ey*sinR, ryed=ex*sinR + ey*cosR; pts.push([Math.round(cx+rxed), Math.round(cy+ryed)]);
  }
  return pts;
}
function shapesToPolyObjs(saved, ellipseSegments=72){
  if(!saved || !Array.isArray(saved.shapes)) return [];
  const out=[];
  for(const sh of saved.shapes){
    if(sh.type==='polygon' && Array.isArray(sh.points) && sh.points.length>=3)
      out.push({ points: sh.points, type:'polygon', id:sh.id, role:sh.role });
    else if(sh.type==='ellipse'){
      const pts=sampleEllipse({cx:sh.cx,cy:sh.cy,rx:sh.rx,ry:sh.ry,angle:sh.angle||0}, ellipseSegments);
      out.push({ points: pts, type:'ellipse', id:sh.id, role:sh.role, __ellipseMeta:{cx:sh.cx,cy:sh.cy,rx:sh.rx,ry:sh.ry,angle:sh.angle||0}});
    }else if(Array.isArray(sh.points) && sh.points.length>=3){
      out.push({ points: sh.points, type: 'polygon', id: sh.id, role: sh.role });
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────
 * State / Groups
 * ────────────────────────────────────────────────────────── */
const buildingGroup = new THREE.Group();
scene.add(buildingGroup);
const WALLS_GROUP_NAME = 'wallsGroup';

// Modes (img ↔ floor)
let mode = 'img';
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const PREV_PAGE_URL = 'building_draw.html';
const NEXT_PAGE_URL = 'floor_add.html';
function setMode(next){
  mode = next;
  document.querySelector('.img-mode')?.style && (document.querySelector('.img-mode').style.display = (mode==='img')?'inline-block':'none');
  document.querySelector('.floor-mode')?.style && (document.querySelector('.floor-mode').style.display = (mode==='floor')?'inline-block':'none');
  const nxt = document.getElementById('btnNext');
  const sav = document.getElementById('btnSaveLevels');
  if (nxt) nxt.style.display = (mode==='img') ? 'inline-block' : 'none';
  if (sav) sav.style.display = (mode==='floor') ? 'inline-block' : 'none';
}
btnPrev?.addEventListener('click', ()=>{ if (mode==='img') window.location.href = PREV_PAGE_URL; else setMode('img'); });
btnNext?.addEventListener('click', ()=>{ if (mode==='img') setMode('floor'); else window.location.href = NEXT_PAGE_URL; });

// Bounds/Guides
let baseY=0, roofY=0;
let userBoundaries = [];
let buildingBox = new THREE.Box3();
let boundaryLinesGroup = null;
let floorWorldY = 0;
let footprintTemplates = [];
let _hasOutline = false;
let _guideAdded = false;

function updateBuildingBox(){
  buildingBox.setFromObject(buildingGroup);
  baseY = buildingBox.min.y;
  roofY = buildingBox.max.y;
}

/* ──────────────────────────────────────────────────────────
 * Dispose helpers
 * ────────────────────────────────────────────────────────── */
function disposeObject3D(obj){
  obj.traverse(o=>{
    if (o.geometry) o.geometry.dispose();
    if (o.material){
      if (Array.isArray(o.material)) o.material.forEach(m=>{ if(m.map)m.map.dispose?.(); m.dispose?.(); });
      else { if (o.material.map) o.material.map.dispose?.(); o.material.dispose?.(); }
    }
  });
}
function replaceWallsGroupOn(parent,newGroup){
  const old = parent.getObjectByName(WALLS_GROUP_NAME);
  if (old){ parent.remove(old); disposeObject3D(old); }
  newGroup.name = WALLS_GROUP_NAME;
  parent.add(newGroup);
}

/* ──────────────────────────────────────────────────────────
 * Load shapes
 * ────────────────────────────────────────────────────────── */
let loadedPolys = null;
(function initLoadedPolys(){
  try{
    let saved = draft._doc || null;
    if (!saved){
      const raw = sessionStorage.getItem('floorShapesLatest');
      if (raw) saved = JSON.parse(raw);
    }
    if (saved){
      if (saved?.canvasSize?.height) baseHeight = saved.canvasSize.height;
      const objs = shapesToPolyObjs(saved, 72);
      let primary = objs.find(o=>o.role==='outline' && o.points?.length>=3);
      if (!primary && objs.length){
        const area=(pts)=>Math.abs(pts.reduce((acc,[x1,y1],i)=>{ const [x2,y2]=pts[(i+1)%pts.length]; return acc + (x1*y2 - y1*x2); },0))*0.5;
        primary = objs.slice().sort((a,b)=>area(b.points)-area(a.points))[0];
      }
      loadedPolys = primary ? [primary, ...objs.filter(o=>o!==primary)] : objs;
    }
  }catch(e){ console.warn('Failed to load shapes:', e); }

  if (!loadedPolys){
    loadedPolys = [{ points: draft.polygon || FALLBACK_POLYGON, type:'polygon', id:'fallback', role:'outline' }];
  }
  window.loadedPolyObjs = loadedPolys;
  _hasOutline = loadedPolys.some(o=>o.role==='outline');
  _guideAdded = false;
})();

/* ──────────────────────────────────────────────────────────
 * Build (polygon/ellipse/pen → walls/floor/roof)
 * ────────────────────────────────────────────────────────── */
function signedAreaXZ(vec2s){
  let a = 0;
  for (let i=0;i<vec2s.length;i++){
    const p = vec2s[i], q = vec2s[(i+1)%vec2s.length];
    a += (p.x * q.y) - (p.y * q.x);
  }
  return a * 0.5;
}

function buildOnePolygon(polyObj, baseHeight, floors, color = 0x9bb0c1){
  const rawPoints = polyObj.points;
  if (!rawPoints || rawPoints.length < 3) return;

  const polygonPx = rawPoints.map(([x, y]) => ({ x, y }));
  const PX_TO_UNIT = 0.3;
  const UNIT_PER_FLOOR = 15;
  const H = Math.max(1, Math.round(floors)) * UNIT_PER_FLOOR;

  const to3D = (p) => new THREE.Vector2(p.x * PX_TO_UNIT, (baseHeight - p.y) * PX_TO_UNIT);
  const pts = polygonPx.map(to3D);
  const N = pts.length;

  const isCCW = signedAreaXZ(pts) > 0;

  const oneGroup = new THREE.Group();
  const shapeKey = polyObj.id || THREE.MathUtils.generateUUID();
  oneGroup.userData.polyObj  = polyObj;
  oneGroup.userData.shapeKey = shapeKey;
  oneGroup.name = `oneGroup_${shapeKey}`;

  const wallsGroup = new THREE.Group();
  wallsGroup.name = WALLS_GROUP_NAME;
  oneGroup.add(wallsGroup);

  // Walls
  const edges = [];
  let totalLen = 0;
  for (let i=0;i<N;i++){
    const a=pts[i], b=pts[(i+1)%N];
    const len = Math.hypot(b.x-a.x, b.y-a.y);
    if (len > 1e-3) { edges.push({ i, a, b, len }); totalLen += len; }
  }
  let accum = 0;
  for (const e of edges){
    const { i, a, b, len } = e;
    const dx=b.x-a.x, dz=b.y-a.y;
    const midX=(a.x+b.x)/2, midZ=(a.y+b.y)/2;
    const ang=Math.atan2(dz,dx);

    let nx, nz;
    if (isCCW){ nx = -dz / (len || 1);  nz =  dx / (len || 1); }
    else      { nx =  dz / (len || 1);  nz = -dx / (len || 1); }

    const geo = new THREE.PlaneGeometry(len, H);
    const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(geo, mat);
    wall.name = 'wall';
    wall.position.set(midX, H/2, midZ);
    wall.rotation.set(0, -ang, 0);
    wall.castShadow = true;

    const isEllipse = (polyObj.type === 'ellipse');
    const chainId = isEllipse ? shapeKey : `${shapeKey}__edge_${i}`;

    wall.userData = {
      order: i,
      segLen: len,
      u0: accum / totalLen,
      u1: (accum + len) / totalLen,
      p0: { x: a.x, z: a.y },
      p1: { x: b.x, z: b.y },
      height: H,
      angle: -ang,
      chainId,
      nx, nz,
      shapeType: polyObj.type || 'polygon',
      shapeKey
    };
    accum += len;
    wallsGroup.add(wall);
  }

  // Floor/Roof
  const capShape = new THREE.Shape();
  pts.forEach((v,i)=> i===0 ? capShape.moveTo(v.x,v.y) : capShape.lineTo(v.x,v.y));
  capShape.closePath();

  const capGeo = new THREE.ShapeGeometry(capShape);
  capGeo.rotateX(-Math.PI/2);
  const capMat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });

  const floor = new THREE.Mesh(capGeo.clone(), capMat.clone());
  floor.name = 'floorCap'; floor.position.y = 0; floor.rotateX(Math.PI);

  const roof  = new THREE.Mesh(capGeo.clone(), capMat.clone());
  roof.name = 'roofCap';  roof.position.y = H;  roof.rotateX(Math.PI);

  wallsGroup.add(floor, roof);

  // Footprint template — outline 우선
  if (polyObj.role === 'outline' || (!_hasOutline && !_guideAdded)) {
    const edgesGeo = new THREE.EdgesGeometry(floor.geometry, 1);
    edgesGeo.rotateX(-Math.PI/2);
    floor.updateWorldMatrix(true,true);
    const tmpLine = new THREE.LineSegments(edgesGeo);
    tmpLine.applyMatrix4(floor.matrixWorld);

    const wp = new THREE.Vector3();
    floor.getWorldPosition(wp);
    floorWorldY = wp.y;

    footprintTemplates.push(tmpLine);
    _guideAdded = true;
  }

  buildingGroup.add(oneGroup);
}

function buildFromPolygons(polyObjs, baseHeight, floors){
  buildingGroup.children.slice().forEach(ch => { disposeObject3D(ch); buildingGroup.remove(ch); });
  footprintTemplates.forEach(t => t.traverse?.(o=>{ o.geometry?.dispose?.(); o.material?.dispose?.(); }));
  footprintTemplates = [];
  _guideAdded = false;

  buildingGroup.position.y = -20;
  const palette = [0x566373, 0x4b5563, 0x6b7280, 0x7b8794, 0x94a3b8];
  polyObjs.forEach((po, i)=> buildOnePolygon(po, baseHeight, floors, palette[i%palette.length]));

  autoFrame(buildingGroup, { fitOffset: 1.25 });
  updateBuildingBox();
  userBoundaries = userBoundaries.filter(y => y>baseY && y<roofY);
  drawBoundaryLines();
}

/* ──────────────────────────────────────────────────────────
 * Auto frame camera
 * ────────────────────────────────────────────────────────── */
function autoFrame(object, { fitOffset = 1.25 } = {}){
  if(!object) return;
  const box=new THREE.Box3().setFromObject(object);
  if(!isFinite(box.min.x) || !isFinite(box.max.x)) return;

  const size=new THREE.Vector3(), center=new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const sphere=new THREE.Sphere(); box.getBoundingSphere(sphere);

  const fovV=THREE.MathUtils.degToRad(camera.fov);
  const fovH=2*Math.atan(Math.tan(fovV/2)*camera.aspect);
  const distV=(sphere.radius*fitOffset)/Math.sin(fovV/2);
  const distH=(sphere.radius*fitOffset)/Math.sin(fovH/2);
  const distance=Math.max(distV, distH);

  const dir=new THREE.Vector3(1,1,1).normalize();
  controls.target.copy(center);
  camera.position.copy(center).add(dir.multiplyScalar(distance));

  const maxDim=Math.max(size.x,size.y,size.z);
  camera.near=Math.max(distance/1000,0.01);
  camera.far=distance+maxDim*20;
  camera.updateProjectionMatrix();
  controls.update();
}

/* ──────────────────────────────────────────────────────────
 * UI: floors
 * ────────────────────────────────────────────────────────── */
const floorsInput = document.getElementById('floors');
const buildBtn    = document.getElementById('createBuilding');
if (floorsInput) floorsInput.value = String(initialFloors);
function createBuilding(){
  const floors = Math.max(1, Number(floorsInput?.value || initialFloors || 1));
  buildFromPolygons(loadedPolys, baseHeight, floors);
}
createBuilding();
buildBtn?.addEventListener('click', createBuilding);

/* ──────────────────────────────────────────────────────────
 * Texture: dblclick
 *  - ellipse: 도형 체인 전체 래핑(차집합 반영)
 *  - 그 외: 클릭한 '변'의 허용구간만 래핑
 * ────────────────────────────────────────────────────────── */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const fileInput = document.getElementById('fileInput');
let pending = null; // { chain, parentGroup, hitWall, isEllipse }

function findOneGroupAndWalls(start){
  let node = start;
  while (node && node !== buildingGroup && node !== scene){
    if (node.parent === buildingGroup) break;
    node = node.parent;
  }
  if (!node || node === scene) return { oneGroup:null, wallsGroup:null };
  const oneGroup = node;
  const wallsGroup = oneGroup.getObjectByName(WALLS_GROUP_NAME);
  return { oneGroup, wallsGroup };
}
function getWallsChildren(){
  const out=[]; buildingGroup.children.forEach(one=>{
    const wg=one.getObjectByName(WALLS_GROUP_NAME); if(wg) out.push(...wg.children);
  }); return out;
}
function getWallsOnly(){ return getWallsChildren().filter(o => o.name!=='floorCap' && o.name!=='roofCap'); }
function raycast(evt, targets){
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((evt.clientX - rect.left)/rect.width)*2 - 1;
  mouse.y = -((evt.clientY - rect.top)/rect.height)*2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(targets, true);
  return hits[0] || null;
}

renderer.domElement.addEventListener('dblclick', (e)=>{
  if (mode!=='img') return;
  const hit = raycast(e, getWallsChildren());
  if (!hit) return;

  const hitWall = hit.object?.name === 'wall' ? hit.object : null;
  if (!hitWall) return;
  const { oneGroup, wallsGroup } = findOneGroupAndWalls(hitWall);
  if (!oneGroup || !wallsGroup) return;

  const chainId = hitWall.userData?.chainId;
  const chain = wallsGroup.children
    .filter(m => m.name==='wall' && m.userData?.chainId===chainId)
    .sort((a,b)=> (a.userData.order ?? 0) - (b.userData.order ?? 0));
  if (!chain.length) return;

  const shapeType = hitWall.userData?.shapeType || 'polygon';
  const isEllipse = (shapeType === 'ellipse');

  pending = { chain, parentGroup: oneGroup, hitWall, isEllipse };
  fileInput.value = '';
  fileInput.click();
});

fileInput?.addEventListener('change', (e)=>{
  const f = e.target.files?.[0];
  if (!f || !pending) return;

  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (baseTex)=>{
    baseTex.colorSpace = THREE.SRGBColorSpace;
    baseTex.wrapS = THREE.ClampToEdgeWrapping;
    baseTex.wrapT = THREE.ClampToEdgeWrapping;
    baseTex.flipY = false;

    const { chain, parentGroup, hitWall, isEllipse } = pending;
    const shapeObj = parentGroup.userData?.polyObj;
    const H = chain[0].userData.height;

    // blockers: 다른 도형들 (outline/self 제외)
    const shapePts = shapeObj?.points || [];
    const shBB = bboxFromPoints(shapePts);
    const blockerPolys = (window.loadedPolyObjs || [])
      .filter(o =>
        o !== shapeObj &&
        o.role !== 'outline' &&
        Array.isArray(o.points) && o.points.length >= 3 &&
        aabbIntersects(shBB, bboxFromPoints(o.points))
      )
      .map(o => o.points);

    // 차집합: blocked → allowed
    const blockedRaw = computeBlockedURanges(shapePts, blockerPolys);
    const perim = polyPerimeter(shapePts);
    const PAD_PIXEL = isEllipse ? 2 : 16;
    const padU = perim > 0 ? (PAD_PIXEL / perim) : 0;
    const blocked = inflateRanges(blockedRaw, padU);
    let allowed = complementRanges(blocked);

    // ── 비원형: 클릭된 '변'만 텍스처 ──
    if (!isEllipse){
      hitWall.material.dispose();

const tex = baseTex.clone();
tex.needsUpdate = true;
tex.generateMipmaps = false;
tex.minFilter = THREE.LinearFilter;
tex.magFilter = THREE.LinearFilter;
tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

// ⬇⬇ 상하 뒤집기(Repeat + repeat.y = -1 + offset.y = 1)
tex.wrapS = THREE.ClampToEdgeWrapping;
tex.wrapT = THREE.RepeatWrapping;
tex.repeat.y = -1;
tex.offset.y = 1;

      hitWall.material = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        color: 0xffffff,
        transparent: true
      });

      pending = null;
      return;
    }

    // ── 원형: 체인 래핑 + seam 보정 ──
    let offset=0;
    if (allowed.length){
      offset = allowed[0][0];
      const shiftU = (u)=>{ let x=u-offset; if(x<0)x+=1; return x; };
      allowed = allowed.map(([a,b])=>{
        let A=shiftU(a), B=shiftU(b);
        return (B<A) ? [[0,B],[A,1]] : [[A,B]];
      }).flat().sort((r1,r2)=>r1[0]-r2[0]);
      // merge
      const merged=[]; const EPS=1e-6;
      for(const [a,b] of allowed){
        if(!merged.length || a-merged[merged.length-1][1]>EPS) merged.push([a,b]);
        else merged[merged.length-1][1]=Math.max(merged[merged.length-1][1], b);
      }
      allowed = merged;
    }

    // 틈 방지: 허용구간을 미세 확장(bleed)
    const BLEED_PIXEL = 2;
    const bleedU = perim > 0 ? (BLEED_PIXEL / perim) : 0;
    allowed = expandRanges(allowed, bleedU);

    const segLens = allowed.map(([a,b])=>Math.max(0,b-a));
    const totalAllowed = segLens.reduce((s,v)=>s+v,0);
    if (totalAllowed <= 1e-6) { pending=null; return; }

    const accumStarts=[]; { let acc=0; for(let i=0;i<allowed.length;i++){accumStarts.push(acc); acc+=segLens[i];} }
    const unshiftU=(us)=>{ let x=us+offset; if(x>=1)x-=1; return x; };

    const chainLen = chain.reduce((s,w)=>s + (w.userData.segLen||0), 0) || 1;

    function posOnChain(uOrig){
      for(const w of chain){
        const {u0,u1,p0,p1,nx,nz} = w.userData;
        if (uOrig < u0 || uOrig > u1) continue;
        const t = (uOrig - u0) / Math.max(1e-9,(u1-u0));
        const x = p0.x + (p1.x - p0.x)*t;
        const z = p0.z + (p1.z - p0.z)*t;
        return {x,z,nx,nz};
      }
      const last = chain[chain.length-1].userData;
      return {x:last.p1.x, z:last.p1.z, nx:last.nx, nz:last.nz};
    }
    function packedU(us){
      for(let i=0;i<allowed.length;i++){
        const [a,b]=allowed[i];
        if(us>=a && us<=b){ const local=us-a; return (accumStarts[i]+local)/totalAllowed; }
      }
      return null;
    }

    // 이전 래핑 제거
    const wrapName = 'wrapGroup_chain';
    const prev = parentGroup.getObjectByName(wrapName);
    if (prev){ prev.userData?.hiddenWalls?.forEach(w=>w.visible=true); disposeObject3D(prev); parentGroup.remove(prev); }

    const tex = baseTex.clone();
    tex.needsUpdate = true;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    const wrap = new THREE.Group();
    wrap.name = wrapName;
    wrap.renderOrder = 10;
    parentGroup.add(wrap);

    // ★ 벽을 숨기지 않는다(틈이 생겨도 원래 벽이 받쳐줌)
    wrap.userData.hiddenWalls = [];

    // Build curved mesh along allowed ranges
    const positions=[], uvs=[], indices=[];
    const TARGET_STEP = 0.6;
    const eps = 0.004;
    let vertBase=0;
    const FLIP_U = false;

    for(let i=0;i<allowed.length;i++){
      const [sa,sb]=allowed[i];
      const usLen = (sb-sa);
      const sampleN = Math.max(2, Math.ceil((usLen*chainLen)/TARGET_STEP)) + 1;

      for(let k=0;k<sampleN;k++){
        const t = k/(sampleN-1);
        const us = sa + usLen*t;
        const u0 = unshiftU(us);
        const {x,z,nx,nz} = posOnChain(u0);

        const ox = x + nx*eps, oz = z + nz*eps;
        positions.push(ox,0,oz); positions.push(ox,H,oz);

        let uPacked = packedU(us);
        if (FLIP_U) uPacked = 1 - uPacked;

        // V 뒤집기: (0,1) → (1,0)
        uvs.push(uPacked, 1);
        uvs.push(uPacked, 0);

        if(k<sampleN-1){
          const a=vertBase+k*2, b=vertBase+k*2+1, c=vertBase+(k+1)*2, d=vertBase+(k+1)*2+1;
          indices.push(a,c,b, b,c,d);
        }
      }
      vertBase += sampleN*2;
    }

    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.DoubleSide,
      color: 0xffffff,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthTest: true,
      depthWrite: false,     // 깊이 버퍼 기록 금지(가이드 라인 보장)
      transparent: true
    });

    const curved=new THREE.Mesh(geo, mat);
    curved.name='curved_mesh';
    wrap.add(curved);

    pending = null;
  });
});

/* ──────────────────────────────────────────────────────────
 * Floors guide (click add / Alt|Meta remove)
 * ────────────────────────────────────────────────────────── */
const MIN_GAP = 0.5; // m
const SNAP    = 0.1; // m
const STORAGE_KEY = 'levels:B001';

function snapVal(v){ return Math.round(v / SNAP) * SNAP; }
function addBoundary(y){
  updateBuildingBox();
  if (!(y>baseY && y<roofY)) return false;
  y = snapVal(y);
  const all = [baseY, ...userBoundaries, roofY].sort((a,b)=>a-b);
  for (const b of all){ if (Math.abs(b - y) < MIN_GAP) return false; }
  userBoundaries.push(y);
  userBoundaries.sort((a,b)=>a-b);
  drawBoundaryLines();
  return true;
}
function removeBoundaryNear(y){
  updateBuildingBox();
  if (!userBoundaries.length) return false;
  const ySnap = snapVal(y);
  let bestIdx=-1, bestDist=Infinity;
  for (let i=0;i<userBoundaries.length;i++){
    const d = Math.abs(userBoundaries[i] - ySnap);
    if (d < bestDist){ bestDist=d; bestIdx=i; }
  }
  const THRESH = Math.max(MIN_GAP*1.5, SNAP*2);
  if (bestIdx!==-1 && bestDist<=THRESH){
    userBoundaries.splice(bestIdx,1);
    drawBoundaryLines();
    return true;
  }
  return false;
}
function currentBoundaries(){ return [baseY, ...userBoundaries, roofY]; }
function drawBoundaryLines(){
  if (boundaryLinesGroup){
    boundaryLinesGroup.traverse(o=>{ o.geometry?.dispose?.(); o.material?.dispose?.(); });
    scene.remove(boundaryLinesGroup);
    boundaryLinesGroup = null;
  }

  boundaryLinesGroup = new THREE.Group();
  boundaryLinesGroup.renderOrder = 9999;
  scene.add(boundaryLinesGroup);
  if (!footprintTemplates.length) return;

  for (const y of currentBoundaries()){
    for (const tpl of footprintTemplates){
      const line = new THREE.LineSegments(
        tpl.geometry.clone(),
        new THREE.LineBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.9,
          depthTest: true,   // 뒤쪽(통과선)은 가려짐
          depthWrite: false  // 깊이 버퍼를 덮지 않음
        })
      );
      line.renderOrder = 9999;
      line.rotation.x = -Math.PI/2;
      line.position.y = y;
      boundaryLinesGroup.add(line);
    }
  }
}

renderer.domElement.addEventListener('click', (e)=>{
  if (mode!=='floor') return;
  const hit = raycast(e, getWallsOnly());
  if (!hit) return;
  const y = hit.point.y;
  if (e.altKey || e.metaKey) removeBoundaryNear(y);
  else addBoundary(y);
});

document.getElementById('btnSaveLevels')?.addEventListener('click', ()=>{
  const payload = { version:1, buildingId:'B001', baseY, roofY, userBoundaries: userBoundaries.slice(), boundaries: currentBoundaries() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.location.href = 'floor_add.html';
});
document.getElementById('btnClearGuides')?.addEventListener('click', ()=>{
  if (boundaryLinesGroup){ scene.remove(boundaryLinesGroup); boundaryLinesGroup=null; }
});

/* ──────────────────────────────────────────────────────────
 * Resize / Render
 * ────────────────────────────────────────────────────────── */
function onResize(){
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  autoFrame(buildingGroup, { fitOffset: 1.25 });
}
window.addEventListener('resize', onResize);
if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(container);

renderer.setAnimationLoop(()=>{
  controls.update();
  renderer.render(scene, camera);
});

// Init
updateBuildingBox();
drawBoundaryLines();
