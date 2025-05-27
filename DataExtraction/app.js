// app.js actualizado con OSRM y rutas paso a paso

console.log("Estoy en app.js de Test1");


const CONFIG = {
    MAX_RADIUS_KM: 5,
    MAP_ZOOM: 12,
    USER_ICON_URL: 'https://cdn-icons-png.flaticon.com/512/447/447031.png',
    GAS_ICON_URL: 'https://imgs.search.brave.com/Rvv7DohECh3EPbF_pkOcA3AAWcSQB7HAI3VLbeY8q-Y/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly91cGxv/YWQud2lraW1lZGlh/Lm9yZy93aWtpcGVk/aWEvY29tbW9ucy85/Lzk5L0xvZ29fUGV0/ciVDMyVCM2xlb3Nf/TWV4aWNhbm9zLnN2/Zw'
};

let map;
let userMarker;
let coverageCircle;
let routeLine;
let routeSteps = [];
let userLat, userLon;

function initMap() {
    map = L.map('map').setView([23.6345, -102.5528], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
}

function createIcons() {
    const userIcon = L.icon({
        iconUrl: CONFIG.USER_ICON_URL,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });

    const gasIcon = L.icon({
        iconUrl: CONFIG.GAS_ICON_URL,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28]
    });

    return { userIcon, gasIcon };
}

async function loadXMLFile(filename) {
    const response = await fetch(`${filename}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`Error cargando ${filename}`);
    return await response.text();
}

async function loadGasStations() {
    const [locationsText, pricesText] = await Promise.all([
        loadXMLFile('estaciones.xml'),
        loadXMLFile('precios.xml')
    ]);

    const parser = new DOMParser();
    const locationsDoc = parser.parseFromString(locationsText, "text/xml");
    const pricesDoc = parser.parseFromString(pricesText, "text/xml");

    const stations = [];
    const placeNodes = locationsDoc.getElementsByTagName('place');

    for (let node of placeNodes) {
        const placeId = node.getAttribute('place_id');
        const name = node.getElementsByTagName('name')[0].textContent;
        const creId = node.getElementsByTagName('cre_id')[0].textContent;
        const lon = parseFloat(node.getElementsByTagName('x')[0].textContent);
        const lat = parseFloat(node.getElementsByTagName('y')[0].textContent);

        const prices = {};
        const priceNode = pricesDoc.querySelector(`place[place_id="${placeId}"]`);
        if (priceNode) {
            for (let priceEl of priceNode.getElementsByTagName('gas_price')) {
                prices[priceEl.getAttribute('type')] = parseFloat(priceEl.textContent);
            }
        }

        stations.push({ id: placeId, name, cre_id: creId, lat, lon, prices });
    }

    return stations;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2)**2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function filterStationsByDistance(stations, lat, lon, radiusKm) {
    return stations.map(s => {
        const dist = calculateDistance(lat, lon, s.lat, s.lon);
        return { ...s, distance: dist };
    }).filter(s => s.distance <= radiusKm).sort((a, b) => a.distance - b.distance);
}

function formatPrices(prices) {
    if (!prices || Object.keys(prices).length === 0) return '<div class="loading">Precios no disponibles</div>';
    return Object.entries(prices).map(([type, price]) => `
        <div class="price-tag ${type.toLowerCase()}">
            <i class="fas fa-${type === 'diesel' ? 'oil-can' : 'gas-pump'}"></i>
            ${type.charAt(0).toUpperCase() + type.slice(1)}: $${price.toFixed(2)}
        </div>
    `).join('');
}

function displayStationsOnMap(stations, gasIcon) {
    if (window.stationMarkers) window.stationMarkers.forEach(m => map.removeLayer(m));
    window.stationMarkers = [];

    stations.forEach(station => {
        const content = `
            <div class="station-name">${station.name}</div>
            <div class="distance-badge">${station.distance.toFixed(2)} km</div>
            ${formatPrices(station.prices)}
            <button onclick='drawRouteToClosestStation(${userLat}, ${userLon}, ${JSON.stringify(station).replace(/"/g, "&quot;")})' class="refresh-btn" style="margin-top: 8px; font-size: 0.8em;">
                <i class="fas fa-route"></i> Ruta a esta
            </button>
        `;

        const marker = L.marker([station.lat, station.lon], { icon: gasIcon })
            .addTo(map)
            .bindPopup(content);

        window.stationMarkers.push(marker);
    });
}

function drawCoverageArea(lat, lon) {
    if (coverageCircle) map.removeLayer(coverageCircle);
    coverageCircle = L.circle([lat, lon], {
        color: '#0078A8',
        fillColor: '#0078A8',
        fillOpacity: 0.1,
        radius: CONFIG.MAX_RADIUS_KM * 1000
    }).addTo(map);
}

async function drawRouteToClosestStation(userLat, userLon, station) {
    if (routeLine) map.removeLayer(routeLine);
    routeSteps = [];

    const url = `https://router.project-osrm.org/route/v1/driving/${userLon},${userLat};${station.lon},${station.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    if (!res.ok) return console.error('Error obteniendo ruta');

    const data = await res.json();
    const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    routeSteps = data.routes[0].legs[0].steps.map(s => s.maneuver.instruction);

    routeLine = L.polyline(coords, { color: '#e67e22', weight: 4 }).addTo(map);
}



function updateUI(stations, closest) {
    const sc = document.getElementById('stationCount');
    const cs = document.getElementById('closestStation');
    const msg = document.getElementById('noStationsMessage');

    if (stations.length === 0) {
        sc.innerHTML = `<strong>Radio de búsqueda:</strong> ${CONFIG.MAX_RADIUS_KM} km`;
        cs.innerHTML = '';
        msg.style.display = 'block';
        msg.innerHTML = `<i class="fas fa-exclamation-circle"></i> No hay gasolineras cercanas`;
    } else {
        msg.style.display = 'none';
        sc.innerHTML = `<strong>Gasolineras cercanas (${CONFIG.MAX_RADIUS_KM}km):</strong> ${stations.length}`;
        if (closest) {
            cs.innerHTML = `
                <hr><div><i class="fas fa-star" style="color: #f39c12;"></i> Mas cercana:</div>
                <div>${closest.name}</div>
                <div class="distance-badge">${closest.distance.toFixed(2)} km</div>
                <div>${formatPrices(closest.prices)}</div>
            `;
        }
    }
}

async function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject("Geolocation no disponible");
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    });
}

async function initApp() {
    try {
        initMap();
        const { userIcon, gasIcon } = createIcons();
        const pos = await getUserLocation();
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;

        document.getElementById('userLocation').innerHTML = `
            <i class="fas fa-map-marker-alt"></i> Lat: ${userLat.toFixed(5)}, Lon: ${userLon.toFixed(5)}
        `;

        map.setView([userLat, userLon], CONFIG.MAP_ZOOM);
        userMarker = L.marker([userLat, userLon], { icon: userIcon }).addTo(map).bindPopup("Tu ubicacion").openPopup();
        drawCoverageArea(userLat, userLon);

        const allStations = await loadGasStations();
        const nearbyStations = filterStationsByDistance(allStations, userLat, userLon, CONFIG.MAX_RADIUS_KM);
        displayStationsOnMap(nearbyStations, gasIcon);

        const closest = nearbyStations[0] || null;
        updateUI(nearbyStations, closest);
        if (closest) await drawRouteToClosestStation(userLat, userLon, closest);

    } catch (err) {
        console.error(err);
        document.getElementById('userLocation').innerHTML = `<i class="fas fa-map-marker-alt"></i> Ubicacion no disponible`;
        document.getElementById('stationCount').innerHTML = `<strong>Error al cargar datos</strong>`;
    }
}

document.addEventListener('DOMContentLoaded', initApp);


document.addEventListener('DOMContentLoaded', () => {
    const stepsBtn = document.getElementById('showStepsBtn');
    const stepsContainer = document.getElementById('routeSteps');

    if (stepsBtn) {
        stepsBtn.addEventListener('click', () => {
            if (stepsContainer.style.display === 'none') {
                stepsContainer.innerHTML = routeSteps.length
                    ? '<strong>Instrucciones:</strong><ol>' + routeSteps.map(s => `<li>${s}</li>`).join('') + '</ol>'
                    : 'Ruta no disponible.';
                stepsContainer.style.display = 'block';
            } else {
                stepsContainer.style.display = 'none';
            }
        });
    }
});

