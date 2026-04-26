// ================= PARTICLES =================
tsParticles.load("tsparticles",{
    particles:{
        number:{value:60},
        size:{value:3},
        move:{enable:true,speed:1},
        color:{value:"#ffffff"}
    }
});

// ================= VIEWS & SLIDES =================
const landing = document.getElementById("landing");
const searchView = document.getElementById("search-view");
const resultsView = document.getElementById("results-view");
const liveClock = document.getElementById("live-clock");
const newSearchBtn = document.getElementById("new-search-btn");
const clearMapBtn = document.getElementById("clear-map-btn");
const aiAssistantBtn = document.getElementById("ai-assistant-btn");
const aiChatWindow = document.getElementById("ai-chat-window");
const aiChatCloseBtn = document.getElementById("ai-chat-close");
const aiChatForm = document.getElementById("ai-chat-form");
const aiChatInput = document.getElementById("ai-chat-input");
const aiChatMessages = document.getElementById("ai-chat-messages");

function getApiBaseUrl() {
    // If opened directly as a file, fallback to localhost backend.
    if (window.location.protocol === "file:") {
        return "http://localhost:5000";
    }
    const host = window.location.hostname || "localhost";
    return `${window.location.protocol}//${host}:5000`;
}
const API_BASE_URL = getApiBaseUrl();

// Landing -> Search
if (landing) {
    landing.addEventListener("click", () => {
        landing.classList.remove("active");
        landing.classList.add("slide-top"); 

        searchView.classList.remove("slide-bottom"); 
        searchView.classList.add("active"); 
    });
}

function updateLiveClock() {
    if (!liveClock) return;
    const now = new Date();
    liveClock.textContent = now.toLocaleTimeString("en-IN", { hour12: false });
}
updateLiveClock();
setInterval(updateLiveClock, 1000);

// ================= AUTOCOMPLETE (Live DB — Debounced, Lightning Fast) =================

/**
 * Highlights the matching portion of a stop name in neon cyan.
 * Returns an HTML string safe for innerHTML injection.
 */
function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return (
        escapeHtml(text.slice(0, idx)) +
        `<mark class="ac-highlight">${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
        escapeHtml(text.slice(idx + query.length))
    );
}
function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * setupAutocomplete — wires debounced suggest on a given input ID.
 *   • 300 ms debounce before API call
 *   • Max 5 suggestions from /api/stops/suggest
 *   • On select: fills input, closes dropdown, and fires searchBus()
 *   • Closes on outside click
 */
function setupAutocomplete(id) {
    const input = document.getElementById(id);
    if (!input) return;

    let debounceTimer = null;

    input.addEventListener('input', function () {
        const val = this.value.trim();
        closeLists();
        if (val.length < 2) return;

        clearTimeout(debounceTimer);
        // ── 300ms debounce: only ping server after user pauses typing ──
        debounceTimer = setTimeout(async () => {
            try {
                console.log('[Autocomplete] Sending fetch request for:', val); // DEBUG LOG
                const res = await fetch(
                    `${API_BASE_URL}/api/stops/suggest?q=${encodeURIComponent(val)}`
                );
                if (!res.ok) return;
                const stops = await res.json();
                closeLists();
                if (!stops || !stops.length) return;

                // Build the dropdown absolutely positioned below the input
                const list = document.createElement('div');
                list.setAttribute('id', `ac-list-${id}`);
                list.className = 'autocomplete-list';
                // Append to the .field wrapper (parent of input) for correct positioning
                input.parentNode.appendChild(list);

                stops.forEach((stop, i) => {
                    const item = document.createElement('div');
                    item.className = 'ac-item';
                    item.setAttribute('role', 'option');
                    item.setAttribute('tabindex', '0');
                    // Highlight matched text in neon cyan
                    item.innerHTML = `<span class="ac-icon">📍</span><span class="ac-name">${highlightMatch(stop.name, val)}</span>`;

                    item.addEventListener('mousedown', (e) => {
                        // mousedown fires before blur so we prevent input losing focus first
                        e.preventDefault();
                    });

                    item.addEventListener('click', () => {
                        input.value = stop.name;
                        closeLists();
                        // Auto-trigger the main search so user doesn't need to press Search
                        if (typeof searchBus === 'function') {
                            // Only auto-search if both fields are filled
                            const otherId = id === 'from' ? 'to' : 'from';
                            const otherInput = document.getElementById(otherId);
                            if (otherInput && otherInput.value.trim().length >= 2) {
                                searchBus();
                            }
                        }
                    });

                    // Support keyboard navigation
                    item.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') item.click();
                        if (e.key === 'Escape') closeLists();
                    });

                    list.appendChild(item);
                });

                // Animate dropdown in
                requestAnimationFrame(() => list.classList.add('ac-visible'));

            } catch (_) { /* silent fail — user can still type manually */ }
        }, 300); // ← 300ms debounce window
    });

    // Close dropdown when input loses focus (with slight delay for click to register)
    input.addEventListener('blur', () => {
        setTimeout(closeLists, 150);
    });

    // Close on Escape key
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLists();
    });
}

/** Remove all open autocomplete dropdowns from the DOM */
function closeLists() {
    document.querySelectorAll('.autocomplete-list').forEach(el => {
        el.classList.remove('ac-visible');
        setTimeout(() => el.remove(), 180); // wait for fade-out transition
    });
}

// Close all lists if user clicks anywhere outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.field')) closeLists();
});

setupAutocomplete('from');
setupAutocomplete('to');



// ================= SWAP (With Animation) =================
function swapStops() {
    const fromInput = document.getElementById("from");
    const toInput = document.getElementById("to");
    const swapBtn = document.querySelector(".swap-btn");

    if(!fromInput || !toInput) return;

    fromInput.classList.add("swap-down");
    toInput.classList.add("swap-up");
    if(swapBtn) swapBtn.classList.add("spin");

    setTimeout(() => {
        let temp = fromInput.value;
        fromInput.value = toInput.value;
        toInput.value = temp;

        fromInput.style.transition = "none";
        toInput.style.transition = "none";
        if(swapBtn) swapBtn.style.transition = "none";

        fromInput.classList.remove("swap-down");
        toInput.classList.remove("swap-up");
        if(swapBtn) swapBtn.classList.remove("spin");

        void fromInput.offsetHeight; 

        fromInput.style.transition = "";
        toInput.style.transition = "";
        if(swapBtn) swapBtn.style.transition = "";
        
    }, 300); 
}

// ================= MAP INITIALIZATION — Framer Tier =================
let map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([17.3850, 78.4867], 12);

// Add zoom control top-right so it doesn't clash with sidebar
L.control.zoom({ position: 'topright' }).addTo(map);

// CartoDB Dark Matter No-Labels — pitch-black canvas, our neon pops
let darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
});
// Outdoor fallback (labels visible in light mode)
let lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
});

darkTiles.addTo(map);
let isDarkMap = true;

let currentRouteLine = null;
let buses = [];
let stopMarkers = [];
let activeBusInterval = null;

// ================= MAP THEME TOGGLE =================
function toggleMapTheme() {
    let toggleBtn = document.getElementById("theme-toggle");
    
    if (isDarkMap) {
        map.removeLayer(darkTiles);
        lightTiles.addTo(map);
        isDarkMap = false;
        toggleBtn.innerText = "🌙 Night Mode";
        toggleBtn.style.background = "rgba(0, 0, 0, 0.4)"; 
    } else {
        map.removeLayer(lightTiles);
        darkTiles.addTo(map);
        isDarkMap = true;
        toggleBtn.innerText = "🌞 Outdoor Mode";
        toggleBtn.style.background = "rgba(255, 255, 255, 0.1)"; 
    }
}

function formatGTFSTime(timeString) {
    if (!timeString) return "Unknown";
    if (!timeString.includes(':')) return timeString;
    
    let parts = timeString.split(':');
    let hours = parseInt(parts[0], 10);
    let minutes = parseInt(parts[1], 10);
    
    if (isNaN(hours) || isNaN(minutes)) return timeString;
    
    let isNextDay = false;
    if (hours >= 24) {
        hours -= 24;
        isNextDay = true;
    }
    
    let ampm = hours >= 12 ? 'PM' : 'AM';
    let formattedHours = hours % 12;
    formattedHours = formattedHours ? formattedHours : 12;
    let formattedMins = minutes < 10 ? '0' + minutes : minutes;
    
    let result = `${formattedHours}:${formattedMins} ${ampm}`;
    if (isNextDay) {
        result += " Next Day";
    }
    return result;
}

// ================= SEARCH & TRANSITION =================
async function searchBus() {
    let fromVal = document.getElementById("from").value;
    let toVal = document.getElementById("to").value;
    let travelType = document.querySelector('input[name="travelType"]:checked').value;
    let scheduledTime = document.getElementById("time").value;

    let loader = document.getElementById("loader");
    let results = document.getElementById("results");
    let hoverSound = document.getElementById("hover-sound");

    if (!fromVal || !toVal) {
        alert("System Error: Please enter both an origin and destination.");
        return;
    }

    loader.classList.remove("hidden");
    results.innerHTML = "";

    try {
        // Fire search + geocoding all in parallel — do NOT await sequentially
        const [response, startCoords, endCoords] = await Promise.all([
            fetch(`${API_BASE_URL}/api/search?from=${encodeURIComponent(fromVal)}&to=${encodeURIComponent(toVal)}&travelType=${encodeURIComponent(travelType)}&scheduledTime=${encodeURIComponent(scheduledTime)}`),
            getCoordinates(fromVal).catch(() => null),
            getCoordinates(toVal).catch(() => null)
        ]);

        if (!response.ok) throw new Error(`Search request failed (${response.status})`);
        let liveBusData = await response.json();

        let distanceKm = 8;    // default fallback
        let durationMins = 25; // default fallback

        // ORS route call fired non-blocking after coords arrive
        if (startCoords && endCoords) {
            try {
                let url = `${API_BASE_URL}/api/route?startLat=${encodeURIComponent(startCoords[0])}&startLon=${encodeURIComponent(startCoords[1])}&endLat=${encodeURIComponent(endCoords[0])}&endLon=${encodeURIComponent(endCoords[1])}`;
                let routeRes = await fetch(url);
                if (routeRes && routeRes.ok) {
                    let routeData = await routeRes.json();
                    if (routeData.summary) {
                        distanceKm  = (routeData.summary.distance || 0) / 1000;
                        durationMins = (routeData.summary.duration || 0) / 60;
                    }
                }
            } catch(_) {}
        }

        let busCost = 15 + Math.max(0, distanceKm) * 2;
        let metroCost = Math.min(60, 10 + Math.max(0, distanceKm) * 2);
        let rapidoCost = 25 + Math.max(0, distanceKm) * 8;
        let uberCost = 60 + Math.max(0, distanceKm) * 18;

        let busTime = Math.max(1, Math.round(durationMins + 15));
        let metroTime = Math.max(1, Math.round(durationMins / 1.5));
        let rapidoTime = Math.max(1, Math.round(durationMins - 5));
        let uberTime = Math.max(1, Math.round(durationMins + 5));

        loader.classList.add("hidden");

        // Always show the multi-modal comparison table
        results.innerHTML = `
            <div class="comparison-table">
                <div class="comp-row comp-head">
                    <span>Mode</span>
                    <span>Est. Cost</span>
                    <span>Est. Time</span>
                </div>
                <div class="comp-row">
                    <span>🚌 Bus</span>
                    <span class="cost-green">₹${Math.round(busCost)}</span>
                    <span>~${busTime} mins</span>
                </div>
                <div class="comp-row">
                    <span>🚇 Metro</span>
                    <span class="cost-green">₹${Math.round(metroCost)}</span>
                    <span>~${metroTime} mins</span>
                </div>
                <div class="comp-row">
                    <span>🛵 Rapido</span>
                    <span>₹${Math.round(rapidoCost)}</span>
                    <span>~${rapidoTime} mins</span>
                </div>
                <div class="comp-row">
                    <span>🚗 Uber</span>
                    <span class="cost-red">₹${Math.round(uberCost)}</span>
                    <span>~${uberTime} mins</span>
                </div>
            </div>
        `;

        if (liveBusData.length === 0) {
            results.innerHTML += `
                <div class="bus-card" style="text-align:center; cursor:default; opacity:0.8;">
                    <h3 style="margin:0; color:#fca5a5;">&#x1F6AB; No Direct Buses Found</h3>
                    <p style="margin-top:8px; color:#ccc;">No direct buses found for this exact route.</p>
                    <p style="font-size:0.8rem; color:#888; margin-top:4px;">Try swapping stops or checking a nearby area.</p>
                </div>
            `;
        } else {
            liveBusData.forEach(bus => {
                let fareCost = bus.isMetro ? metroCost : busCost;
                let displayTime = formatGTFSTime(bus.arrival);
                
                results.innerHTML += `
                    <div class="bus-card" onclick="startLiveTracking('${bus.tripId}', '${bus.busNumber}', '${fromVal}', '${toVal}', '${travelType}')">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <h3 style="margin: 0;">${bus.busNumber}</h3>
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                                <span style="display:inline-block; width:8px; height:8px; background-color:#39ff14; border-radius:50%; box-shadow: 0 0 5px #39ff14;"></span>
                                <span style="color:#39ff14; font-size: 0.75rem; font-weight:bold; letter-spacing: 0.5px;">Live: Scheduled</span>
                            </div>
                        </div>
                        <p class="route" style="margin-top: 5px;">${bus.route}</p>
                        <p style="font-size: 0.85rem; color: #ccc; margin-top: -5px; margin-bottom: 10px;">Towards: ${bus.direction || 'Destination'}</p>
                        <div class="card-metrics">
                            <span class="arrival">${displayTime}</span>
                            <span class="fare">Fare: ₹${Math.round(fareCost)}</span>
                        </div>
                    </div>
                `;
            });

            document.querySelectorAll(".bus-card").forEach(card => {
                card.addEventListener("mouseenter", () => {
                    if(hoverSound) {
                        hoverSound.currentTime = 0; 
                        hoverSound.play().catch(err => {});
                    }
                });
            });
        }

        // Slide the UI
        searchView.classList.remove("active");
        searchView.classList.add("slide-left");
        resultsView.classList.remove("slide-right");
        resultsView.classList.add("active");

        setTimeout(() => { map.invalidateSize(); }, 800); 

    } catch (error) {
        console.error("Backend Connection Error:", error);
        loader.classList.add("hidden");
        results.innerHTML = `<p style="text-align: center; color: #ef4444;">Mainframe connection lost. Is the server running?</p>`;
    }
}

// ================= LIVE GEOCODING & ROUTING =================
async function getCoordinates(place){
    let res = await fetch(`${API_BASE_URL}/api/coordinates?location=${encodeURIComponent(place)}`);
    if(!res.ok) throw new Error("Location not found");
    let data = await res.json();
    if(data.lat === undefined || data.lon === undefined) throw new Error("Invalid coordinates response");
    return [data.lat, data.lon];
}

async function startLiveTracking(tripId, busNumber, from, to, travelType = 'Live') {
    let loader = document.getElementById("loader");
    loader.innerText = `Establishing link to Bus ${busNumber}...`;
    loader.classList.remove("hidden");

    try {
        // Clear old map layers
        if (currentRouteLine) map.removeLayer(currentRouteLine);
        stopMarkers.forEach(s => map.removeLayer(s));
        buses.forEach(b => map.removeLayer(b));
        if (activeBusInterval) clearInterval(activeBusInterval);
        
        stopMarkers = [];
        buses = [];
        activeBusInterval = null;

        let route = [];
        
        // ── 1. REAL GTFS TRIP SIMULATION ──
        if (tripId && tripId !== 'undefined' && tripId !== 'null') {
            let res = await fetch(`${API_BASE_URL}/api/trip-simulation?tripId=${tripId}`);
            if (res.ok) {
                let tripData = await res.json();
                if (tripData.polyline && tripData.polyline.length > 0) {
                    route = tripData.polyline;
                    // Glowing neon polyline with draw animation
                    currentRouteLine = L.polyline(route, {
                        color: '#00ffff',
                        weight: 4,
                        opacity: 0.95,
                        className: 'neon-route-line'
                    }).addTo(map);
                    // Cinematic camera — drone-swoop into bounds
                    map.flyToBounds(currentRouteLine.getBounds(), {
                        paddingTopLeft: [60, 60],
                        paddingBottomRight: [60, 60],
                        duration: 1.5,
                        easeLinearity: 0.1
                    });

                    // Glowing stop dots
                    tripData.stops.forEach(coord => {
                        let stop = L.circleMarker(coord, {
                            radius: 5,
                            color: '#00ffff',
                            fillColor: '#000814',
                            fillOpacity: 1,
                            weight: 2,
                            className: 'neon-stop-dot'
                        }).addTo(map);
                        stopMarkers.push(stop);
                    });

                    if (travelType === 'Live' && tripData.schedule && tripData.schedule.length > 0) {
                        spawnSimulatedBus(tripData.schedule, busNumber);
                    }
                    loader.classList.add("hidden");
                    return; // exit early
                }
            }
        }

        // ── 2. FALLBACK LEGACY ROUTING ──
        let start = await getCoordinates(from);
        let end = await getCoordinates(to);

        let url = `${API_BASE_URL}/api/route?startLat=${encodeURIComponent(start[0])}&startLon=${encodeURIComponent(start[1])}&endLat=${encodeURIComponent(end[0])}&endLon=${encodeURIComponent(end[1])}`;

        let rRes = await fetch(url);
        if(!rRes.ok) {
            const errData = await rRes.json().catch(() => ({}));
            throw new Error(errData.error || `Routing request failed (${rRes.status})`);
        }
        let data = await rRes.json();

        if(!data.coordinates) {
            alert("Routing Error: Could not calculate path.");
            loader.classList.add("hidden");
            return;
        }

        route = data.coordinates.map(c => [c[1], c[0]]);

        currentRouteLine = L.polyline(route, {
            color: '#00ffff',
            weight: 4,
            opacity: 0.95,
            className: 'neon-route-line'
        }).addTo(map);
        // Cinematic flyToBounds — smooth drone swoop
        map.flyToBounds(currentRouteLine.getBounds(), {
            paddingTopLeft: [60, 60],
            paddingBottomRight: [60, 60],
            duration: 1.5,
            easeLinearity: 0.1
        });

        createStops(route);
        if (travelType === 'Live') {
            spawnLiveBus(route, busNumber);
        }
        loader.classList.add("hidden");

    } catch(err) {
        console.error("Live Tracking Error:", err);
        loader.classList.add("hidden");
        alert(`System Error: ${err.message || "Failed to lock onto vehicle coordinates."}`);
    }
}

function createStops(route) {
    stopMarkers = [];
    for (let i = 0; i < route.length; i += 25) {
        let stop = L.circleMarker(route[i], {
            radius: 5,
            color: '#00ffff',
            fillColor: '#000814',
            fillOpacity: 1,
            weight: 2,
            className: 'neon-stop-dot'
        }).addTo(map);
        stopMarkers.push(stop);
    }
}

function getBusIcon(busNumber) {
    return L.divIcon({
        className: 'custom-bus-icon',
        html: `
        <div class="bus-marker-pill">
            <div class="bus-marker-ripple"></div>
            <div class="bus-marker-ripple bus-marker-ripple--delay"></div>
            <div class="bus-marker-inner">
                <span class="bus-marker-dot"></span>
                <span class="bus-marker-label">🚌 ${busNumber}</span>
            </div>
        </div>`,
        iconSize: [90, 36],
        iconAnchor: [45, 18]
    });
}

function spawnLiveBus(route, busNumber){
    let marker = L.marker(route[0], {icon: getBusIcon(busNumber)}).addTo(map);
    buses.push(marker);
    animateBus(marker, route);
}

// ── GTFS SIMULATION ALGORITHM ──
function spawnSimulatedBus(schedule, busNumber) {
    // Initial marker at origin
    let marker = L.marker([schedule[0].lat, schedule[0].lon], {icon: getBusIcon(busNumber)}).addTo(map);
    buses.push(marker);

    // Get current system time (seconds from midnight)
    const now = new Date();
    const systemTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    
    const tripStart = schedule[0].time;
    const tripEnd = schedule[schedule.length - 1].time;

    // Fast-pacing real-time interpolation
    // If the real current time isn't during the trip, we fake it by re-running the trip at 10x speed.
    let isRealTime = (systemTime >= tripStart && systemTime <= tripEnd);
    let simTime = isRealTime ? systemTime : tripStart;

    if (activeBusInterval) clearInterval(activeBusInterval);

    activeBusInterval = setInterval(() => {
        // Advance time: true realtime goes +1s, fake simulation runs faster +5s to be fluid
        simTime += isRealTime ? 1 : 5;

        // Loop simulation if we reach the end
        if (simTime > tripEnd) {
            simTime = tripStart; 
            isRealTime = false; // Once finished, revert to fast replay loop
        }

        // 1. Identify the two stops the bus is currently between over time
        let pointA = null;
        let pointB = null;

        for (let i = 0; i < schedule.length - 1; i++) {
            if (simTime >= schedule[i].time && simTime <= schedule[i+1].time) {
                pointA = schedule[i];
                pointB = schedule[i+1];
                break;
            }
        }

        // 2. Interpolate the exact GPS coordinate
        if (pointA && pointB) {
            let timeSpan = pointB.time - pointA.time;
            let timeElapsed = simTime - pointA.time;
            // clamp calculation
            let progress = timeSpan > 0 ? (timeElapsed / timeSpan) : 1;
            
            let currentLat = pointA.lat + (pointB.lat - pointA.lat) * progress;
            let currentLon = pointA.lon + (pointB.lon - pointA.lon) * progress;
            
            // 3. Smooth Leaflet.js animation
            marker.setLatLng([currentLat, currentLon]);
        }
    }, 50); // 50ms interval = butter smooth UI
}

function animateBus(marker, route){
    let index = 0;
    if(activeBusInterval) clearInterval(activeBusInterval);

    activeBusInterval = setInterval(() => {
        index++;
        if(index >= route.length) {
            clearInterval(activeBusInterval);
            return;
        }
        marker.setLatLng(route[index]);
    }, 800); 
}

function clearLiveTracking() {
    if (currentRouteLine) {
        map.removeLayer(currentRouteLine);
        currentRouteLine = null;
    }
    stopMarkers.forEach(s => map.removeLayer(s));
    buses.forEach(b => map.removeLayer(b));
    stopMarkers = [];
    buses = [];
    if (activeBusInterval) {
        clearInterval(activeBusInterval);
        activeBusInterval = null;
    }
}

if (clearMapBtn) {
    clearMapBtn.addEventListener("click", () => {
        clearLiveTracking();
    });
}

if (newSearchBtn) {
    newSearchBtn.addEventListener("click", () => {
        clearLiveTracking();
        resultsView.classList.remove("active");
        resultsView.classList.add("slide-right");
        searchView.classList.remove("slide-left");
        searchView.classList.add("active");
    });
}

function appendAiMessage(text, sender) {
    if (!aiChatMessages) return;
    const msg = document.createElement("div");
    msg.className = `ai-msg ${sender}`;
    msg.textContent = text;
    aiChatMessages.appendChild(msg);
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
}

function showResultsView() {
    if (!searchView || !resultsView) return;
    searchView.classList.remove("active");
    searchView.classList.add("slide-left");
    resultsView.classList.remove("slide-right");
    resultsView.classList.add("active");
    setTimeout(() => { map.invalidateSize(); }, 350);
}

if (aiAssistantBtn && aiChatWindow) {
    aiAssistantBtn.addEventListener("click", () => {
        aiChatWindow.classList.toggle("hidden");
    });
}

if (aiChatCloseBtn && aiChatWindow) {
    aiChatCloseBtn.addEventListener("click", () => {
        aiChatWindow.classList.add("hidden");
    });
}

let activeBotRoute = null;

// ── Inject chat-returned bus array into the sidebar, exactly like searchBus() does ──
function injectChatResultsIntoSidebar(data) {
    const results     = document.getElementById('results');
    const loader      = document.getElementById('loader');
    const hoverSound  = document.getElementById('hover-sound');
    if (!results) return;

    if (loader) loader.classList.add('hidden');
    results.innerHTML = '';

    const buses    = data.routes || [];
    const fromVal  = data.from   || '';
    const toVal    = data.to     || '';
    const distKm   = data.distanceKm || 8;

    // Build the same comparison table as searchBus()
    const busTime    = Math.max(1, Math.round(distKm / 0.35 + 15));
    const metroTime  = Math.max(1, Math.round(distKm / 0.5));
    const rapidoTime = Math.max(1, Math.round(distKm / 0.4 - 5));
    const uberTime   = Math.max(1, Math.round(distKm / 0.35 + 5));
    const busCost    = Math.round(15 + distKm * 2);
    const metroCost  = Math.round(Math.min(60, 10 + distKm * 2));
    const rapidoCost = Math.round(25 + distKm * 8);
    const uberCost   = Math.round(60 + distKm * 18);

    results.innerHTML = `
        <div class="comparison-table">
            <div class="comp-row comp-head"><span>Mode</span><span>Est. Cost</span><span>Est. Time</span></div>
            <div class="comp-row"><span>🚌 Bus</span><span class="cost-green">₹${busCost}</span><span>~${busTime} mins</span></div>
            <div class="comp-row"><span>🚇 Metro</span><span class="cost-green">₹${metroCost}</span><span>~${metroTime} mins</span></div>
            <div class="comp-row"><span>🛵 Rapido</span><span>₹${rapidoCost}</span><span>~${rapidoTime} mins</span></div>
            <div class="comp-row"><span>🚗 Uber</span><span class="cost-red">₹${uberCost}</span><span>~${uberTime} mins</span></div>
        </div>`;

    if (buses.length === 0) {
        results.innerHTML += `<div class="bus-card" style="text-align:center;cursor:default;opacity:0.8;">
            <h3 style="margin:0;color:#fca5a5;">&#x1F6AB; No Direct Buses Found</h3>
            <p style="margin-top:8px;color:#ccc;">Try the main search panel for nearby stops.</p></div>`;
        return;
    }

    buses.forEach(bus => {
        const displayTime = formatGTFSTime(bus.arrival) || bus.arrival || 'Live Active';
        const fare        = bus.calculatedFare || bus.fare || busCost;
        results.innerHTML += `
            <div class="bus-card" onclick="startLiveTracking('${bus.tripId || ''}','${bus.busNumber}','${fromVal}','${toVal}','Live')">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <h3 style="margin:0;">${bus.busNumber}</h3>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                        <span style="display:inline-block;width:8px;height:8px;background:#39ff14;border-radius:50%;box-shadow:0 0 5px #39ff14;"></span>
                        <span style="color:#39ff14;font-size:0.75rem;font-weight:bold;letter-spacing:0.5px;">Live: Scheduled</span>
                    </div>
                </div>
                <p class="route" style="margin-top:5px;">${bus.route || `${fromVal} → ${toVal}`}</p>
                <p style="font-size:0.85rem;color:#ccc;margin-top:-5px;margin-bottom:10px;">Towards: ${bus.direction || toVal}</p>
                <div class="card-metrics">
                    <span class="arrival">${displayTime}</span>
                    <span class="fare">Fare: ₹${Math.round(fare)}</span>
                </div>
            </div>`;
    });

    // Hover sound on chat-injected cards
    document.querySelectorAll('.bus-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            if (hoverSound) { hoverSound.currentTime = 0; hoverSound.play().catch(() => {}); }
        });
    });
}

// ================= 3D TILT EFFECT =================
function initTilt() {
    const tiltElements = document.querySelectorAll('.search-panel, .welcome-card, .bus-card');
    tiltElements.forEach(el => {
        el.addEventListener('mousemove', (e) => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const xPct = x / rect.width;
            const yPct = y / rect.height;
            const rotateX = (yPct - 0.5) * -15; // Max 15deg rotation
            const rotateY = (xPct - 0.5) * 15;
            
            el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
        });
        
        el.addEventListener('mouseleave', () => {
            el.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        });
    });
}

// Wait for DOM to add tilt listeners 
document.addEventListener('DOMContentLoaded', () => {
    initTilt();
    // Use mutation observer to apply tilt to dynamically added bus-cards
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length) {
                initTilt();
            }
        });
    });
    const resultsContainer = document.getElementById('results');
    if (resultsContainer) {
        observer.observe(resultsContainer, { childList: true, subtree: true });
    }
});

// ── Draw a road-snapped glowing polyline + cinematic flyToBounds ──
// Uses OSRM for the actual driving path; falls back to straight line if it fails.
async function cinematicMapFromCoords(originCoords, destCoords) {
    if (!originCoords || !destCoords) return;

    // Clear old layers
    if (currentRouteLine) { map.removeLayer(currentRouteLine); currentRouteLine = null; }
    stopMarkers.forEach(s => map.removeLayer(s)); stopMarkers = [];
    buses.forEach(b => map.removeLayer(b)); buses = [];
    if (activeBusInterval) { clearInterval(activeBusInterval); activeBusInterval = null; }

    const oLatLng = [originCoords.lat, originCoords.lon];
    const dLatLng = [destCoords.lat,   destCoords.lon];

    // ── 1. Fetch road-snapped path from OSRM ──
    let routePoints = [oLatLng, dLatLng]; // straight-line fallback
    try {
        const osrmRes = await fetch(
            `${API_BASE_URL}/api/osrm-route?startLat=${originCoords.lat}&startLon=${originCoords.lon}&endLat=${destCoords.lat}&endLon=${destCoords.lon}`
        );
        if (osrmRes.ok) {
            const osrmData = await osrmRes.json();
            if (osrmData.latlngs && osrmData.latlngs.length > 1) {
                routePoints = osrmData.latlngs;
                console.log(`[OSRM] ✅ Road-snapped path: ${routePoints.length} points`);
            }
        }
    } catch (osrmErr) {
        console.warn('[OSRM] Falling back to straight line:', osrmErr.message);
    }

    // ── 2. Draw glowing neon cyan road-snapped polyline ──
    currentRouteLine = L.polyline(routePoints, {
        color:     '#00ffff',
        weight:    5,
        opacity:   0.95,
        className: 'neon-route-line'
    }).addTo(map);

    // ── 3. Origin stop marker (cyan) ──
    const oStop = L.circleMarker(oLatLng, {
        radius: 8, color: '#00ffff', fillColor: '#000814',
        fillOpacity: 1, weight: 2.5, className: 'neon-stop-dot'
    }).bindTooltip(originCoords.name || 'Origin', { permanent: false, direction: 'top' }).addTo(map);
    stopMarkers.push(oStop);

    // ── 4. Destination stop marker (magenta) ──
    const dStop = L.circleMarker(dLatLng, {
        radius: 8, color: '#ff00cc', fillColor: '#000814',
        fillOpacity: 1, weight: 2.5
    }).bindTooltip(destCoords.name || 'Destination', { permanent: false, direction: 'top' }).addTo(map);
    stopMarkers.push(dStop);

    // ── 5. Cinematic camera swoop over the road-snapped route ──
    map.flyToBounds(currentRouteLine.getBounds(), {
        paddingTopLeft:     [60, 60],
        paddingBottomRight: [60, 60],
        duration:           1.8,
        easeLinearity:      0.1
    });
}

if (aiChatForm) {
    aiChatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = (aiChatInput?.value || '').trim();
        if (!text) return;

        appendAiMessage(text, 'user');
        if (aiChatInput) aiChatInput.value = '';

        // "yes / track it / sure" — start live tracking the top result
        const isConfirm = /^(yes|yeah|start|track it|sure|ok|okay|go|let's go)$/i.test(text);
        if (isConfirm && activeBotRoute) {
            appendAiMessage('🚀 Starting live tracking now!', 'ai');
            startLiveTracking(
                activeBotRoute.tripId,
                activeBotRoute.suggestedBusNumber,
                activeBotRoute.from,
                activeBotRoute.to
            );
            activeBotRoute = null;
            return;
        }

        // Typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'ai-msg ai typing-indicator';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        if (aiChatMessages) { aiChatMessages.appendChild(typingEl); aiChatMessages.scrollTop = aiChatMessages.scrollHeight; }

        try {
            const response = await fetch(`${API_BASE_URL}/api/chat`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ message: text })
            });
            const data = await response.json().catch(() => ({}));
            if (typingEl.parentNode) typingEl.remove();

            if (!response.ok) throw new Error(data.error || `Chat request failed (${response.status})`);

            // ── Display AI reply (supports HTML tags like <strong>) ──
            if (aiChatMessages) {
                const msg = document.createElement('div');
                msg.className = 'ai-msg ai';
                msg.innerHTML = data.answer || 'I could not process that request.';
                aiChatMessages.appendChild(msg);
                aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
            }

            // ── UI TAKEOVER: routes found ──────────────────────────────────────
            if (data.shouldTrack && data.routes && data.routes.length > 0) {

                // 1. Fill the "From" / "To" inputs so manual search still works
                const fromEl = document.getElementById('from');
                const toEl   = document.getElementById('to');
                if (fromEl) fromEl.value = data.from || '';
                if (toEl)   toEl.value   = data.to   || '';

                // 2. Inject all bus cards into the sidebar
                injectChatResultsIntoSidebar(data);

                // 3. Slide to the results view (cinematic transition)
                showResultsView();

                // 4. After the map resizes, draw the neon polyline + fly camera
                setTimeout(() => {
                    if (data.originCoords && data.destCoords) {
                        cinematicMapFromCoords(data.originCoords, data.destCoords);
                    }
                    map.invalidateSize();
                }, 500);

                // 5. Store the top result so the user can confirm tracking
                activeBotRoute = {
                    tripId:             data.routes[0]?.tripId || null,
                    suggestedBusNumber: data.suggestedBusNumber,
                    from:               data.from,
                    to:                 data.to
                };

            } else {
                activeBotRoute = null;
            }

        } catch (error) {
            if (typingEl.parentNode) typingEl.remove();
            appendAiMessage(`⚠️ System Error: ${error.message}`, 'ai');
        }
    });
}


// ================= SECRET ADMIN HACK =================
const busIcon = document.querySelector('.icon-container');
const adminModal = document.getElementById('admin-modal');
let clickCount = 0;
let clickTimer;

if(busIcon) {
    busIcon.addEventListener("click", (e) => {
        e.stopPropagation(); 
        clickCount++;
        if (clickCount === 1) {
            clickTimer = setTimeout(() => { clickCount = 0; }, 1200); 
        }
        if (clickCount === 3) {
            clearTimeout(clickTimer);
            clickCount = 0;
            if(adminModal) adminModal.classList.add("show");
        }
    });
}

function closeAdmin() {
    if(adminModal) adminModal.classList.remove("show");
}

function loginAdmin() {
    const adminUserInput = document.getElementById("admin-user");
    const adminPassInput = document.getElementById("admin-pass");
    const username = (adminUserInput?.value || "").trim();
    const password = (adminPassInput?.value || "").trim();

    if (username === "admin" && password === "system") {
        localStorage.setItem("isAdminLoggedIn", "true");
        closeAdmin();
        window.location.href = "admin.html";
        return;
    }

    alert("Access denied. Invalid admin credentials.");
}