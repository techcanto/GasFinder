// Configuración
const CONFIG = {
    MAX_RADIUS_KM: 50,
    MAP_ZOOM: 12,
    USER_ICON_URL: 'https://cdn-icons-png.flaticon.com/512/447/447031.png',
    GAS_ICON_URL: 'https://imgs.search.brave.com/Rvv7DohECh3EPbF_pkOcA3AAWcSQB7HAI3VLbeY8q-Y/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly91cGxv/YWQud2lraW1lZGlh/Lm9yZy93aWtpcGVk/aWEvY29tbW9ucy85/Lzk5L0xvZ29fUGV0/ciVDMyVCM2xlb3Nf/TWV4aWNhbm9zLnN2/Zw'
};

// Variables globales
let map;
let userMarker;
let coverageCircle;
let userLat, userLon;

// Inicialización del mapa
function initMap() {
    map = L.map('map').setView([23.6345, -102.5528], 5);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
}

// Iconos personalizados
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

// Cargar datos XML
async function loadXMLFile(filename) {
    try {
        const response = await fetch(`${filename}?t=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error(`Error loading ${filename}:`, error);
        throw error;
    }
}

// Procesar datos de gasolineras
async function loadGasStations() {
    try {
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

            // Obtener precios
            const prices = {};
            const priceNode = pricesDoc.querySelector(`place[place_id="${placeId}"]`);
            if (priceNode) {
                const priceElements = priceNode.getElementsByTagName('gas_price');
                for (let priceEl of priceElements) {
                    const type = priceEl.getAttribute('type');
                    const value = parseFloat(priceEl.textContent);
                    prices[type] = value;
                }
            }

            stations.push({
                id: placeId,
                name,
                cre_id: creId,
                lat,
                lon,
                prices
            });
        }

        return stations;
    } catch (error) {
        console.error("Error loading station data:", error);
        throw error;
    }
}

// Calcular distancia entre coordenadas
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Filtrar gasolineras por distancia
function filterStationsByDistance(stations, centerLat, centerLon, radiusKm) {
    return stations.map(station => {
        const distance = calculateDistance(centerLat, centerLon, station.lat, station.lon);
        return { ...station, distance };
    }).filter(station => station.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);
}

// Formatear precios para mostrar
function formatPrices(prices) {
    if (!prices || Object.keys(prices).length === 0) {
        return '<div class="loading">Precios no disponibles</div>';
    }
    
    let html = '';
    for (const [type, price] of Object.entries(prices)) {
        const typeClass = type.toLowerCase();
        html += `<div class="price-tag ${typeClass}">
            <i class="fas fa-${typeClass === 'diesel' ? 'oil-can' : 'gas-pump'}"></i>
            ${type.charAt(0).toUpperCase() + type.slice(1)}: $${price.toFixed(2)}
        </div>`;
    }
    return html;
}

// Mostrar gasolineras en el mapa
function displayStationsOnMap(stations, gasIcon) {
    // Limpiar marcadores existentes
    if (window.stationMarkers) {
        window.stationMarkers.forEach(marker => map.removeLayer(marker));
    }
    
    window.stationMarkers = [];
    
    stations.forEach(station => {
        const popupContent = `
            <div class="station-name">${station.name}</div>
            <div class="distance-badge">
                <i class="fas fa-map-marker-alt"></i> ${station.distance.toFixed(2)} km
            </div>
            <div style="margin-top: 8px;">
                ${formatPrices(station.prices)}
            </div>
        `;
        
        const marker = L.marker([station.lat, station.lon], { icon: gasIcon })
            .addTo(map)
            .bindPopup(popupContent);
        
        window.stationMarkers.push(marker);
    });
}

// Actualizar la interfaz de usuario
function updateUI(stations, closestStation) {
    const stationCountElement = document.getElementById('stationCount');
    const closestStationElement = document.getElementById('closestStation');
    const noStationsElement = document.getElementById('noStationsMessage');
    
    if (stations.length === 0) {
        stationCountElement.innerHTML = `
            <strong>Radio de búsqueda:</strong> ${CONFIG.MAX_RADIUS_KM} km
        `;
        closestStationElement.innerHTML = '';
        noStationsElement.style.display = 'block';
        noStationsElement.innerHTML = `
            <i class="fas fa-exclamation-circle"></i> No hay gasolineras dentro del radio de ${CONFIG.MAX_RADIUS_KM}km
        `;
    } else {
        noStationsElement.style.display = 'none';
        stationCountElement.innerHTML = `
            <strong>Gasolineras cercanas (${CONFIG.MAX_RADIUS_KM}km):</strong> ${stations.length}
        `;
        
        if (closestStation) {
            closestStationElement.innerHTML = `
                <hr style="margin: 10px 0;">
                <div style="font-weight: 500; margin-bottom: 5px;">
                    <i class="fas fa-star" style="color: #f39c12;"></i> Más cercana:
                </div>
                <div style="margin-bottom: 5px;">${closestStation.name}</div>
                <div class="distance-badge" style="display: inline-block;">
                    <i class="fas fa-map-marker-alt"></i> ${closestStation.distance.toFixed(2)} km
                </div>
                <div style="margin-top: 8px;">
                    ${formatPrices(closestStation.prices)}
                </div>
            `;
        }
    }
}

// Dibujar área de cobertura
function drawCoverageArea(lat, lon) {
    if (coverageCircle) {
        map.removeLayer(coverageCircle);
    }
    
    coverageCircle = L.circle([lat, lon], {
        color: '#0078A8',
        fillColor: '#0078A8',
        fillOpacity: 0.1,
        radius: CONFIG.MAX_RADIUS_KM * 1000
    }).addTo(map);
}

// Obtener ubicación del usuario
async function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation not supported"));
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            position => resolve(position),
            error => reject(error),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

// Inicializar la aplicación
async function initApp() {
    try {
        // Inicializar mapa
        initMap();
        const { userIcon, gasIcon } = createIcons();
        
        // Obtener ubicación del usuario
        const position = await getUserLocation();
        userLat = position.coords.latitude;
        userLon = position.coords.longitude;
        
        // Actualizar UI de ubicación
        document.getElementById('userLocation').innerHTML = `
            <i class="fas fa-map-marker-alt"></i>
            <span>Lat: ${userLat.toFixed(5)}, Lon: ${userLon.toFixed(5)}</span>
        `;
        
        // Centrar mapa en la ubicación del usuario
        map.setView([userLat, userLon], CONFIG.MAP_ZOOM);
        
        // Añadir marcador del usuario
        userMarker = L.marker([userLat, userLon], { icon: userIcon })
            .addTo(map)
            .bindPopup('<b>Tu ubicacion actual</b>')
            .openPopup();
        
        // Dibujar área de cobertura
        drawCoverageArea(userLat, userLon);
        
        // Cargar y mostrar gasolineras
        const allStations = await loadGasStations();
        const nearbyStations = filterStationsByDistance(allStations, userLat, userLon, CONFIG.MAX_RADIUS_KM);
        
        // Mostrar en el mapa
        displayStationsOnMap(nearbyStations, gasIcon);
        
        // Encontrar la más cercana
        const closestStation = nearbyStations.length > 0 ? nearbyStations[0] : null;
        
        // Actualizar UI
        updateUI(nearbyStations, closestStation);
        
    } catch (error) {
        console.error("Error in app initialization:", error);
        
        // Manejo de errores
        document.getElementById('userLocation').innerHTML = `
            <i class="fas fa-map-marker-alt"></i>
            <span>Ubicación no disponible</span>
        `;
        
        document.getElementById('stationCount').innerHTML = `
            <strong>Error al cargar datos</strong>
        `;
        
        // Cargar todas las estaciones como fallback
        try {
            const allStations = await loadGasStations();
            displayStationsOnMap(allStations, gasIcon);
            updateUI(allStations, null);
        } catch (e) {
            console.error("Failed to load stations as fallback:", e);
        }
    }
}

// Iniciar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initApp);
