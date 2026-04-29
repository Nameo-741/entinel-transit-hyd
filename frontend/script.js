// ================= PARTICLES =================
// Disabled — Spline 3D scene handles the atmosphere. Running WebGL + tsParticles
// simultaneously causes unnecessary GPU overhead and visual layer conflicts.
// To re-enable: uncomment the block below.
/*
tsParticles.load("tsparticles",{
    particles:{
        number:{value:60},
        size:{value:3},
        move:{enable:true,speed:1},
        color:{value:"#ffffff"}
    }
});
*/

// ================= SENTINEL SHIELD — PROFESSIONAL GPS SOS SYSTEM =================
// Set this to your Ngrok URL or deployed domain for production.
// Leave empty ('') to auto-detect from window.location.origin or fall back to localhost.
const PUBLIC_BASE_URL = '';

let isSentinelMode = false;
let sentinelWatchId = null;          // Geolocation watchPosition ID
let sentinelGpsMarker = null;        // Leaflet marker showing user's live location
let sentinelGpsAccuracyCircle = null; // Accuracy radius circle
let sentinelLastCoords = null;       // { lat, lon, accuracy, timestamp }
let sentinelLocationHistory = [];    // Breadcrumb trail of coords
let sosSessionId = null;             // Unique SOS session for Socket.io room
let sosViewCount = 0;                // How many people opened the SOS link
let sosViewers = [];                 // Viewer metadata log
let hasSentWhatsapp = false;         // GPS warm-up gate: only fire WhatsApp once accuracy is good
let sentinelWarmupId = null;         // watchPosition ID used during GPS warm-up phase
let sentinelWarmupTimeout = null;    // Fallback timeout if GPS never reaches target accuracy

// ================= SOCKET.IO — REAL-TIME SOS READ RECEIPTS =================
// When opened from file://, io() defaults to connecting to file:// which fails.
// Explicitly point to the server so Socket.io works regardless of how the page was opened.
const _socketUrl = (window.location.protocol === 'file:') ? 'http://localhost:5000' : undefined;
const socket = (typeof io !== 'undefined') ? io(_socketUrl) : null;

if (socket) {
    socket.on('connect', () => {
        console.log('[Socket.io] Connected:', socket.id);
        // Re-join SOS room if shield is active (handles reconnects)
        if (sosSessionId && isSentinelMode) {
            socket.emit('join_sos', sosSessionId);
        }
    });

    // ── SOS READ RECEIPT: Someone opened the location link ──
    socket.on('sos_viewed', (viewerInfo) => {
        sosViewCount++;
        sosViewers.push(viewerInfo);
        console.log(`[SOS] 👁️ View #${sosViewCount} at ${viewerInfo.timeStr}`);

        // 1. Show the read-receipt toast
        showSosViewedToast(sosViewCount, viewerInfo);

        // 2. Play alert sound
        playSosAlertSound();

        // 3. Update the viewer activity log panel
        updateViewerLogPanel();

        // 4. Post into the chatbot so the AI conversation has context
        if (typeof appendAiMessage === 'function' && document.getElementById('ai-chat-messages')) {
            const msg = document.createElement('div');
            msg.className = 'ai-msg ai';
            msg.innerHTML = `👁️ <strong>SOS Read Receipt</strong> — Someone opened your emergency location link at <strong>${viewerInfo.timeStr}</strong>. That's <strong>${sosViewCount}</strong> total view${sosViewCount > 1 ? 's' : ''}.`;
            document.getElementById('ai-chat-messages').appendChild(msg);
            document.getElementById('ai-chat-messages').scrollTop = document.getElementById('ai-chat-messages').scrollHeight;
        }
    });
}

/**
 * Show a high-contrast read-receipt notification toast.
 */
function showSosViewedToast(count, viewer) {
    const toast = document.getElementById('sos-toast');
    if (!toast) return;

    toast.innerHTML = `
        <div class="sos-toast-icon">👁️</div>
        <div class="sos-toast-body">
            <div class="sos-toast-title">SHIELD UPDATE: Location Viewed</div>
            <div class="sos-toast-detail">Someone opened your emergency link • View #${count} • ${viewer.timeStr}</div>
        </div>
    `;
    toast.classList.remove('hidden');
    toast.classList.add('show-toast');

    // Auto-hide after 6 seconds
    setTimeout(() => {
        toast.classList.remove('show-toast');
        setTimeout(() => toast.classList.add('hidden'), 500);
    }, 6000);
}

/**
 * Play a short alert sound for read receipts.
 */
function playSosAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Two-tone alert: urgency ping
        [520, 780].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.3);
        });
    } catch (_) { /* Audio not available — silent fallback */ }
}

/**
 * Update the viewer activity log panel with all viewer events.
 */
function updateViewerLogPanel() {
    const panel = document.getElementById('sentinel-viewer-log');
    if (!panel) return;

    let viewerRows = sosViewers.map((v, i) => `
        <div class="viewer-log-entry">
            <span class="viewer-log-num">#${i + 1}</span>
            <span class="viewer-log-time">${v.timeStr}</span>
            <span class="viewer-log-badge">👁️ Viewed</span>
        </div>
    `).reverse().join('');

    panel.innerHTML = `
        <div class="viewer-log-header">
            <span class="sentinel-live-dot"></span>
            <span>SOS LINK ACTIVITY</span>
            <span class="viewer-log-count">${sosViewCount} view${sosViewCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="viewer-log-entries">
            ${viewerRows}
        </div>
    `;
    panel.classList.remove('hidden');
}

/**
 * Show a glassmorphism toast notification at the top of the viewport.
 * Supports HTML content. Auto-removes itself after the given duration.
 */
function showSentinelToast(message, durationMs = 4200) {
    const existing = document.querySelector('.sentinel-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'sentinel-toast';
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
}

/**
 * Update the Sentinel Emergency Info Panel with live GPS data.
 */
function updateSentinelInfoPanel(lat, lon, accuracy, timestamp) {
    const panel = document.getElementById('sentinel-info-panel');
    if (!panel) return;

    const time = new Date(timestamp).toLocaleTimeString('en-IN', { hour12: true });
    const date = new Date(timestamp).toLocaleDateString('en-IN');
    const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;

    panel.innerHTML = `
        <div class="sentinel-info-header">
            <span class="sentinel-live-dot"></span>
            <span>LIVE GPS TRACKING</span>
            <span class="sentinel-info-time">${time}</span>
        </div>
        <div class="sentinel-info-grid">
            <div class="sentinel-info-item">
                <span class="sentinel-info-label">LAT</span>
                <span class="sentinel-info-value">${lat.toFixed(6)}</span>
            </div>
            <div class="sentinel-info-item">
                <span class="sentinel-info-label">LON</span>
                <span class="sentinel-info-value">${lon.toFixed(6)}</span>
            </div>
            <div class="sentinel-info-item">
                <span class="sentinel-info-label">ACCURACY</span>
                <span class="sentinel-info-value">±${Math.round(accuracy)}m</span>
            </div>
            <div class="sentinel-info-item">
                <span class="sentinel-info-label">DATE</span>
                <span class="sentinel-info-value">${date}</span>
            </div>
        </div>
        <a class="sentinel-maps-link" href="${mapsLink}" target="_blank" rel="noopener">
            📍 Open in Google Maps
        </a>
    `;
    panel.classList.remove('hidden');
}

/**
 * Place (or move) the user's live GPS marker on the Leaflet map.
 */
function updateSentinelGpsMarker(lat, lon, accuracy) {
    if (!map) return;

    const latlng = [lat, lon];

    if (!sentinelGpsMarker) {
        // Create a pulsing user-location marker
        sentinelGpsMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'sentinel-gps-icon',
                html: `<div class="sentinel-gps-dot">
                           <div class="sentinel-gps-ping"></div>
                           <div class="sentinel-gps-ping sentinel-gps-ping--delay"></div>
                           <div class="sentinel-gps-core"></div>
                       </div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            }),
            zIndexOffset: 9999
        }).addTo(map);

        sentinelGpsAccuracyCircle = L.circle(latlng, {
            radius: accuracy,
            color: 'rgba(255, 50, 50, 0.4)',
            fillColor: 'rgba(255, 50, 50, 0.08)',
            fillOpacity: 0.4,
            weight: 1,
            dashArray: '4 6',
            className: 'sentinel-accuracy-circle'
        }).addTo(map);
    } else {
        sentinelGpsMarker.setLatLng(latlng);
        sentinelGpsAccuracyCircle.setLatLng(latlng);
        sentinelGpsAccuracyCircle.setRadius(accuracy);
    }
}

/**
 * Remove all Sentinel GPS layers from the map.
 */
function clearSentinelGpsLayers() {
    if (sentinelGpsMarker && map) {
        map.removeLayer(sentinelGpsMarker);
        sentinelGpsMarker = null;
    }
    if (sentinelGpsAccuracyCircle && map) {
        map.removeLayer(sentinelGpsAccuracyCircle);
        sentinelGpsAccuracyCircle = null;
    }
}

/**
 * Fire the WhatsApp SOS with real GPS coordinates.
 * Uses a "bouncer link" through our server so we can track when someone opens it.
 */
function fireSentinelSOS(lat, lon) {
    // Generate session ID if not already created
    if (!sosSessionId) {
        sosSessionId = 'sos_' + Math.random().toString(36).substr(2, 9);
        if (socket) socket.emit('join_sos', sosSessionId);
    }

    // Build the bouncer link that routes through our server
    // Priority: PUBLIC_BASE_URL (Ngrok/deployed) → API_BASE_URL (auto-detect) → localhost fallback
    const baseUrl = PUBLIC_BASE_URL || ((typeof API_BASE_URL !== 'undefined') ? API_BASE_URL : 'http://localhost:5000');
    const bouncerLink = `${baseUrl}/api/sos/view?id=${encodeURIComponent(sosSessionId)}&lat=${lat}&lon=${lon}`;

    const timestamp = new Date().toLocaleString('en-IN');
    const msg = `🚨 EMERGENCY: I am on a city bus. Follow my exact location on the Sentinel Transit Grid: ${bouncerLink}`;
    window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(msg), '_blank');
}

/**
 * MASTER TOGGLE — Sentinel Shield mode on/off.
 *
 * State Machine:
 *   OFF → click → LOCATING... (GPS acquiring) → GPS lock → SOS ARMED
 *   ARMED → click → OFF (cleanup)
 */
function toggleSentinelMode() {
    const btn = document.getElementById('sentinel-btn');

    if (!isSentinelMode) {
        // ══════════════════════════════════════
        //  PHASE 1: ACTIVATE — Begin GPS Warm-Up
        // ══════════════════════════════════════
        isSentinelMode = true;
        hasSentWhatsapp = false;
        document.body.classList.add('sentinel-mode');

        if (btn) {
            btn.innerHTML = '<span class="sentinel-locating-spinner"></span> LOCATING...';
            btn.classList.add('sentinel-active-btn', 'sentinel-locating');
        }

        // Re-colour any existing route line to emergency red
        if (currentRouteLine) {
            currentRouteLine.setStyle({ color: '#ff3333' });
            const el = currentRouteLine.getElement && currentRouteLine.getElement();
            if (el) {
                el.classList.remove('neon-route-line');
                el.classList.add('sentinel-route-line');
            }
        }

        showSentinelToast('🛡️ Acquiring satellite GPS fix — calibrating...', 8000);

        // ── Check geolocation support ──
        if (!navigator.geolocation) {
            alert('⚠️ Geolocation is not supported by your browser. Sentinel Shield requires GPS access.');
            deactivateSentinel();
            return;
        }

        // ══════════════════════════════════════════════════════════════
        //  GPS WARM-UP FILTER — watchPosition streams location ticks.
        //  We discard anything with accuracy > 30m (cell-tower guesses)
        //  and only arm + fire WhatsApp once we get a satellite lock.
        //  A 15-second fallback ensures we don't wait forever.
        // ══════════════════════════════════════════════════════════════
        const GPS_ACCURACY_THRESHOLD = 30; // metres — anything above is too sloppy
        const GPS_WARMUP_TIMEOUT_MS = 15000; // 15s fallback
        let bestAccuracy = Infinity;       // track the tightest reading seen

        // Join the SOS room early so read receipts work the instant we fire
        if (!sosSessionId) {
            sosSessionId = 'sos_' + Math.random().toString(36).substr(2, 9);
        }
        if (socket) socket.emit('join_sos', sosSessionId);

        /**
         * Called once accuracy is good enough (or the timeout fires).
         * Arms the SOS, fires WhatsApp, and transitions to continuous tracking.
         */
        const armSentinel = (lat, lon, accuracy, timestamp) => {
            if (hasSentWhatsapp) return; // already armed — ignore duplicate calls
            hasSentWhatsapp = true;

            // Clean up warm-up watcher (continuous tracking takes over)
            if (sentinelWarmupId !== null) {
                navigator.geolocation.clearWatch(sentinelWarmupId);
                sentinelWarmupId = null;
            }
            if (sentinelWarmupTimeout) {
                clearTimeout(sentinelWarmupTimeout);
                sentinelWarmupTimeout = null;
            }

            sentinelLastCoords = { lat, lon, accuracy, timestamp };

            // Arm the UI
            if (btn) {
                btn.classList.remove('sentinel-locating');
                btn.innerHTML = '🚨 SOS ARMED';
            }

            // Fire WhatsApp SOS with high-accuracy coordinates
            fireSentinelSOS(lat, lon);

            // Update map + info panel
            updateSentinelGpsMarker(lat, lon, accuracy);
            updateSentinelInfoPanel(lat, lon, accuracy, timestamp);

            // Emit to Socket.io so SOS viewers get the location
            if (socket && sosSessionId) {
                socket.emit('update_location', {
                    sessionId: sosSessionId,
                    lat, lon, accuracy,
                    timestamp: Date.now()
                });
            }

            // Start continuous tracking for ongoing position updates
            startContinuousSentinelTracking();

            showSentinelToast(`🛡️ SOS ARMED — Satellite Lock: ±${Math.round(accuracy)}m`);
            console.log(`[Sentinel GPS] ✅ Armed with accuracy ±${Math.round(accuracy)}m`);
        };

        // ── WARM-UP: watchPosition streams ticks, we filter by accuracy ──
        sentinelWarmupId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude: lat, longitude: lon, accuracy } = position.coords;
                const timestamp = position.timestamp;

                console.log(`[Sentinel GPS] Warm-up tick — accuracy: ±${Math.round(accuracy)}m`);

                // Always track the best reading in case we hit the timeout
                if (accuracy < bestAccuracy) {
                    bestAccuracy = accuracy;
                    sentinelLastCoords = { lat, lon, accuracy, timestamp };
                }

                // ── ACCURACY FILTER ──
                if (accuracy > GPS_ACCURACY_THRESHOLD) {
                    // Still calibrating — sloppy cell-tower / Wi-Fi guess
                    if (btn && !hasSentWhatsapp) {
                        btn.innerHTML = `🚨 CALIBRATING (${Math.round(accuracy)}m)...`;
                    }
                    // Show the marker so user sees progress on the map
                    updateSentinelGpsMarker(lat, lon, accuracy);
                    return; // ← discard this tick, wait for better accuracy
                }

                // ── ACCURACY IS GOOD — arm the SOS ──
                armSentinel(lat, lon, accuracy, timestamp);
            },
            (error) => {
                console.error('[Sentinel GPS] Warm-up error:', error.message);
                // If we have NO reading at all, abort entirely
                if (!sentinelLastCoords) {
                    alert(`⚠️ GPS Error: ${error.message}\nPlease ensure location permissions are enabled.`);
                    deactivateSentinel();
                }
                // Otherwise the timeout fallback will use the best reading we got
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );

        // ── FALLBACK TIMEOUT: if GPS never reaches threshold, use best reading ──
        sentinelWarmupTimeout = setTimeout(() => {
            if (hasSentWhatsapp) return; // Already armed — nothing to do

            if (sentinelLastCoords) {
                const { lat, lon, accuracy, timestamp } = sentinelLastCoords;
                console.warn(`[Sentinel GPS] ⏱️ Warm-up timeout — arming with best accuracy: ±${Math.round(accuracy)}m`);
                showSentinelToast(`🛡️ Timeout — using best fix: ±${Math.round(accuracy)}m`, 5000);
                armSentinel(lat, lon, accuracy, timestamp);
            } else {
                console.error('[Sentinel GPS] ⏱️ Warm-up timeout — no GPS readings received.');
                alert('⚠️ Could not acquire GPS position. Please try again in an open area.');
                deactivateSentinel();
            }
        }, GPS_WARMUP_TIMEOUT_MS);

    } else {
        // ══════════════════════════════════════
        //  PHASE 2: DEACTIVATE — Full Cleanup
        // ══════════════════════════════════════

        // If already armed and user taps again, fire another SOS with latest coords
        if (sentinelLastCoords && !btn?.classList.contains('sentinel-locating')) {
            const { lat, lon } = sentinelLastCoords;
            const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
            const reSend = confirm(
                `🚨 Sentinel Shield is currently ARMED.\n\n` +
                `📍 Your last known location:\n${mapsLink}\n\n` +
                `Tap OK to send another SOS via WhatsApp.\nTap Cancel to deactivate the shield.`
            );
            if (reSend) {
                fireSentinelSOS(lat, lon);
                return; // Stay armed
            }
        }

        deactivateSentinel();
    }
}

/**
 * Full deactivation and cleanup of Sentinel Shield.
 */
function deactivateSentinel() {
    isSentinelMode = false;
    hasSentWhatsapp = false;
    const btn = document.getElementById('sentinel-btn');

    document.body.classList.remove('sentinel-mode');
    if (btn) {
        btn.innerHTML = '🛡️ Shield Off';
        btn.classList.remove('sentinel-active-btn', 'sentinel-locating');
    }

    // Stop GPS warm-up watcher (if still calibrating)
    if (sentinelWarmupId !== null) {
        navigator.geolocation.clearWatch(sentinelWarmupId);
        sentinelWarmupId = null;
    }
    if (sentinelWarmupTimeout) {
        clearTimeout(sentinelWarmupTimeout);
        sentinelWarmupTimeout = null;
    }

    // Stop continuous GPS watcher
    if (sentinelWatchId !== null) {
        navigator.geolocation.clearWatch(sentinelWatchId);
        sentinelWatchId = null;
    }

    // Clear GPS map layers
    clearSentinelGpsLayers();

    // Hide info panel
    const panel = document.getElementById('sentinel-info-panel');
    if (panel) panel.classList.add('hidden');

    // Reset coords
    sentinelLastCoords = null;
    sentinelLocationHistory = [];

    // Reset SOS session
    sosSessionId = null;
    sosViewCount = 0;
    sosViewers = [];
    const viewerLog = document.getElementById('sentinel-viewer-log');
    if (viewerLog) viewerLog.classList.add('hidden');
    const sosToast = document.getElementById('sos-toast');
    if (sosToast) { sosToast.classList.add('hidden'); sosToast.classList.remove('show-toast'); }

    // Revert any existing route line to default cyan
    if (currentRouteLine) {
        currentRouteLine.setStyle({ color: '#00ffff' });
        const el = currentRouteLine.getElement && currentRouteLine.getElement();
        if (el) {
            el.classList.remove('sentinel-route-line');
            el.classList.add('neon-route-line');
        }
    }

    showSentinelToast('🛡️ Sentinel Shield deactivated.');
}

/**
 * Continuous GPS tracking — runs AFTER the warm-up phase arms the SOS.
 * Streams location updates to the map, info panel, and Socket.io viewers.
 */
function startContinuousSentinelTracking() {
    if (sentinelWatchId !== null) return; // Already tracking

    sentinelWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude: lat, longitude: lon, accuracy } = position.coords;
            const timestamp = position.timestamp;

            sentinelLastCoords = { lat, lon, accuracy, timestamp };
            sentinelLocationHistory.push({ lat, lon, accuracy, timestamp });

            // Update map marker + info panel
            updateSentinelGpsMarker(lat, lon, accuracy);
            updateSentinelInfoPanel(lat, lon, accuracy, timestamp);

            // Broadcast to SOS viewers via Socket.io
            if (socket && sosSessionId) {
                socket.emit('update_location', {
                    sessionId: sosSessionId,
                    lat, lon, accuracy,
                    timestamp: Date.now()
                });
            }
        },
        (error) => {
            console.warn('[Sentinel GPS] Continuous tracking error:', error.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
}

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
    // If opened directly as a local file fallback
    if (window.location.protocol === "file:") {
        return "http://localhost:5000";
    }
    // If we are on localhost, attach the :5000 port for the local Node server
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return `${window.location.protocol}//${window.location.hostname}:5000`;
    }
    // In production (Render), just use the standard origin without custom ports
    return window.location.origin; 
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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    if (!input || input.dataset.autocompleteBound) return;
    input.dataset.autocompleteBound = "true";

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

window.initAutocomplete = function () {
    setupAutocomplete('from');
    setupAutocomplete('to');
};
window.initAutocomplete();



// ================= SWAP (With Animation) =================
function swapStops() {
    const fromInput = document.getElementById("from");
    const toInput = document.getElementById("to");
    const swapBtn = document.querySelector(".swap-btn");

    if (!fromInput || !toInput) return;

    fromInput.classList.add("swap-down");
    toInput.classList.add("swap-up");
    if (swapBtn) swapBtn.classList.add("spin");

    setTimeout(() => {
        let temp = fromInput.value;
        fromInput.value = toInput.value;
        toInput.value = temp;

        fromInput.style.transition = "none";
        toInput.style.transition = "none";
        if (swapBtn) swapBtn.style.transition = "none";

        fromInput.classList.remove("swap-down");
        toInput.classList.remove("swap-up");
        if (swapBtn) swapBtn.classList.remove("spin");

        void fromInput.offsetHeight;

        fromInput.style.transition = "";
        toInput.style.transition = "";
        if (swapBtn) swapBtn.style.transition = "";

    }, 300);
}

// ================= MAP INITIALIZATION — Framer Tier =================
let map = null;
let darkTiles = null;
let lightTiles = null;
let isDarkMap = true;
let currentRouteLine = null;
let buses = [];
let stopMarkers = [];
let activeBusInterval = null;

window.initMap = function () {
    if (map) return; // Already initialized
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([17.3850, 78.4867], 12);

    // Add zoom control top-right so it doesn't clash with sidebar
    L.control.zoom({ position: 'topright' }).addTo(map);

    // CartoDB Dark Matter No-Labels — pitch-black canvas, our neon pops
    darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    });
    // Outdoor fallback (labels visible in light mode)
    lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    });

    darkTiles.addTo(map);
    isDarkMap = true;
};

// Try to init immediately, but React will call it again if needed
window.initMap();

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

        if (startCoords && endCoords) {
            try {
                let url = `${API_BASE_URL}/api/osrm-route?startLat=${encodeURIComponent(startCoords[0])}&startLon=${encodeURIComponent(startCoords[1])}&endLat=${encodeURIComponent(endCoords[0])}&endLon=${encodeURIComponent(endCoords[1])}`;
                let routeRes = await fetch(url);
                if (routeRes && routeRes.ok) {
                    let routeData = await routeRes.json();
                    if (routeData.distance) {
                        distanceKm = (routeData.distance || 0) / 1000;
                        durationMins = (routeData.duration || 0) / 60;
                    }
                }
            } catch (_) { }
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
                    if (hoverSound) {
                        hoverSound.currentTime = 0;
                        hoverSound.play().catch(err => { });
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
async function getCoordinates(place) {
    let res = await fetch(`${API_BASE_URL}/api/coordinates?location=${encodeURIComponent(place)}`);
    if (!res.ok) throw new Error("Location not found");
    let data = await res.json();
    if (data.lat === undefined || data.lon === undefined) throw new Error("Invalid coordinates response");
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
                    let routeColor = isSentinelMode ? '#ff3333' : '#00ffff';
                    let routeClass = isSentinelMode ? 'sentinel-route-line' : 'neon-route-line';
                    currentRouteLine = L.polyline(route, {
                        color: routeColor,
                        weight: 4,
                        opacity: 0.95,
                        className: routeClass
                    }).addTo(map);
                    if (isSentinelMode) {
                        showSentinelToast('🛡️ Sentinel Active: Routing via Primary Arterial Roads.');
                    }
                    // Cinematic 'Drone' Fly-Over — buttery smooth camera swoop
                    map.flyToBounds(currentRouteLine.getBounds(), {
                        padding: [50, 50],
                        duration: 2.5,
                        easeLinearity: 0.25
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

                    if (travelType === 'Live') {
                        // Use the high-resolution snapped polyline for the bus animation
                        // so it follows the physical road instead of flying over buildings.
                        spawnLiveBus(route, busNumber);
                    }
                    loader.classList.add("hidden");
                    return; // exit early
                }
            }
        }

        // ── 2. FALLBACK LEGACY ROUTING ──
        let start = await getCoordinates(from);
        let end = await getCoordinates(to);

        let url = `${API_BASE_URL}/api/osrm-route?startLat=${encodeURIComponent(start[0])}&startLon=${encodeURIComponent(start[1])}&endLat=${encodeURIComponent(end[0])}&endLon=${encodeURIComponent(end[1])}`;

        let rRes = await fetch(url);
        if (!rRes.ok) {
            const errData = await rRes.json().catch(() => ({}));
            throw new Error(errData.error || `Routing request failed (${rRes.status})`);
        }
        let data = await rRes.json();

        if (!data.latlngs) {
            alert("Routing Error: Could not calculate path.");
            loader.classList.add("hidden");
            return;
        }

        route = data.latlngs;

        let fallbackRouteColor = isSentinelMode ? '#ff3333' : '#00ffff';
        let fallbackRouteClass = isSentinelMode ? 'sentinel-route-line' : 'neon-route-line';
        currentRouteLine = L.polyline(route, {
            color: fallbackRouteColor,
            weight: 4,
            opacity: 0.95,
            className: fallbackRouteClass
        }).addTo(map);
        if (isSentinelMode) {
            showSentinelToast('🛡️ Sentinel Active: Routing via Primary Arterial Roads.');
        }
        // Cinematic 'Drone' Fly-Over — buttery smooth camera swoop
        map.flyToBounds(currentRouteLine.getBounds(), {
            padding: [50, 50],
            duration: 2.5,
            easeLinearity: 0.25
        });

        createStops(route);
        if (travelType === 'Live') {
            spawnLiveBus(route, busNumber);
        }
        loader.classList.add("hidden");

    } catch (err) {
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

function spawnLiveBus(route, busNumber) {
    let marker = L.marker(route[0], { icon: getBusIcon(busNumber) }).addTo(map);
    buses.push(marker);
    animateBus(marker, route);
}

// ── GTFS SIMULATION ALGORITHM ──
// Safely retained to prevent breaking old code references, but now
// we prefer using the road-snapping `animateBus` function so the 
// bus actually follows the road geometry.
function spawnSimulatedBus(schedule, busNumber) {
    if (!schedule || schedule.length === 0) return;
    let marker = L.marker([schedule[0].lat, schedule[0].lon], { icon: getBusIcon(busNumber) }).addTo(map);
    buses.push(marker);

    const now = new Date();
    const systemTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    const tripStart = schedule[0].time;
    const tripEnd = schedule[schedule.length - 1].time;

    let isRealTime = (systemTime >= tripStart && systemTime <= tripEnd);
    let simTime = isRealTime ? systemTime : tripStart;

    if (activeBusInterval) clearInterval(activeBusInterval);

    activeBusInterval = setInterval(() => {
        simTime += isRealTime ? 1 : 5;

        if (simTime > tripEnd) {
            simTime = tripStart;
            isRealTime = false;
        }

        let pointA = null;
        let pointB = null;

        for (let i = 0; i < schedule.length - 1; i++) {
            if (simTime >= schedule[i].time && simTime <= schedule[i + 1].time) {
                pointA = schedule[i];
                pointB = schedule[i + 1];
                break;
            }
        }

        if (pointA && pointB) {
            let timeSpan = pointB.time - pointA.time;
            let timeElapsed = simTime - pointA.time;
            let progress = timeSpan > 0 ? (timeElapsed / timeSpan) : 1;

            let currentLat = pointA.lat + (pointB.lat - pointA.lat) * progress;
            let currentLon = pointA.lon + (pointB.lon - pointA.lon) * progress;

            marker.setLatLng([currentLat, currentLon]);
        }
    }, 50);
}

function animateBus(marker, route) {
    let index = 0;
    if (activeBusInterval) clearInterval(activeBusInterval);

    activeBusInterval = setInterval(() => {
        index++;
        if (index >= route.length) {
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
    const results = document.getElementById('results');
    const loader = document.getElementById('loader');
    const hoverSound = document.getElementById('hover-sound');
    if (!results) return;

    if (loader) loader.classList.add('hidden');
    results.innerHTML = '';

    const buses = data.routes || [];
    const fromVal = data.from || '';
    const toVal = data.to || '';
    const distKm = data.distanceKm || 8;

    // Build the same comparison table as searchBus()
    const busTime = Math.max(1, Math.round(distKm / 0.35 + 15));
    const metroTime = Math.max(1, Math.round(distKm / 0.5));
    const rapidoTime = Math.max(1, Math.round(distKm / 0.4 - 5));
    const uberTime = Math.max(1, Math.round(distKm / 0.35 + 5));
    const busCost = Math.round(15 + distKm * 2);
    const metroCost = Math.round(Math.min(60, 10 + distKm * 2));
    const rapidoCost = Math.round(25 + distKm * 8);
    const uberCost = Math.round(60 + distKm * 18);

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
        const fare = bus.calculatedFare || bus.fare || busCost;
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
            if (hoverSound) { hoverSound.currentTime = 0; hoverSound.play().catch(() => { }); }
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

    // ── Check for SOS Redirect ──
    handleSosRedirect();
});

/**
 * Start continuous hardware tracking after the initial getCurrentPosition fix.
 * Each position update is:
 *   1. Rendered on the sender's own map (marker + info panel)
 *   2. Broadcast via Socket.io to every viewer in the SOS room
 */
function startContinuousSentinelTracking() {
    if (sentinelWatchId) navigator.geolocation.clearWatch(sentinelWatchId);

    sentinelWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude: lat, longitude: lon, accuracy } = position.coords;
            sentinelLastCoords = { lat, lon, accuracy, timestamp: position.timestamp };

            // Update sender's own map
            updateSentinelGpsMarker(lat, lon, accuracy);
            updateSentinelInfoPanel(lat, lon, accuracy, position.timestamp);

            // ── Broadcast live location to all viewers in the SOS room ──
            if (socket && sosSessionId) {
                socket.emit('update_location', {
                    sessionId: sosSessionId,
                    lat,
                    lon,
                    accuracy,
                    timestamp: position.timestamp
                });
            }
        },
        (err) => {
            console.warn('[Sentinel GPS Watch] Error:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 0 }
    );
}

/**
 * Check if the page was loaded from an SOS redirect link.
 * If so, pan to coordinates, drop an animated emergency marker,
 * then join the Socket.io room and listen for real-time location updates.
 */
function handleSosRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sos') !== 'true') return;

    const lat = parseFloat(urlParams.get('lat'));
    const lon = parseFloat(urlParams.get('lon'));
    const sosId = urlParams.get('id'); // session ID for socket room

    if (isNaN(lat) || isNaN(lon)) return;

    // ══════════════════════════════════════════════════════════
    //  SOS VIEWER MODE — Strip the entire UI down to a
    //  fullscreen emergency map. No sidebars, no search,
    //  no AI button. Just the live tracking map.
    // ══════════════════════════════════════════════════════════
    document.body.classList.add('sos-viewer-mode');
    document.title = '🚨 LIVE — Emergency Location Tracking';

    // ── Ensure map is initialised and visible ──
    if (!map) window.initMap();

    // Jump to results-view so the map is visible
    const landing = document.getElementById('landing');
    const searchView = document.getElementById('search-view');
    const resultsView = document.getElementById('results-view');
    if (landing) { landing.classList.remove('active'); landing.classList.add('slide-top'); }
    if (searchView) { searchView.classList.remove('active'); searchView.classList.add('slide-bottom'); }
    if (resultsView) { resultsView.classList.remove('slide-right'); resultsView.classList.add('active'); }

    // ── Inject the emergency HUD overlay bar ──
    const sosHud = document.createElement('div');
    sosHud.id = 'sos-viewer-hud';
    sosHud.innerHTML = `
        <div class="sos-hud-left">
            <span class="sos-hud-dot"></span>
            <span class="sos-hud-label">LIVE TRACKING</span>
        </div>
        <div class="sos-hud-center">
            <span class="sos-hud-coords" id="sos-hud-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>
        </div>
        <a class="sos-hud-gmaps" href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener" id="sos-hud-gmaps-link">
            📍 Open in Google Maps
        </a>
    `;
    document.body.appendChild(sosHud);

    // Small delay to let the map container render before flying
    setTimeout(() => {
        if (map) map.invalidateSize();
        map.flyTo([lat, lon], 16, { duration: 2.5 });
    }, 300);

    // ── Drop animated emergency marker ──
    const emergencyIcon = L.divIcon({
        className: 'emergency-marker-container',
        html: `
            <div class="emergency-ping"></div>
            <div class="emergency-center">🚨</div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    window.sosMarker = L.marker([lat, lon], { icon: emergencyIcon, zIndexOffset: 9999 })
        .addTo(map)
        .bindPopup(`
            <div style="font-family: 'Sora', sans-serif;">
                <h4 style="margin:0 0 5px; color:#ff3333;">🚨 LIVE EMERGENCY LOCATION</h4>
                <p style="margin:0; font-size:0.85rem;">This position updates in real-time as they move.</p>
            </div>
        `)
        .openPopup();

    // ── Accuracy circle around the marker ──
    window.sosAccuracyCircle = L.circle([lat, lon], {
        radius: 50,
        color: 'rgba(255, 50, 50, 0.4)',
        fillColor: 'rgba(255, 50, 50, 0.08)',
        fillOpacity: 0.4,
        weight: 1,
        dashArray: '4 6',
        className: 'sentinel-accuracy-circle'
    }).addTo(map);

    // ── Breadcrumb trail polyline ──
    window.sosBreadcrumb = L.polyline([[lat, lon]], {
        color: '#ff3333',
        weight: 3,
        opacity: 0.6,
        dashArray: '6 8',
        className: 'sentinel-route-line'
    }).addTo(map);

    // ── Wire up the Get Directions button ──
    // Track the latest known position (updates on every socket event)
    window._sosLiveLat = lat;
    window._sosLiveLon = lon;

    const dirBtn = document.getElementById('sos-dir-btn');
    if (dirBtn) {
        dirBtn.classList.remove('hidden');
        dirBtn.addEventListener('click', () => {
            // Use Google Maps Directions intent URL — opens native navigation on mobile
            const destLat = window._sosLiveLat;
            const destLon = window._sosLiveLon;
            window.open(
                `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&travelmode=driving`,
                '_blank'
            );
        });
    }

    // ── Join the Socket.io room to receive live location updates ──
    if (sosId && socket) {
        socket.emit('join_sos', sosId);
        console.log(`[SOS Viewer] Joined room "${sosId}" — listening for live updates...`);

        socket.on('location_updated', (data) => {
            const newLatLng = [data.lat, data.lon];
            console.log(`[SOS Viewer] 📍 Live update: ${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}`);

            // Smoothly animate the marker to the new position
            if (window.sosMarker) {
                window.sosMarker.setLatLng(newLatLng);
            }

            // Update accuracy circle
            if (window.sosAccuracyCircle) {
                window.sosAccuracyCircle.setLatLng(newLatLng);
                if (data.accuracy) window.sosAccuracyCircle.setRadius(data.accuracy);
            }

            // Extend the breadcrumb trail
            if (window.sosBreadcrumb) {
                window.sosBreadcrumb.addLatLng(newLatLng);
            }

            // Update the HUD bar with new coordinates
            const hudCoords = document.getElementById('sos-hud-coords');
            if (hudCoords) hudCoords.textContent = `${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`;
            const hudGmaps = document.getElementById('sos-hud-gmaps-link');
            if (hudGmaps) hudGmaps.href = `https://www.google.com/maps?q=${data.lat},${data.lon}`;

            // Keep the Get Directions button target up-to-date
            window._sosLiveLat = data.lat;
            window._sosLiveLon = data.lon;

            // Pan the map to follow
            if (map) map.panTo(newLatLng, { animate: true, duration: 0.8 });
        });
    }
}

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
    const dLatLng = [destCoords.lat, destCoords.lon];

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
    let cinematicColor = isSentinelMode ? '#ff3333' : '#00ffff';
    let cinematicClass = isSentinelMode ? 'sentinel-route-line' : 'neon-route-line';
    currentRouteLine = L.polyline(routePoints, {
        color: cinematicColor,
        weight: 5,
        opacity: 0.95,
        className: cinematicClass
    }).addTo(map);
    if (isSentinelMode) {
        showSentinelToast('🛡️ Sentinel Active: Routing via Primary Arterial Roads.');
    }

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

    // ── 5. Cinematic 'Drone' Fly-Over — buttery smooth camera swoop ──
    map.flyToBounds(currentRouteLine.getBounds(), {
        padding: [50, 50],
        duration: 2.5,
        easeLinearity: 0.25
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

        // ═══════════════════════════════════════════════════════════════════
        //  SENTINEL SHIELD — AI CHATBOT COMMAND INTERCEPTOR
        //  Handles shield commands entirely client-side before hitting the
        //  backend API. This gives the AI "complete access" to the shield.
        // ═══════════════════════════════════════════════════════════════════
        const lowerText = text.toLowerCase().trim();

        // ── Helper: send a rich HTML AI response in the chat ──
        function appendAiHtml(html) {
            if (!aiChatMessages) return;
            const msg = document.createElement('div');
            msg.className = 'ai-msg ai';
            msg.innerHTML = html;
            aiChatMessages.appendChild(msg);
            aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
        }

        // ── 1. ACTIVATE SHIELD ──
        const activatePattern = /\b(activate|enable|turn on|start|arm|engage)\b.*\b(shield|sentinel|sos|safety|emergency|protection)\b|\b(shield|sentinel|sos|safety|emergency|protection)\b.*\b(on|activate|enable|start|arm|engage)\b|\b(i('m| am)\s*(not\s+)?(safe|scared|afraid|in danger|unsafe|feeling unsafe|nervous|worried))\b|\b(help me|i need help|emergency)\b/i;

        if (activatePattern.test(lowerText)) {
            if (isSentinelMode) {
                appendAiHtml(
                    `🛡️ <strong>Sentinel Shield is already ARMED.</strong><br><br>` +
                    `${sentinelLastCoords
                        ? `📍 Your live location: <strong>${sentinelLastCoords.lat.toFixed(5)}, ${sentinelLastCoords.lon.toFixed(5)}</strong> (±${Math.round(sentinelLastCoords.accuracy)}m)<br><br>` +
                        `Say <strong>"send SOS"</strong> to share your location via WhatsApp, or <strong>"shield off"</strong> to deactivate.`
                        : `⏳ GPS is still acquiring your position. Please wait a moment.`
                    }`
                );
            } else {
                toggleSentinelMode();
                appendAiHtml(
                    `🚨 <strong>Sentinel Shield ACTIVATED.</strong><br><br>` +
                    `I'm acquiring your real GPS coordinates now using your device's hardware.<br><br>` +
                    `<strong>What happens next:</strong><br>` +
                    `• Your browser will ask for location permission — <strong>please allow it</strong><br>` +
                    `• Once locked, your exact position appears on the map<br>` +
                    `• A WhatsApp SOS with your Google Maps link will fire automatically<br><br>` +
                    `Say <strong>"shield status"</strong> to check your coordinates, or <strong>"send SOS"</strong> to re-send your location.`
                );
            }
            return;
        }

        // ── 2. DEACTIVATE SHIELD ──
        const deactivatePattern = /\b(deactivate|disable|turn off|stop|disarm|disengage)\b.*\b(shield|sentinel|sos|safety|emergency|protection)\b|\b(shield|sentinel|sos|safety|emergency|protection)\b.*\b(off|deactivate|disable|stop|disarm)\b|\b(i('m| am) (safe|okay|fine|home|alright))\b|\b(cancel\s*(sos|shield|emergency|sentinel))\b/i;

        if (deactivatePattern.test(lowerText)) {
            if (!isSentinelMode) {
                appendAiHtml(
                    `🛡️ Sentinel Shield is currently <strong>OFF</strong>.<br><br>` +
                    `There's nothing to deactivate. Say <strong>"activate shield"</strong> if you need emergency protection.`
                );
            } else {
                deactivateSentinel();
                appendAiHtml(
                    `✅ <strong>Sentinel Shield deactivated.</strong><br><br>` +
                    `GPS tracking has been stopped and your location marker has been cleared from the map.<br>` +
                    `Stay safe! You can re-activate anytime by saying <strong>"activate shield"</strong> or tapping the shield button.`
                );
            }
            return;
        }

        // ── 3. SHIELD STATUS ──
        const statusPattern = /\b(shield|sentinel|sos|gps|location)\b.*\b(status|state|check|info|details|where am i|coordinates|position)\b|\b(status|state|check)\b.*\b(shield|sentinel|sos|gps)\b|\b(where am i|my location|my coordinates|my position|am i safe)\b/i;

        if (statusPattern.test(lowerText)) {
            if (!isSentinelMode) {
                appendAiHtml(
                    `🛡️ <strong>Sentinel Shield: OFF</strong><br><br>` +
                    `The shield is not currently active. No GPS tracking in progress.<br><br>` +
                    `Say <strong>"activate shield"</strong> to enable emergency protection with real-time GPS tracking and WhatsApp SOS.`
                );
            } else if (!sentinelLastCoords) {
                appendAiHtml(
                    `🛡️ <strong>Sentinel Shield: LOCATING...</strong><br><br>` +
                    `⏳ GPS is actively acquiring your hardware coordinates. This usually takes a few seconds.<br>` +
                    `Make sure location permissions are enabled in your browser.`
                );
            } else {
                const { lat, lon, accuracy, timestamp } = sentinelLastCoords;
                const time = new Date(timestamp).toLocaleTimeString('en-IN', { hour12: true });
                const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
                appendAiHtml(
                    `🛡️ <strong>Sentinel Shield: ARMED ✅</strong><br><br>` +
                    `📍 <strong>Latitude:</strong> ${lat.toFixed(6)}<br>` +
                    `📍 <strong>Longitude:</strong> ${lon.toFixed(6)}<br>` +
                    `🎯 <strong>Accuracy:</strong> ±${Math.round(accuracy)}m<br>` +
                    `🕐 <strong>Last Fix:</strong> ${time}<br>` +
                    `📡 <strong>Tracking Points:</strong> ${sentinelLocationHistory.length}<br><br>` +
                    `🗺️ <a href="${mapsLink}" target="_blank" style="color:#ff6666;font-weight:700;">Open in Google Maps →</a><br><br>` +
                    `Say <strong>"send SOS"</strong> to share this location, or <strong>"shield off"</strong> to deactivate.`
                );
            }
            return;
        }

        // ── 4. SEND / RE-SEND SOS ──
        const sosPattern = /\b(send|fire|trigger|share|broadcast)\b.*\b(sos|location|position|coordinates|emergency|alert|help)\b|\b(sos|whatsapp)\b|\b(share\s*(my\s+)?location)\b/i;

        if (sosPattern.test(lowerText)) {
            if (!isSentinelMode) {
                appendAiHtml(
                    `⚠️ Sentinel Shield is <strong>OFF</strong>. I need to activate it first to get your GPS coordinates.<br><br>` +
                    `Activating now...`
                );
                toggleSentinelMode();
                appendAiHtml(
                    `🚨 <strong>Shield ACTIVATED.</strong> Once GPS locks on, your SOS will fire automatically via WhatsApp with your real Google Maps link.`
                );
            } else if (!sentinelLastCoords) {
                appendAiHtml(
                    `⏳ GPS is still acquiring your position. The SOS will fire automatically as soon as coordinates are locked.<br>` +
                    `Please wait a moment...`
                );
            } else {
                const { lat, lon } = sentinelLastCoords;
                fireSentinelSOS(lat, lon);
                const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
                appendAiHtml(
                    `🚨 <strong>SOS SENT via WhatsApp!</strong><br><br>` +
                    `📍 Location shared: <a href="${mapsLink}" target="_blank" style="color:#ff6666;font-weight:700;">${lat.toFixed(5)}, ${lon.toFixed(5)}</a><br><br>` +
                    `The WhatsApp window should have opened. Select a contact and send the pre-filled message.<br>` +
                    `Say <strong>"send SOS"</strong> again to re-send with your latest position.`
                );
            }
            return;
        }

        // ── 5. SHIELD HELP — What can the shield do? ──
        const helpPattern = /\b(what|how|explain|tell me about|features|capabilities)\b.*\b(shield|sentinel|sos|safety|emergency)\b|\b(shield|sentinel)\b.*\b(help|commands|options|what can)\b|\bsentinel\b$/i;

        if (helpPattern.test(lowerText)) {
            appendAiHtml(
                `🛡️ <strong>Sentinel Shield — Commands</strong><br><br>` +
                `Here's everything I can do with the shield:<br><br>` +
                `🟢 <strong>"Activate shield"</strong> — Arms the shield, starts real GPS tracking, and auto-sends SOS via WhatsApp<br><br>` +
                `🔴 <strong>"Deactivate shield"</strong> — Turns off GPS tracking and clears your location marker<br><br>` +
                `📍 <strong>"Shield status"</strong> — Shows your live coordinates, accuracy, and tracking info<br><br>` +
                `🚨 <strong>"Send SOS"</strong> — Sends your exact Google Maps location via WhatsApp<br><br>` +
                `📡 <strong>"Where am I?"</strong> — Shows your current GPS position<br><br>` +
                `💬 <strong>"I'm not safe"</strong> — Instantly activates the shield<br><br>` +
                `💬 <strong>"I'm safe now"</strong> — Deactivates the shield<br><br>` +
                `You can also tap the 🛡️ button at the bottom-left of the screen anytime.`
            );
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  No shield command matched — proceed to backend AI as normal
        // ═══════════════════════════════════════════════════════════════════

        // Typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'ai-msg ai typing-indicator';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        if (aiChatMessages) { aiChatMessages.appendChild(typingEl); aiChatMessages.scrollTop = aiChatMessages.scrollHeight; }

        try {
            const response = await fetch(`${API_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
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
                const toEl = document.getElementById('to');
                if (fromEl) fromEl.value = data.from || '';
                if (toEl) toEl.value = data.to || '';

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
                    tripId: data.routes[0]?.tripId || null,
                    suggestedBusNumber: data.suggestedBusNumber,
                    from: data.from,
                    to: data.to
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

if (busIcon) {
    busIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        clickCount++;
        if (clickCount === 1) {
            clickTimer = setTimeout(() => { clickCount = 0; }, 1200);
        }
        if (clickCount === 3) {
            clearTimeout(clickTimer);
            clickCount = 0;
            if (adminModal) adminModal.classList.add("show");
        }
    });
}

function closeAdmin() {
    if (adminModal) adminModal.classList.remove("show");
}

// ================= GOD MODE TERMINAL STREAM =================
let _terminalIntervalId = null;

function startTerminalStream() {
    const terminal = document.getElementById('admin-terminal');
    if (!terminal) return;

    // Reveal the terminal
    terminal.classList.remove('hidden');

    // Stop any pre-existing stream before starting a new one
    if (_terminalIntervalId) clearInterval(_terminalIntervalId);

    const logs = [
        'Initialising secure uplink...',
        'Decrypting Node Cluster [HYD-TRANSIT-01]...',
        'Bypassing OSRM routing firewall...',
        'Groq LLM Core — ACTIVE ✓',
        'MongoDB Atlas connected — 16 stop nodes online.',
        'Live Transit Stream CONNECTED.',
        'Scanning GTFS feed: 847 trips loaded.',
        'Fleet telemetry: Bus #273D — lat 17.4239 lon 78.4481',
        'Route Intelligence Engine v3.2 initialised.',
        'Anomaly detector: 0 critical alerts.',
        'Admin privileges GRANTED — God Mode enabled.',
        'Hyderabad Transit Grid: ALL SYSTEMS GREEN.',
        'Synchronising real-time arrival data...',
        'OSRM road-snap: 99.3% accuracy on last 500 queries.',
        'API latency: 43ms — within SLA target.',
        'Passenger load model: ACTIVE.',
        'Emergency override protocols: STANDBY.',
        'Deep-link to satellite uplink... established.',
        'Encrypting admin session token.',
        'Fleet GPS ping interval: 800ms.',
        'AI suggestion cache: WARM.',
        'System integrity check: PASSED.',
        'Shadow routing fallback: READY.',
        'MMTS corridor sync: COMPLETE.',
    ];

    // Prefix options to vary the feel
    const prefixes = ['>', '>>', '▶', '##', '--', '✓', '⚡', '❯❯'];

    function appendLog() {
        // Pick a random log entry
        const line = logs[Math.floor(Math.random() * logs.length)];
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];

        // Build the timestamp
        const now = new Date();
        const ts = now.toLocaleTimeString('en-IN', { hour12: false }) +
            '.' + String(now.getMilliseconds()).padStart(3, '0');

        const el = document.createElement('div');
        el.className = 'terminal-log';
        el.innerHTML =
            `<span class="ts">[${ts}]</span>${prefix} ${line}`;
        terminal.appendChild(el);

        // Auto-scroll to bottom
        terminal.scrollTop = terminal.scrollHeight;

        // Cap at 120 lines to prevent DOM bloat
        const allLogs = terminal.querySelectorAll('.terminal-log');
        if (allLogs.length > 120) allLogs[0].remove();

        // Re-schedule with a randomised interval (600ms – 1200ms)
        _terminalIntervalId = setTimeout(appendLog, 600 + Math.random() * 600);
    }

    // Kick off the first entry immediately
    appendLog();
}

function loginAdmin() {
    const adminUserInput = document.getElementById("admin-user");
    const adminPassInput = document.getElementById("admin-pass");
    const username = (adminUserInput?.value || "").trim();
    const password = (adminPassInput?.value || "").trim();

    if (username === "admin" && password === "system") {
        // ── God Mode: show terminal stream before navigating ──
        startTerminalStream();

        // Give the user a brief moment to see the terminal boot up,
        // then redirect to the full admin dashboard.
        setTimeout(() => {
            localStorage.setItem("isAdminLoggedIn", "true");
            if (_terminalIntervalId) clearInterval(_terminalIntervalId);
            window.location.href = "admin.html";
        }, 3000);
        return;
    }

    // ── Wrong creds: flash the terminal with an access-denied stream ──
    const terminal = document.getElementById('admin-terminal');
    if (terminal) {
        terminal.classList.remove('hidden');
        terminal.innerHTML = '';
        const el = document.createElement('div');
        el.className = 'terminal-log';
        el.style.color = '#ff4444';
        el.style.textShadow = '0 0 8px rgba(255,0,0,0.7)';
        el.innerHTML = `<span class="ts">[${new Date().toLocaleTimeString('en-IN', { hour12: false })}]</span>` +
            `⛔ ACCESS DENIED — Invalid credentials. Intrusion logged.`;
        terminal.appendChild(el);
        if (_terminalIntervalId) clearInterval(_terminalIntervalId);
        setTimeout(() => terminal.classList.add('hidden'), 4000);
    }
}

// ================= STRUCTURAL EXTENSION LOGIC =================
function showContact() {
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    document.getElementById('contact-view').classList.add('active');
}

function showAbout() {
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    document.getElementById('about-view').classList.add('active');
}

function showLanding() {
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    document.getElementById('landing').classList.add('active');
}