/* building_osm.js — 주소 검색 → 건물 선택 → 좌표 저장 → building_img.html */

const ui = {
    addrInput: document.getElementById('addrInput'),
    searchBtn: document.getElementById('searchBtn'),
    addrList: document.getElementById('addrList'),
    bldgList: document.getElementById('bldgList'),
    status: document.getElementById('status')
};

let map = L.map('map').setView([35.681236, 139.767125], 14); // 도쿄역
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let pin = null, buildingLayer = null, pickedRef = null;

ui.searchBtn.addEventListener('click', doGeocode);
ui.addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') doGeocode(); });

async function doGeocode() {
    const q = (ui.addrInput.value || '').trim();
    if (!q) return;
    ui.addrList.innerHTML = '<li>検索中…</li>';
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=jp&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const list = await res.json();
    ui.addrList.innerHTML = '';
    list.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item.display_name;
        li.addEventListener('click', () => pickAddress(item));
        ui.addrList.appendChild(li);
    });
}

async function pickAddress(item) {
    const lat = Number(item.lat), lon = Number(item.lon);
    pickedRef = { lat, lon };
    if (pin) map.removeLayer(pin);
    pin = L.marker([lat, lon]).addTo(map).bindPopup(item.display_name).openPopup();
    map.setView([lat, lon], 18);

    await loadBuildingsAround(lat, lon);
}

async function loadBuildingsAround(lat, lon) {
    const R = 120;
    ui.bldgList.innerHTML = '<li>建物検索中…</li>';
    const q = `[out:json][timeout:25];
  (way(around:${R},${lat},${lon})["building"];
   relation(around:${R},${lat},${lon})["building"];);
  out geom tags qt;`;

    const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent(q)
    });
    if (!resp.ok) { ui.bldgList.innerHTML = '<li>検索失敗</li>'; return; }
    const data = await resp.json();
    const fc = elementsToGeoJSON(data.elements || []);

    if (buildingLayer) map.removeLayer(buildingLayer);
    buildingLayer = L.geoJSON(fc, {
        style: { color: '#2c7', weight: 2, fillOpacity: 0.2 },
        onEachFeature: (f, layer) => {
            const name = f.properties.name || f.properties.building || '建物';
            layer.bindTooltip(name, { sticky: true });
            layer.on('click', () => selectBuildingFeature(f));
        }
    }).addTo(map);

    ui.bldgList.innerHTML = '';
    fc.features.forEach(f => {
        const name = f.properties.name || f.properties.building || '建物';
        const li = document.createElement('li');
        li.textContent = name;
        li.addEventListener('click', () => selectBuildingFeature(f));
        ui.bldgList.appendChild(li);
    });
}

function selectBuildingFeature(feature) {
    const ring = featureOuterRing(feature);
    if (!ring) return alert('外郭取得失敗');
    // lon/lat 배열
    const coords = ring.map(([lon, lat]) => [lon, lat]);
    const payload = { coords, ts: Date.now() };
    sessionStorage.setItem('floorCoordsPayload', JSON.stringify(payload));
    sessionStorage.setItem('buildingMeta', JSON.stringify({
        pickedAddress: pin?.getPopup()?.getContent() || '',
        centerWgs84: pickedRef
    }));
    location.href = '/pages/building_img.html';
}

// ========== GeoJSON 변환 유틸 ==============
function elementsToGeoJSON(elements) {
    const ways = new Map();
    elements.forEach(el => { if (el.type === 'way' && el.geometry?.length >= 3) ways.set(el.id, el); });
    const feats = [];
    elements.forEach(el => {
        if (el.type === 'way' && el.geometry?.length >= 3) {
            const ring = closeRing(el.geometry.map(g => [g.lon, g.lat]));
            if (ring) feats.push({ type: 'Feature', properties: el.tags || {}, geometry: { type: 'Polygon', coordinates: [ring] } });
        }
        if (el.type === 'relation' && Array.isArray(el.members)) {
            const outers = [];
            el.members.forEach(m => {
                if (m.type === 'way' && ways.has(m.ref)) {
                    const w = ways.get(m.ref);
                    const ring = closeRing(w.geometry.map(g => [g.lon, g.lat]));
                    if (ring) outers.push(ring);
                }
            });
            outers.forEach(r => {
                feats.push({ type: 'Feature', properties: el.tags || {}, geometry: { type: 'Polygon', coordinates: [r] } });
            });
        }
    });
    return { type: 'FeatureCollection', features: feats };
}
function closeRing(coords) {
    if (!coords || coords.length < 3) return null;
    const a = coords[0], b = coords[coords.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) coords = coords.concat([a]);
    return coords;
}
function featureOuterRing(f) {
    const g = f.geometry;
    if (!g) return null;
    if (g.type === 'Polygon') return g.coordinates[0];
    if (g.type === 'MultiPolygon') return g.coordinates[0][0];
    return null;
}
