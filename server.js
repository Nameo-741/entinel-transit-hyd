require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const OpenAI = require('openai');

// ================= OPENROUTER AI CLIENT =================
// Uses OpenRouter to connect to AI models. Falls back to local NLP if key absent.
const aiClient = process.env.OPENROUTER_API_KEY
    ? new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1'
      })
    : null;

if (aiClient) {
    console.log('✅ OpenRouter AI client initialized');
} else {
    console.log('⚠️  OPENROUTER_API_KEY not set — /api/chat will use local NLP fallback only');
}

const app = express();
// SSE client registry for live query streaming
const adminSseClients = new Set();
let ecoImpactKg = 0; // Total CO2 saved today (kg)
app.use(cors());
app.use(express.json());

// ================= STATIC FILES =================
// Primary: serve the vanilla frontend (Spline-upgraded index.html + script.js + style.css)
app.use(express.static(path.join(__dirname, 'frontend')));
// Fallback: also expose landing/dist assets if they exist
app.use(express.static(path.join(__dirname, 'landing', 'dist')));

// Explicit root route → always serves the vanilla frontend index
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});
// Hidden "God Mode" admin route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

// ================= 1. CONNECT TO MONGODB =================
const dbURI = process.env.MONGO_URI || process.env.DB_URL;

if (!dbURI) {
    console.log("❌ ERROR: Could not find your MongoDB URI in the .env file.");
    process.exit(1);
}

mongoose.connect(dbURI, { maxPoolSize: 10 })
    .then(() => console.log('✅ MongoDB Connected to Live Database!'))
    .catch(err => console.error('Connection error:', err));

// ================= IN-MEMORY CACHE =================
const cache = new Map();
function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > 300000) { cache.delete(key); return null; } // 5-min TTL
    return entry.val;
}
function cacheSet(key, val) { cache.set(key, { val, ts: Date.now() }); }
// Cap cache size to avoid memory bloat
function cachePut(key, val) {
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cacheSet(key, val);
}

// ================= 2. DEFINE YOUR DATA MODELS =================
const Route = mongoose.model('Route', new mongoose.Schema({
    route_id: { type: String, index: true },
    route_short_name: String,
    route_long_name: String,
    route_type: Number // 3 for bus, 1 for metro
}));

const Trip = mongoose.model('Trip', new mongoose.Schema({
    route_id: { type: String, index: true },
    trip_id: { type: String, index: true },
    trip_headsign: String
}));

const Stop = mongoose.model('Stop', new mongoose.Schema({
    stop_id: { type: String, index: true },
    stop_name: { type: String, index: true },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    }
}));

const StopTime = mongoose.model('StopTime', new mongoose.Schema({
    trip_id: { type: String, index: true },
    arrival_time: String,
    stop_id: { type: String, index: true },
    stop_sequence: Number
}));

function parseRouteEndpoints(routeText) {
    const text = String(routeText || "").trim();
    if (!text) return { from: "", to: "" };
    if (text.includes("⇄")) {
        const [from, to] = text.split("⇄").map(s => s.trim());
        return { from: from || "", to: to || "" };
    }
    if (text.includes("-")) {
        const [from, to] = text.split("-").map(s => s.trim());
        return { from: from || "", to: to || "" };
    }
    return { from: "", to: "" };
}

// ================= 3. API ENDPOINTS =================

// Returns "HH:MM" a few minutes from now — used when no real timetable exists
function nextDepartureTime() {
    const dep = new Date(Date.now() + (Math.floor(Math.random() * 18) + 3) * 60000);
    return `${String(dep.getHours()).padStart(2, '0')}:${String(dep.getMinutes()).padStart(2, '0')}`;
}

// Endpoint A: Search for Bus Routes
async function performGTFSSearch(rawFrom, rawTo, travelType = "Live", scheduledTime = null) {
    if (!rawFrom || !rawTo) return [];

    const from = String(rawFrom).trim();
    const to   = String(rawTo).trim();

    // ---- Cache check ----
    const cacheKey = `search:${from.toLowerCase()}:${to.toLowerCase()}:${travelType}`;
    const cached = cacheGet(cacheKey);
    if (cached && cached.length > 0) {  // never serve a stale empty result
        // Apply scheduledTime label on cached results without re-querying
        if (travelType === 'Later') {
            return cached.map(r => ({
                ...r,
                arrival: scheduledTime ? `Scheduled for ${scheduledTime}` : 'Scheduled for Later'
            }));
        }
        return cached;
    }

    try {
        // --- Parallel stop lookup ---
        const [fromStops, toStops] = await Promise.all([
            Stop.find({ stop_name: { $regex: from, $options: 'i' } }).select('stop_id').lean(),
            Stop.find({ stop_name: { $regex: to,   $options: 'i' } }).select('stop_id').lean()
        ]);

        let formattedResults = [];

        if (fromStops.length > 0 && toStops.length > 0) {
            const fromStopIds = fromStops.map(s => s.stop_id);
            const toStopIds   = toStops.map(s => s.stop_id);

            // --- Parallel StopTime lookup ---
            const [fromTimes, toTimes] = await Promise.all([
                StopTime.find({ stop_id: { $in: fromStopIds } }).select('trip_id stop_sequence arrival_time').lean(),
                StopTime.find({ stop_id: { $in: toStopIds   } }).select('trip_id stop_sequence').lean()
            ]);

            // Build destination-sequence map
            const toMap = new Map();
            for (const t of toTimes) {
                if (!toMap.has(t.trip_id) || t.stop_sequence > toMap.get(t.trip_id))
                    toMap.set(t.trip_id, t.stop_sequence);
            }

            // Collect valid trip_ids (origin before destination)
            const validTrips = [];
            const seenTripIds = new Set();
            for (const f of fromTimes) {
                if (toMap.has(f.trip_id) && toMap.get(f.trip_id) > f.stop_sequence && !seenTripIds.has(f.trip_id)) {
                    seenTripIds.add(f.trip_id);
                    validTrips.push({ trip_id: f.trip_id, arrival_time: f.arrival_time });
                    if (validTrips.length >= 100) break; // increased from 30 → 100 for more results
                }
            }

            // --- Bulk-fetch all trips and routes in parallel instead of N+1 loop ---
            const tripIds = validTrips.map(v => v.trip_id);
            const [tripsFound, ] = await Promise.all([
                Trip.find({ trip_id: { $in: tripIds } }).lean()
            ]);

            const tripMap = new Map(tripsFound.map(t => [t.trip_id, t]));
            const routeIds = [...new Set(tripsFound.map(t => t.route_id).filter(Boolean))];
            const routesFound = await Route.find({ route_id: { $in: routeIds } }).lean();
            const routeMap = new Map(routesFound.map(r => [r.route_id, r]));

            const seenCombos = new Set();
            for (const vt of validTrips) {
                if (formattedResults.length >= 20) break; // increased from 15 → 20 for more bus cards
                const trip  = tripMap.get(vt.trip_id);
                if (!trip) continue;
                const route = routeMap.get(trip.route_id);
                if (!route) continue;

                const rShort = String(route.route_short_name || '').trim().toUpperCase();
                const rLong  = String(route.route_long_name  || '').trim().toUpperCase();
                if (!rShort || rShort === 'NONE' || rShort === 'NULL' ||
                    !rLong  || rLong  === 'NONE' || rLong  === 'NULL') continue;

                const comboKey = `${rShort}_${vt.arrival_time}`;
                if (seenCombos.has(comboKey)) continue;
                seenCombos.add(comboKey);

                const isMetro = route.route_type === 1 || route.route_type === 2;
                formattedResults.push({
                    tripId:    trip.trip_id,
                    busNumber: route.route_short_name || route.route_id,
                    route:     route.route_long_name  || `${from} - ${to}`,
                    direction: trip.trip_headsign     || to,
                    arrival:   (vt.arrival_time === '06:00' || vt.arrival_time === '06:30') ? nextDepartureTime() : vt.arrival_time,
                    isMetro,
                    type: isMetro ? '🚇 Metro' : '🚌 Bus'
                });
            }
        }

        // ── Text-based route_long_name search (primary path when stops collection empty) ──
        if (formattedResults.length === 0) {
            // Normalise: strip noise words, take first 2 meaningful words as search tokens
            const NOISE = new Set(['bus','stand','station','road','colony','nagar','x','xrd','cross','junction','stop']);
            function extractToken(str) {
                const words = str.trim().split(/\s+/).filter(w => w.length > 1 && !NOISE.has(w.toLowerCase()));
                return words.slice(0, 2).join(' ') || str.trim().split(/\s+/)[0];
            }

            const fromToken = extractToken(from);
            const toToken   = extractToken(to);

            // Also try just the very first word as a fallback token
            const fromWord1 = from.trim().split(/\s+/)[0];
            const toWord1   = to.trim().split(/\s+/)[0];

            const textRoutes = await Route.find({
                $or: [
                    { $and: [{ route_long_name: { $regex: fromToken, $options: 'i' } }, { route_long_name: { $regex: toToken,   $options: 'i' } }] },
                    { $and: [{ route_long_name: { $regex: fromWord1, $options: 'i' } }, { route_long_name: { $regex: toWord1,   $options: 'i' } }] },
                    // Also search by exact user input — catches cases where full name IS in the route
                    { $and: [{ route_long_name: { $regex: from.trim(), $options: 'i' } }, { route_long_name: { $regex: to.trim(), $options: 'i' } }] }
                ]
            }).limit(60).lean();

            console.log(`[TextSearch] from="${from}" → token="${fromToken}" | to="${to}" → token="${toToken}" | matches=${textRoutes.length}`);

            const textSeen = new Set();
            for (const route of textRoutes) {
                if (formattedResults.length >= 20) break;
                const longUpper = (route.route_long_name || '').toUpperCase();
                // Accept any match where both tokens appear somewhere in the name
                if (longUpper.includes(fromToken.toUpperCase()) || longUpper.includes(fromWord1.toUpperCase())) {
                    if (longUpper.includes(toToken.toUpperCase())   || longUpper.includes(toWord1.toUpperCase())) {
                        const tKey = route.route_short_name || route.route_id;
                        if (textSeen.has(tKey)) continue;
                        textSeen.add(tKey);
                        const arrivalStr = nextDepartureTime();
                        formattedResults.push({
                            busNumber: route.route_short_name || route.route_id,
                            route:     route.route_long_name,
                            direction: to,
                            arrival:   arrivalStr,
                            fare:      route.base_fare || null,
                            isMetro:   false,
                            type:      route.is_demo_clone ? '🚌 Bus (Demo)' : '🚌 Bus'
                        });
                    }
                }
            }
        }


        // Fallback: admin 'buses' collection
        if (formattedResults.length === 0) {
            const fallbackBuses = await mongoose.connection.db
                .collection('buses')
                .find({
                    $or: [
                        { $and: [{ route:      { $regex: from, $options: 'i' } }, { route:      { $regex: to, $options: 'i' } }] },
                        { $and: [{ from:       { $regex: from, $options: 'i' } }, { to:         { $regex: to, $options: 'i' } }] },
                        { $and: [{ route_name: { $regex: from, $options: 'i' } }, { route_name: { $regex: to, $options: 'i' } }] }
                    ]
                })
                .sort({ createdAt: -1 })
                .limit(8)
                .toArray();

            formattedResults = fallbackBuses.map(bus => ({
                busNumber: bus.busNumber || bus.bus_id || bus.bus_number || bus.route_id || 'N/A',
                route:     bus.route_name || bus.route || (bus.from && bus.to ? `${bus.from} - ${bus.to}` : 'Route data unavailable'),
                direction: bus.to || to,
                arrival:   bus.departureTime || bus.arrival_time || 'Live Tracking Active',
                isMetro:   false,
                type:      '🚌 Bus Fallback'
            }));
        }

        // Cache the base results (without scheduledTime label)
        // Only cache when we actually have results — prevents stale empty-cache bug
        if (formattedResults.length > 0) cachePut(cacheKey, formattedResults);

        // Apply scheduledTime label before returning
        if (travelType === 'Later' && formattedResults.length > 0) {
            return formattedResults.map(r => ({
                ...r,
                arrival: scheduledTime ? `Scheduled for ${scheduledTime}` : 'Scheduled for Later'
            }));
        }

        return formattedResults;
    } catch (error) {
        console.error('GTFS Search Logic Error:', error);
        return [];
    }
}

// Endpoint A-0: Autocomplete stop names from the live DB
app.get('/api/stops', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);

    const cacheKey = `stops:${q.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const stops = await Stop.find({
            stop_name: { $regex: q, $options: 'i' }
        })
        .select('stop_name agency transit_type')
        .limit(12)
        .lean();

        // Deduplicate by stop_name (different platforms share names)
        const seen = new Set();
        const unique = stops.filter(s => {
            const key = s.stop_name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const result = unique.map(s => ({
            name:         s.stop_name,
            agency:       s.agency,
            transit_type: s.transit_type
        }));

        cachePut(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Stops API Error:', error);
        res.status(500).json({ error: 'Server error fetching stops' });
    }
});

// Endpoint A-0.5: Lightning Autocomplete — top 5 results in < 50ms
app.get('/api/stops/suggest', async (req, res) => {
    const q = String(req.query.q || '').trim();
    console.log('[Autocomplete] Pinged with:', q); // DEBUG LOG
    if (!q || q.length < 2) return res.json([]);

    // Cache key for rapid repeat hits
    const cacheKey = `suggest:${q.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) { console.log('[Autocomplete] Cache hit →', cached.length, 'results'); return res.json(cached); }

    try {
        const unique = [];
        const seen   = new Set();

        // ── Pass 1: Search the Stops collection (stop_name field) ──
        const stopDocs = await Stop.find({
            stop_name: { $regex: q, $options: 'i' }
        }).select('stop_name').limit(10).lean();

        for (const s of stopDocs) {
            const name = (s.stop_name || '').trim();
            const key  = name.toLowerCase();
            if (name && !seen.has(key)) { seen.add(key); unique.push({ name }); }
            if (unique.length >= 5) break;
        }

        // ── Pass 2: Fallback to Route names when Stops collection is empty/sparse ──
        // Searches route_long_name (e.g. "KOTI TO SECUNDERABAD") and extracts individual stop names
        if (unique.length < 5) {
            const routeDocs = await Route.find({
                route_long_name: { $regex: q, $options: 'i' }
            }).select('route_long_name route_short_name').limit(20).lean();

            for (const r of routeDocs) {
                if (unique.length >= 5) break;
                const parts = (r.route_long_name || '').split(/ TO /i).map(p => p.trim());
                for (const part of parts) {
                    if (unique.length >= 5) break;
                    const key = part.toLowerCase();
                    if (part.length >= 2 && !seen.has(key) && part.toLowerCase().includes(q.toLowerCase())) {
                        seen.add(key);
                        unique.push({ name: part });
                    }
                }
            }
        }

        console.log(`[Autocomplete] "${q}" → ${unique.length} suggestions:`, unique.map(u => u.name));
        cachePut(cacheKey, unique);
        res.json(unique);
    } catch (error) {
        console.error('[Autocomplete] Error:', error);
        res.status(500).json({ error: 'Server error fetching suggestions' });
    }
});

app.get('/api/search', async (req, res) => {
    const { from, to, travelType, scheduledTime } = req.query;

    if (!from || !to) {
        return res.status(400).json({ error: "Please provide 'from' and 'to' parameters." });
    }

    try {
        const results = await performGTFSSearch(from, to, travelType, scheduledTime);
        res.json(results);
    } catch (error) {
        console.error("Search API Error:", error);
        res.status(500).json({ error: "Server error while searching routes" });
    }
});

// Endpoint: GTFS Trip Simulation Data
app.get('/api/trip-simulation', async (req, res) => {
    const { tripId } = req.query;
    if (!tripId) return res.status(400).json({ error: 'tripId is required' });

    try {
        const stopTimes = await StopTime.find({ trip_id: tripId }).sort({ stop_sequence: 1 }).lean();
        const stopIds = stopTimes.map(st => st.stop_id);
        const stops = await Stop.find({ stop_id: { $in: stopIds } }).lean();
        const stopMap = new Map(stops.map(s => [s.stop_id, s]));

        const schedule = [];
        const polyline = [];
        const stopsCoords = [];

        for (const st of stopTimes) {
            const stop = stopMap.get(st.stop_id);
            if (!stop || !stop.location || !stop.location.coordinates) continue;
            // MongoDB geo is [lon, lat]
            const lon = stop.location.coordinates[0];
            const lat = stop.location.coordinates[1];

            // Parse GTFS arrival_time "HH:MM:SS"
            const parts = (st.arrival_time || '00:00:00').split(':');
            let h = parseInt(parts[0]) || 0;
            let m = parseInt(parts[1]) || 0;
            let s = parseInt(parts[2]) || 0;
            
            if (h >= 24) h -= 24;

            const timeInSeconds = h * 3600 + m * 60 + s;

            schedule.push({ time: timeInSeconds, lat, lon });
            polyline.push([lat, lon]);
            stopsCoords.push([lat, lon]);
        }

        // --- OSRM Road-Snapping to fix straight-line bug ---
        let finalPolyline = polyline;
        try {
            if (stopsCoords.length > 1) {
                // OSRM Public API allows max 100 waypoints. Cap to 95 for safety padding.
                let sampledStops = stopsCoords;
                if (stopsCoords.length > 95) {
                    const step = Math.ceil(stopsCoords.length / 95);
                    sampledStops = stopsCoords.filter((_, i) => i % step === 0 || i === stopsCoords.length - 1);
                }

                // OSRM parameter takes lon,lat pairs
                const coordinateString = sampledStops.map(c => `${c[1]},${c[0]}`).join(';');
                const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordinateString}?overview=full&geometries=geojson`;
                
                const osrmRes = await fetch(osrmUrl, { signal: AbortSignal.timeout(8000) });
                if (osrmRes.ok) {
                    const osrmData = await osrmRes.json();
                    if (osrmData.code === 'Ok' && osrmData.routes?.[0]?.geometry?.coordinates) {
                        // GeoJSON returns [lon,lat], convert to Leaflet's [lat,lon]
                        finalPolyline = osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    }
                } else {
                    console.warn(`[OSRM Snap Warning] Could not snap polyline for trip ${tripId}, HTTP ${osrmRes.status}`);
                }
            }
        } catch (err) {
            console.error(`[OSRM Snap Error] Trip ${tripId}:`, err.message);
        }

        res.json({ schedule, polyline: finalPolyline, stops: stopsCoords });
    } catch (error) {
        console.error('[Trip Simulation] Error:', error);
        res.status(500).json({ error: 'Server error generating trip simulation data' });
    }
});

// Endpoint B: Get Exact GPS Coordinates for the Map
app.get('/api/coordinates', async (req, res) => {
    const { location } = req.query;
    const cleanedLocation = String(location || '').trim();

    if (!cleanedLocation) {
        return res.status(400).json({ error: "Please provide a valid location." });
    }

    try {
        const stop = await Stop.findOne({ 
            stop_name: { $regex: new RegExp(cleanedLocation, 'i') } 
        });

        if (stop && stop.location && stop.location.coordinates && stop.location.coordinates.length >= 2) {
            res.json({ lat: stop.location.coordinates[1], lon: stop.location.coordinates[0] });
        } else {
            // Fallback to external geocoding if stop isn't in local DB.
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(cleanedLocation + ', Hyderabad')}`;
            const geoRes = await fetch(nominatimUrl, {
                headers: { 'User-Agent': 'city-bus-tracker/1.0 (geocoding-fallback)' }
            });
            const geoData = await geoRes.json();

            if (!geoRes.ok || !Array.isArray(geoData) || geoData.length === 0) {
                return res.status(404).json({ error: "Stop GPS not found" });
            }

            res.json({
                lat: Number(geoData[0].lat),
                lon: Number(geoData[0].lon)
            });
        }
    } catch (error) {
        console.error("GPS Error:", error);
        res.status(500).json({ error: "Server error finding coordinates" });
    }
});

// Endpoint C: Build route path using OpenRouteService
app.get('/api/route', async (req, res) => {
    const { startLat, startLon, endLat, endLon } = req.query;

    if (!startLat || !startLon || !endLat || !endLon) {
        return res.status(400).json({ error: "Missing route coordinates." });
    }

    const orsApiKey = process.env.OPENROUTE_API_KEY;
    if (!orsApiKey) {
        return res.status(500).json({ error: "OPENROUTE_API_KEY is not configured on server." });
    }

    try {
        const routeUrl = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${encodeURIComponent(orsApiKey)}&start=${encodeURIComponent(startLon)},${encodeURIComponent(startLat)}&end=${encodeURIComponent(endLon)},${encodeURIComponent(endLat)}`;
        const orsResponse = await fetch(routeUrl);
        const orsData = await orsResponse.json();

        if (!orsResponse.ok) {
            const orsMessage = orsData?.error?.message || orsData?.error || "OpenRouteService request failed";
            return res.status(orsResponse.status).json({ error: String(orsMessage) });
        }

        const coordinates = orsData?.features?.[0]?.geometry?.coordinates;
        if (!coordinates) {
            return res.status(502).json({ error: "OpenRouteService returned no route geometry." });
        }

        const summary = orsData?.features?.[0]?.properties?.summary || {};
        res.json({ coordinates, summary });
    } catch (error) {
        console.error("Route Error:", error);
        res.status(500).json({ error: "Server error while building route." });
    }
});

// Endpoint C2: Road-Snap route via OSRM (free, no API key needed)
// Returns [lat, lon] pairs for the driving road path between two points.
app.get('/api/osrm-route', async (req, res) => {
    const { startLat, startLon, endLat, endLon } = req.query;

    if (!startLat || !startLon || !endLat || !endLon) {
        return res.status(400).json({ error: 'Missing route coordinates.' });
    }

    try {
        // OSRM expects lon,lat order in the URL
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
        console.log(`[OSRM] Requesting road path: ${osrmUrl}`);
        const osrmRes = await fetch(osrmUrl, {
            headers: { 'User-Agent': 'HyderabadTransitAI/1.0' },
            signal: AbortSignal.timeout(8000) // 8-second timeout
        });

        if (!osrmRes.ok) {
            throw new Error(`OSRM responded with ${osrmRes.status}`);
        }

        const osrmData = await osrmRes.json();

        if (osrmData.code !== 'Ok' || !osrmData.routes?.[0]?.geometry?.coordinates) {
            return res.status(502).json({ error: 'OSRM returned no valid route geometry.' });
        }

        // OSRM GeoJSON coordinates are [lon, lat] — convert to [lat, lon] for Leaflet
        const latlngs = osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        const distance = osrmData.routes[0].distance; // metres
        const duration = osrmData.routes[0].duration; // seconds

        res.json({ latlngs, distance, duration });
    } catch (error) {
        console.error('[OSRM] Error:', error.message);
        res.status(500).json({ error: `OSRM road-snap failed: ${error.message}` });
    }
});

// Endpoint D: Admin - list all buses
app.get('/api/admin/buses', async (req, res) => {
    try {
        const buses = await mongoose.connection.db.collection('buses').find({}).toArray();
        res.json(buses);
    } catch (error) {
        console.error("Admin Buses Error:", error);
        res.status(500).json({ error: "Server error while fetching buses" });
    }
});

// Endpoint E: Admin - add a new bus
app.post('/api/admin/add-bus', async (req, res) => {
    const { busNumber, route, arrivalTime } = req.body || {};
    const cleanedBusNumber = String(busNumber || "").trim();
    const cleanedRoute = String(route || "").trim();
    const cleanedArrivalTime = String(arrivalTime || "").trim();

    if (!cleanedBusNumber || !cleanedRoute || !cleanedArrivalTime) {
        return res.status(400).json({ error: "Bus Number, Route, and Arrival Time are required." });
    }

    const busDoc = {
        bus_id: cleanedBusNumber,
        route_name: cleanedRoute,
        arrival_time: cleanedArrivalTime,
        createdAt: new Date()
    };

    try {
        const result = await mongoose.connection.db.collection('buses').insertOne(busDoc);
        res.status(201).json({ _id: result.insertedId, ...busDoc });
    } catch (error) {
        console.error("Admin Add Bus Error:", error);
        res.status(500).json({ error: "Server error while adding bus" });
    }
});

// Endpoint F: Admin - update a bus by id
app.put('/api/admin/bus/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid bus id." });
    }

    // Never allow _id overwrite from client payload.
    delete updates._id;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No update fields provided." });
    }

    try {
        const result = await mongoose.connection.db
            .collection('buses')
            .findOneAndUpdate(
                { _id: new mongoose.Types.ObjectId(id) },
                { $set: updates },
                { returnDocument: 'after' }
            );

        if (!result.value) {
            return res.status(404).json({ error: "Bus not found." });
        }

        res.json(result.value);
    } catch (error) {
        console.error("Admin Update Bus Error:", error);
        res.status(500).json({ error: "Server error while updating bus" });
    }
});

// Endpoint G: Admin - delete a bus by id
app.delete('/api/admin/bus/:id', async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid bus id." });
    }

    try {
        const result = await mongoose.connection.db
            .collection('buses')
            .deleteOne({ _id: new mongoose.Types.ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Bus not found." });
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Admin Delete Bus Error:", error);
        res.status(500).json({ error: "Server error while deleting bus" });
    }
});

// ================= LOCAL NLP EXTRACTION ENGINE =================
// 100% offline — zero external API dependencies.

const FILLER_WORDS = [
    'i want to go', 'i want to travel', 'i need to go', 'i need to reach',
    'i am going', 'i am travelling', 'i am traveling',
    'please find', 'please tell me', 'please show',
    'find me', 'find routes', 'find a bus', 'find bus',
    'show me', 'tell me', 'give me', 'get me',
    'best route', 'best bus', 'bus route', 'bus from',
    'how to go', 'how do i go', 'how do i reach', 'how can i go', 'how can i reach',
    'what bus', 'which bus', 'any bus',
    'route from', 'routes from', 'bus for',
    'going from', 'travel from', 'travelling from', 'traveling from',
    'from', 'please', 'thanks', 'thank you', 'hi', 'hello', 'hey',
    'hyderabad', 'in hyderabad'
];

/**
 * parseTransitQuery — local NLP function.
 * Extracts { origin, destination } from a free-text transit query.
 * Returns { origin, destination } on success, or null if extraction fails.
 */
function parseTransitQuery(userInput) {
    if (!userInput || typeof userInput !== 'string') return null;

    // 1. Lowercase & strip punctuation (keep letters, digits, spaces)
    let text = userInput.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // 2. Strip filler phrases longest-first to avoid partial matches
    const sortedFillers = [...FILLER_WORDS].sort((a, b) => b.length - a.length);
    for (const filler of sortedFillers) {
        // Use word-boundary-aware replace
        const re = new RegExp(`\\b${filler.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        text = text.replace(re, ' ');
    }
    text = text.replace(/\s+/g, ' ').trim();

    // 3. Split on standalone " to " to get origin and destination
    const parts = text.split(/\bto\b/);

    if (parts.length >= 2) {
        const origin      = parts[0].trim();
        const destination = parts.slice(1).join('to').trim(); // rejoin if "to" appears in place name
        if (origin.length >= 2 && destination.length >= 2) {
            return { origin, destination };
        }
    }

    return null; // Could not extract
}

// Endpoint H: AI-powered Transit Chat — xAI Grok with local NLP fallback
app.post('/api/chat', async (req, res) => {
    const userMessage = String(req.body?.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'Message is required.' });

    // ── Step 1: Extract origin/destination — try OpenRouter first, fall back to local NLP ──
    let origin = null;
    let destination = null;
    let aiProvider = 'local';

    if (aiClient) {
        try {
            const completion = await aiClient.chat.completions.create({
                model: 'openai/gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are the Hyderabad Transit AI, a highly advanced, friendly conversational assistant. If the user greets you or asks a general question, reply conversationally. If the user asks to find a bus, plan a journey, or gives a route, extract the origin and destination. Fix any spelling mistakes for Hyderabad locations. Return ONLY raw JSON with no markdown formatting. ' +
                                 'For conversation, use this schema: {"intent": "chat", "reply": "Your conversational response..."} ' +
                                 'For routing, use this schema: {"intent": "route", "origin": "...", "destination": "..."}'
                    },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.3,
                max_tokens: 150
            });

            const raw = (completion.choices?.[0]?.message?.content || '').trim();
            console.log(`[OpenRouter AI] Raw response: ${raw}`);

            // Strip any accidental markdown fences
            const jsonStr = raw.replace(/^```[\w]*\n?/, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(jsonStr);

            if (parsed.intent === 'chat' && parsed.reply) {
                console.log(`[OpenRouter AI] 💬 Conversational response parsed.`);
                return res.json({
                    answer: parsed.reply,
                    shouldTrack: false
                });
            } else if (parsed.intent === 'route' && parsed.origin && parsed.destination) {
                origin = parsed.origin;
                destination = parsed.destination;
                aiProvider = 'openrouter';
                console.log(`[OpenRouter AI] ✅ Extracted: origin="${origin}" destination="${destination}"`);
            } else if (parsed.origin && parsed.destination) { // Fallback if it forgot intent
                origin = parsed.origin;
                destination = parsed.destination;
                aiProvider = 'openrouter';
            } else {
                throw new Error('AI returned null intent/routing');
            }
        } catch (aiErr) {
            console.warn(`[OpenRouter AI] ⚠️  Failed (${aiErr.message}), falling back to local NLP`);
        }
    }

    // ── Local NLP fallback ──
    if (!origin || !destination) {
        const extracted = parseTransitQuery(userMessage);
        console.log(`[Local NLP] Fallback Input: "${userMessage}" → Extracted:`, extracted);
        if (extracted?.origin && extracted?.destination) {
            origin = extracted.origin;
            destination = extracted.destination;
            aiProvider = 'local-nlp';
        }
    }

    if (!origin || !destination) {
        return res.json({
            answer: "Hello! I'm your Hyderabad Transit AI 🚌. I couldn't catch your route. Try: <strong>'Ameerpet to Hitech City'</strong> or <strong>'Bus from Koti to Secunderabad'</strong>.",
            shouldTrack: false
        });
    }

    console.log(`[Chat] Provider: ${aiProvider} | origin="${origin}" destination="${destination}"`);

    // ── God Mode: Broadcast extraction to admin consoles ──
    broadcastAdminEvent('query', { origin, destination, raw: userMessage, aiProvider, time: new Date().toISOString() });
    ecoImpactKg += 0.15;

    try {
        // ── Step 2: GTFS search using the same fuzzy regex as the main search ──
        const results = await performGTFSSearch(origin, destination, 'Live', null);

        if (results && results.length > 0) {
            // Sort by arrival time (earliest first) and keep top 5
            const sorted = results
                .filter(r => r.busNumber && r.busNumber !== 'N/A')
                .sort((a, b) => {
                    const toSecs = t => {
                        if (!t || !t.includes(':')) return 9999;
                        const [h, m] = t.split(':').map(Number);
                        return h * 60 + m;
                    };
                    return toSecs(a.arrival) - toSecs(b.arrival);
                })
                .slice(0, 5);

            // Compute distance via Haversine for fare calculation
            let distanceKm = 8;
            let originCoords = null, destCoords = null;
            try {
                const [originStop, destStop] = await Promise.all([
                    Stop.findOne({ stop_name: { $regex: origin,      $options: 'i' } }).select('location stop_name').lean(),
                    Stop.findOne({ stop_name: { $regex: destination, $options: 'i' } }).select('location stop_name').lean()
                ]);
                if (originStop?.location?.coordinates && destStop?.location?.coordinates) {
                    const [lon1, lat1] = originStop.location.coordinates;
                    const [lon2, lat2] = destStop.location.coordinates;
                    originCoords = { lat: lat1, lon: lon1, name: originStop.stop_name };
                    destCoords   = { lat: lat2, lon: lon2, name: destStop.stop_name  };
                    const R    = 6371;
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const a    = Math.sin(dLat / 2) ** 2 +
                                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
                    distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3;
                }
            } catch (_) { /* keep default */ }

            // Annotate each result with a calculated fare so the sidebar cards can show it
            const enriched = sorted.map(bus => ({
                ...bus,
                calculatedFare: bus.fare || Math.round(
                    bus.isMetro
                        ? Math.min(60, 10 + Math.max(0, distanceKm) * 2)
                        : 15 + Math.max(0, distanceKm) * 2
                )
            }));

            const bestBus    = enriched[0];
            const modeStr    = bestBus.type || (bestBus.isMetro ? 'Metro' : 'Bus');
            const countLabel = enriched.length === 1 ? '1 option' : `${enriched.length} options`;

            const friendlyAnswer =
                `Found <strong>${countLabel}</strong> from <strong>${origin}</strong> → <strong>${destination}</strong>! ` +
                `Top pick: ${modeStr} <strong>${bestBus.busNumber}</strong> ` +
                `(fare ~<strong>₹${bestBus.calculatedFare}</strong>). ` +
                `I've loaded all results on the map — want me to start live tracking?`;

            return res.json({
                answer:             friendlyAnswer,
                shouldTrack:        true,
                suggestedBusNumber: bestBus.busNumber,
                from:               origin,
                to:                 destination,
                routes:             enriched,
                originCoords,
                destCoords,
                distanceKm:         parseFloat(distanceKm.toFixed(2))
            });
        }

        // No routes found
        return res.json({
            answer: `I searched the live GTFS database but couldn't find a direct route from <strong>${origin}</strong> to <strong>${destination}</strong>. Try nearby landmark names or use the main search panel.`,
            shouldTrack: false
        });

    } catch (error) {
        console.error('[AI Chat] Error:', error);
        return res.status(500).json({ error: 'Server error while searching routes.' });
    }
});


// ================= GOD MODE TELEMETRY =================

// Broadcast a JSON event to all connected admin SSE clients
function broadcastAdminEvent(type, payload) {
    const data = JSON.stringify({ type, payload, ts: Date.now() });
    for (const res of adminSseClients) {
        try { res.write(`data: ${data}\n\n`); } catch (_) { adminSseClients.delete(res); }
    }
}

// Endpoint: System Health Check
app.get('/api/admin/health', async (req, res) => {
    const mongoState = mongoose.connection.readyState;
    const mongoStatus = mongoState === 1 ? 'Connected' : mongoState === 2 ? 'Connecting' : 'Disconnected';

    // Check OpenRouter key (primary AI engine)
    const xaiReady = !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.startsWith('sk-or-v1-'));
    // Local NLP always available as fallback
    const nlpReady = true;

    let routeCount = 0, stopCount = 0;
    try {
        [routeCount, stopCount] = await Promise.all([Route.countDocuments(), Stop.countDocuments()]);
    } catch (_) {}

    res.json({
        mongo:    { status: mongoStatus, state: mongoState },
        openai:   { status: xaiReady ? 'Online' : 'Not Configured' },   // kept for backward compat
        xai:      { status: xaiReady ? 'Online' : 'Offline', key: xaiReady },
        nlp:      { status: 'Online' },                                  // local NLP always ready
        osrm:     { status: 'Online' },                                  // OSRM is free & stateless
        database: { routes: routeCount, stops: stopCount },
        uptime:   Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});


// Endpoint: Eco-Impact counter
app.get('/api/admin/eco-impact', (req, res) => {
    res.json({ co2SavedKg: parseFloat(ecoImpactKg.toFixed(2)), unit: 'kg' });
});

// Endpoint: Live Query SSE stream
app.get('/api/admin/query-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'connected', payload: { message: 'God Mode stream active' }, ts: Date.now() })}\n\n`);
    adminSseClients.add(res);
    req.on('close', () => adminSseClients.delete(res));
});

// Endpoint: Admin stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const [routes, stops, buses] = await Promise.all([
            Route.countDocuments(),
            Stop.countDocuments(),
            mongoose.connection.db.collection('buses').countDocuments()
        ]);
        res.json({ routes, stops, buses, activeStreams: adminSseClients.size });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint: All stop coordinates for the live heatmap
app.get('/api/admin/stops-geo', async (req, res) => {
    try {
        const stops = await Stop.find({ 'location.coordinates': { $exists: true } })
            .select('stop_id stop_name location')
            .limit(1500)
            .lean();
        const points = stops
            .filter(s => Array.isArray(s?.location?.coordinates) && s.location.coordinates.length === 2)
            .map(s => ({
                id: s.stop_id,
                name: s.stop_name,
                lat: s.location.coordinates[1],
                lon: s.location.coordinates[0]
            }));
        res.json(points);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= SENTINEL SOS — REAL-TIME READ RECEIPTS (SOCKET.IO) =================
const http = require('http');
const { Server: SocketServer } = require('socket.io');

const server = http.createServer(app);
const io = new SocketServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Track active SOS sessions for debugging
let activeSosSessions = 0;

io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // User joins their unique SOS room when the Shield arms
    socket.on('join_sos', (sessionId) => {
        if (!sessionId) return;
        socket.join(sessionId);
        activeSosSessions++;
        console.log(`[SOS Room] Client ${socket.id} joined room "${sessionId}" (${activeSosSessions} active sessions)`);
    });

    // ── REAL-TIME LOCATION BROADCAST ──
    // The sender continuously emits their updated GPS coords.
    // We relay to everyone else in the same SOS room (the viewers).
    socket.on('update_location', (data) => {
        if (!data || !data.sessionId) return;
        socket.to(data.sessionId).emit('location_updated', {
            lat: data.lat,
            lon: data.lon,
            accuracy: data.accuracy || null,
            timestamp: data.timestamp || Date.now()
        });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        activeSosSessions = Math.max(0, activeSosSessions - 1);
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
});

/**
 * SOS Link Bouncer — "Read Receipt" redirect endpoint.
 *
 * When someone opens the SOS WhatsApp link, it hits THIS endpoint first.
 * We emit a real-time 'sos_viewed' event to the sender's room with viewer
 * metadata, then immediately 302-redirect to the real Google Maps link.
 * The sender gets an instant notification that someone is viewing their location.
 */
app.get('/api/sos/view', (req, res) => {
    const { id, lat, lon } = req.query;

    if (!id || !lat || !lon) {
        return res.status(400).send('Missing SOS parameters.');
    }

    // Build viewer metadata
    const viewerInfo = {
        timestamp: Date.now(),
        timeStr: new Date().toLocaleTimeString('en-IN', { hour12: true }),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown',
        userAgent: req.headers['user-agent'] || 'Unknown',
        referer: req.headers['referer'] || 'Direct link'
    };

    console.log(`[SOS Bouncer] 👁️ Link viewed for session "${id}" — IP: ${viewerInfo.ip}`);

    // Emit the real-time "read receipt" to the sender's SOS room
    io.to(id).emit('sos_viewed', viewerInfo);

    // Redirect the viewer back to the frontend map view with SOS coordinates
    res.redirect(302, `/?sos=true&id=${encodeURIComponent(id)}&lat=${req.query.lat}&lon=${req.query.lon}#results-view`);
});

// Start the Server (now using http.createServer wrapper for Socket.io)
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Transit Backend running on http://localhost:${PORT}`);
    console.log(`🔒 God Mode Admin: http://localhost:${PORT}/admin`);
    console.log(`🛡️ Sentinel SOS Bouncer: http://localhost:${PORT}/api/sos/view`);
    console.log(`📡 Socket.io: Real-time SOS read receipts ACTIVE`);
});