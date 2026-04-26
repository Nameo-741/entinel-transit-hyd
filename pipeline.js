/**
 * pipeline.js  —  Demo-Boosted GTFS Ingestion Pipeline
 * ─────────────────────────────────────────────────────
 * Reads stops_id.csv + route_ids.csv just like ingest_local.js,
 * but adds a "Demo Route Multiplier" layer on top:
 *
 *   • Any route whose origin AND destination both appear in
 *     demoRoutes[] gets cloned 4 extra times with unique suffixes,
 *     randomised fares and staggered departure times.
 *
 *   • Non-demo routes pass through the pipeline unchanged.
 *
 * Usage:  node pipeline.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// ═══════════════════════════════════════════════════
//  1.  DEMO TARGETS — Edit this to change what gets boosted
// ═══════════════════════════════════════════════════
const demoRoutes = [
    'Ameerpet',
    'Hitech City',
    'Secunderabad',
    'Gachibowli',
    'Koti',
    'Kondapur',
    'Madhapur',
    'KPHB',
    'Miyapur',
    'LB Nagar'
];

// Variant suffixes applied to cloned bus numbers
const CLONE_SUFFIXES   = ['-AC', '-Express', '-Fast', '-Limited'];
// Departure time offsets (minutes) for each clone
const CLONE_TIME_OFFSETS = [8, 15, 22, 35];

// ═══════════════════════════════════════════════════
//  SCHEMAS  (must match server.js exactly)
// ═══════════════════════════════════════════════════
const RouteSchema = new mongoose.Schema({
    route_id:         { type: String, index: true },
    route_short_name: String,
    route_long_name:  String,
    route_type:       Number,
    agency:           String,
    is_demo_clone:    Boolean   // flag so we can identify injected rows
});
const TripSchema = new mongoose.Schema({
    route_id:      { type: String, index: true },
    trip_id:       { type: String, index: true },
    trip_headsign: String
});
const StopSchema = new mongoose.Schema({
    stop_id:      { type: String, index: true },
    stop_name:    { type: String, index: true },
    agency:       String,
    transit_type: String,
    location: {
        type:        { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    }
});
const StopTimeSchema = new mongoose.Schema({
    trip_id:       { type: String, index: true },
    arrival_time:  String,
    stop_id:       { type: String, index: true },
    stop_sequence: Number
});

const Route    = mongoose.model('Route',    RouteSchema);
const Trip     = mongoose.model('Trip',     TripSchema);
const Stop     = mongoose.model('Stop',     StopSchema);
const StopTime = mongoose.model('StopTime', StopTimeSchema);

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

/** Parse CSV file into array of row-objects */
async function readCSV(filePath) {
    const rows = [];
    const rl   = readline.createInterface({
        input: fs.createReadStream(filePath, 'utf8'),
        crlfDelay: Infinity
    });
    let headers = null;
    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cols = trimmed.split(',').map(c => c.trim());
        if (!headers) { headers = cols; continue; }
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
        rows.push(obj);
    }
    return rows;
}

/** Insert array in batches (avoids hitting MongoDB's 16MB document limit) */
async function insertBatched(Model, docs, batchSize = 2000) {
    for (let i = 0; i < docs.length; i += batchSize) {
        await Model.insertMany(docs.slice(i, i + batchSize), { ordered: false }).catch(() => {});
        process.stdout.write(`\r  → ${Math.min(i + batchSize, docs.length)} / ${docs.length}`);
    }
    console.log('');
}

/** Parse "KOTI TO SECUNDERABAD" → { origin:'KOTI', destination:'SECUNDERABAD' } */
function parseOD(od) {
    const upper = String(od || '').toUpperCase();
    const idx   = upper.indexOf(' TO ');
    if (idx === -1) return { origin: od.trim(), destination: '' };
    return {
        origin:      od.substring(0, idx).trim(),
        destination: od.substring(idx + 4).trim()
    };
}

/** Format minutes-from-midnight to "HH:MM" */
function minsToTime(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * isDemoRoute — returns true when BOTH origin and destination
 * appear (case-insensitive, partial match) in the demoRoutes array.
 */
function isDemoRoute(origin, destination) {
    const match = (name) =>
        demoRoutes.some(d => name.toLowerCase().includes(d.toLowerCase()));
    return match(origin) && match(destination);
}

// ═══════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════
async function run() {
    const dbURI = process.env.MONGO_URI || process.env.DB_URL;
    if (!dbURI) { console.error('❌ No MONGO_URI in .env'); process.exit(1); }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(dbURI, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 });
    console.log('✅ Connected!\n');

    // ── Wipe and rebuild ─────────────────────────────
    console.log('🗑️  Clearing old GTFS collections...');
    await Promise.all([
        Route.deleteMany({}),
        Trip.deleteMany({}),
        Stop.deleteMany({}),
        StopTime.deleteMany({})
    ]);
    console.log('   Done.\n');

    await Stop.collection.createIndex({ location: '2dsphere' }).catch(() => {});

    // ════════════════════════════════════════════════
    //  PASS 1 — Load stops from CSV
    // ════════════════════════════════════════════════
    console.log('📍 Loading stops from stops_id.csv...');
    const stopsCSV      = await readCSV(path.join(__dirname, 'data', 'stops_id.csv'));
    const stopDocs      = [];
    const stopNameToId  = new Map();   // normalised name → stop_id

    for (const row of stopsCSV) {
        const lat = parseFloat(row.lat);
        const lon = parseFloat(row.lng || row.lon || row.long);
        if (!row.stop_id || isNaN(lat) || isNaN(lon)) continue;

        const name = String(row.stop_name || '').trim();
        stopDocs.push({
            stop_id:      String(row.stop_id).trim(),
            stop_name:    name,
            agency:       'TGSRTC',
            transit_type: 'bus',
            location:     { type: 'Point', coordinates: [lon, lat] }
        });
        const key = name.toLowerCase();
        if (!stopNameToId.has(key)) stopNameToId.set(key, String(row.stop_id).trim());
    }

    // Also resolve by first word (for fuzzy stop matching)
    const stopFirstWordMap = new Map();
    for (const [key, id] of stopNameToId) {
        const first = key.split(' ')[0];
        if (!stopFirstWordMap.has(first)) stopFirstWordMap.set(first, id);
    }

    await insertBatched(Stop, stopDocs);
    console.log(`✅ ${stopDocs.length} stops loaded\n`);

    // Helper: resolve a stop name → stop_id
    function resolveStopId(name) {
        const key = name.trim().toLowerCase();
        if (stopNameToId.has(key)) return stopNameToId.get(key);
        for (const [k, id] of stopNameToId) {
            if (k.includes(key) || key.includes(k)) return id;
        }
        // last resort — match first word
        const first = key.split(' ')[0];
        return stopFirstWordMap.get(first) || null;
    }

    // ════════════════════════════════════════════════
    //  PASS 2 — Load routes + apply DEMO MULTIPLIER
    // ════════════════════════════════════════════════
    console.log('🚌 Loading routes from route_ids.csv...');
    const routesCSV    = await readCSV(path.join(__dirname, 'data', 'route_ids.csv'));

    const routeDocs    = [];
    const tripDocs     = [];
    const stopTimeDocs = [];

    let demoOriginalCount = 0;
    let demoClonesCount   = 0;

    for (const row of routesCSV) {
        const routeShort = String(row.route     || '').trim();
        const routeIdStr = String(row.route_id  || '').trim();
        const od         = String(row.origin_destination || '').trim();

        if (!routeShort || !routeIdStr) continue;

        const { origin, destination } = parseOD(od);
        const isDemo = isDemoRoute(origin, destination);

        if (isDemo) demoOriginalCount++;

        // ── base route + trip ────────────────────────────────────────────────
        const tripId = `TGSRTC_T_${routeIdStr}`;
        routeDocs.push({
            route_id:         routeIdStr,
            route_short_name: routeShort,
            route_long_name:  od || `${routeShort} Route`,
            route_type:       3,
            agency:           'TGSRTC',
            is_demo_clone:    false
        });
        tripDocs.push({ route_id: routeIdStr, trip_id: tripId, trip_headsign: destination || routeShort });

        const originStopId = resolveStopId(origin);
        const destStopId   = resolveStopId(destination);
        if (originStopId) stopTimeDocs.push({ trip_id: tripId, stop_id: originStopId, arrival_time: '06:00', stop_sequence: 1 });
        if (destStopId)   stopTimeDocs.push({ trip_id: tripId, stop_id: destStopId,   arrival_time: '06:30', stop_sequence: 2 });

        // ════════════════════════════════════════════
        //  DEMO MULTIPLIER — Clone demo routes 4×
        // ════════════════════════════════════════════
        if (isDemo) {
            const baseFare       = 15 + Math.floor(Math.abs(origin.length - destination.length) * 1.5);
            const baseDepartureMins = 6 * 60; // 06:00

            CLONE_SUFFIXES.forEach((suffix, i) => {
                const cloneRouteId = `${routeIdStr}_DEMO_${i}`;
                const cloneTripId  = `TGSRTC_T_${routeIdStr}_DEMO_${i}`;
                const fakeArrival  = minsToTime(baseDepartureMins + CLONE_TIME_OFFSETS[i]);
                const fakeEnd      = minsToTime(baseDepartureMins + CLONE_TIME_OFFSETS[i] + 30);

                // Slightly randomise fare so each clone feels distinct
                const clonedFare   = baseFare + Math.floor(Math.random() * 10);

                routeDocs.push({
                    route_id:         cloneRouteId,
                    route_short_name: `${routeShort}${suffix}`,
                    route_long_name:  od,           // same route name → text search finds it
                    route_type:       3,
                    agency:           'TGSRTC',
                    is_demo_clone:    true,
                    base_fare:        clonedFare     // stored so frontend can pick it up
                });

                tripDocs.push({
                    route_id:      cloneRouteId,
                    trip_id:       cloneTripId,
                    trip_headsign: destination || routeShort
                });

                // Clone stop times with staggered departure
                if (originStopId) {
                    stopTimeDocs.push({
                        trip_id:       cloneTripId,
                        stop_id:       originStopId,
                        arrival_time:  fakeArrival,
                        stop_sequence: 1
                    });
                }
                if (destStopId) {
                    stopTimeDocs.push({
                        trip_id:       cloneTripId,
                        stop_id:       destStopId,
                        arrival_time:  fakeEnd,
                        stop_sequence: 2
                    });
                }

                demoClonesCount++;
            });
        }
    }

    // ════════════════════════════════════════════════
    //  PASS 3 — Inject hard-coded DEMO SHOWCASE ROUTES
    //  (routes that may not exist in the CSV but are
    //   critical for the presentation)
    // ════════════════════════════════════════════════
    console.log('\n🎯 Injecting Demo Showcase Routes...');

    const showcasePairs = [
        { from: 'AMEERPET',    to: 'HITECH CITY',    buses: ['5K', '216K', '127K', '5KE',  '216K-AC'] },
        { from: 'AMEERPET',    to: 'GACHIBOWLI',     buses: ['216G', '5G',  '216G-AC', '5G-Express', '127G'] },
        { from: 'SECUNDERABAD',to: 'HITECH CITY',    buses: ['47L',  '147', '47L-AC', '147-Express', '10H'] },
        { from: 'SECUNDERABAD',to: 'AMEERPET',       buses: ['10H',  '25H', '10H-AC', '25H-Fast',  '10H-Ltd'] },
        { from: 'HITECH CITY', to: 'SECUNDERABAD',   buses: ['47L',  '147', '47L-AC', '147-Exp',   '10H-R'] },
        { from: 'KOTI',        to: 'HITECH CITY',    buses: ['127K', '127K-AC','127K-Fast','127K-Ltd','218K'] },
        { from: 'KONDAPUR',    to: 'SECUNDERABAD',   buses: ['10K',  '10K-AC','216K-R','5K-R','147-R'] },
        { from: 'MADHAPUR',    to: 'AMEERPET',       buses: ['5M',   '5M-AC', '216M','216M-AC','127M'] },
        { from: 'MIYAPUR',     to: 'HITECH CITY',    buses: ['3K',   '3K-AC', '5K-Exp','216-M','M5K'] },
        { from: 'LB NAGAR',    to: 'SECUNDERABAD',   buses: ['18LB', '18LB-AC','25LB','25LB-Exp','9LB'] }
    ];

    const departureCycle = [360, 368, 375, 383, 395]; // minutes from midnight

    for (const pair of showcasePairs) {
        const originStop = resolveStopId(pair.from);
        const destStop   = resolveStopId(pair.to);
        const longName   = `${pair.from} TO ${pair.to}`;

        pair.buses.forEach((busNum, i) => {
            const syntheticId = `DEMO_${pair.from.replace(/\s/g,'')}_${pair.to.replace(/\s/g,'')}_${i}`;
            const depTime     = minsToTime(departureCycle[i] || 400);
            const arrTime     = minsToTime((departureCycle[i] || 400) + 25 + i * 5);
            const fare        = 15 + Math.floor(Math.random() * 15);

            routeDocs.push({
                route_id:         syntheticId,
                route_short_name: busNum,
                route_long_name:  longName,
                route_type:       3,
                agency:           'TGSRTC',
                is_demo_clone:    true,
                base_fare:        fare
            });

            tripDocs.push({ route_id: syntheticId, trip_id: `T_${syntheticId}`, trip_headsign: pair.to });

            if (originStop) stopTimeDocs.push({ trip_id: `T_${syntheticId}`, stop_id: originStop, arrival_time: depTime, stop_sequence: 1 });
            if (destStop)   stopTimeDocs.push({ trip_id: `T_${syntheticId}`, stop_id: destStop,   arrival_time: arrTime, stop_sequence: 2 });

            demoClonesCount++;
        });
    }

    // ── Persist everything ───────────────────────────────────────────────────
    console.log(`\n📤 Inserting ${routeDocs.length} routes...`);
    await insertBatched(Route, routeDocs);
    console.log(`✅ Routes done`);

    console.log(`\n📤 Inserting ${tripDocs.length} trips...`);
    await insertBatched(Trip, tripDocs);
    console.log(`✅ Trips done`);

    console.log(`\n📤 Inserting ${stopTimeDocs.length} stop-times...`);
    await insertBatched(StopTime, stopTimeDocs);
    console.log(`✅ Stop-times done`);

    // ── Final summary ─────────────────────────────────────────────────────────
    const [sc, rc, tc, stc] = await Promise.all([
        Stop.countDocuments(),
        Route.countDocuments(),
        Trip.countDocuments(),
        StopTime.countDocuments()
    ]);

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       PIPELINE COMPLETE — DEMO READY         ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Stops:              ${String(sc).padEnd(24)}║`);
    console.log(`║  Routes (total):     ${String(rc).padEnd(24)}║`);
    console.log(`║    ↳ Original CSV:   ${String(rc - demoClonesCount).padEnd(24)}║`);
    console.log(`║    ↳ Demo originals: ${String(demoOriginalCount).padEnd(24)}║`);
    console.log(`║    ↳ Clones injected:${String(demoClonesCount).padEnd(24)}║`);
    console.log(`║  Trips:              ${String(tc).padEnd(24)}║`);
    console.log(`║  Stop-Times:         ${String(stc).padEnd(24)}║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Demo Routes Boosted:                        ║');
    demoRoutes.forEach(d => console.log(`║    • ${d.padEnd(38)}║`));
    console.log('╚══════════════════════════════════════════════╝');
    console.log('\n🚀 Restart your server and search any demo route!\n');

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Pipeline failed:', err.message);
    process.exit(1);
});
