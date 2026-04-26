/**
 * ingest_local.js
 * ─────────────────────────────────────────────────────────
 * Reads the two local CSV files:
 *   data/stops_id.csv    → stop_id, stop_name, lat, lng
 *   data/route_ids.csv   → route, route_id, origin_destination
 *
 * Then populates MongoDB with:
 *   • stops      (with GeoJSON location for map lookups)
 *   • routes     (with short & long names so bus cards show correct data)
 *   • trips      (one per route direction so the search engine works)
 *   • stoptimes  (links stops to trips so route search finds connections)
 *
 * Usage:  node ingest_local.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// ── MongoDB schemas (must match server.js exactly) ────────────────────────────
const RouteSchema = new mongoose.Schema({
    route_id:         { type: String, index: true },
    route_short_name: String,
    route_long_name:  String,
    route_type:       Number,   // 3 = bus, 1 = metro
    agency:           String
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
        coordinates: { type: [Number], required: true }  // [lon, lat]
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

// ── CSV reader (no external dependency needed) ────────────────────────────────
async function readCSV(filePath) {
    const rows = [];
    const rl = readline.createInterface({
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

// ── Batch insert helper ───────────────────────────────────────────────────────
async function insertBatched(Model, docs, batchSize = 2000) {
    for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        await Model.insertMany(batch, { ordered: false }).catch(() => {});
        process.stdout.write(`\r  → ${Math.min(i + batchSize, docs.length)} / ${docs.length}`);
    }
    console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    const dbURI = process.env.MONGO_URI || process.env.DB_URL;
    if (!dbURI) { console.error('❌ No MONGO_URI in .env'); process.exit(1); }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(dbURI, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 });
    console.log('✅ Connected!\n');

    // ── Wipe existing GTFS collections ───────────────────────────────────────
    console.log('🗑️  Clearing old data...');
    await Promise.all([
        Route.deleteMany({}),
        Trip.deleteMany({}),
        Stop.deleteMany({}),
        StopTime.deleteMany({})
    ]);
    console.log('   Done.\n');

    // ── Create geo index ─────────────────────────────────────────────────────
    await Stop.collection.createIndex({ location: '2dsphere' }).catch(() => {});

    // ════════════════════════════════════════════════════════════════════════
    // 1. STOPS  –  stops_id.csv  (stop_id, stop_name, lat, lng)
    // ════════════════════════════════════════════════════════════════════════
    console.log('📍 Loading stops from stops_id.csv ...');
    const stopsCSV = await readCSV(path.join(__dirname, 'data', 'stops_id.csv'));

    const stopDocs = [];
    const stopNameToId = new Map(); // used later when building stop-times

    for (const row of stopsCSV) {
        const lat = parseFloat(row.lat);
        const lon = parseFloat(row.lng || row.lon || row.long);
        if (!row.stop_id || isNaN(lat) || isNaN(lon)) continue;

        stopDocs.push({
            stop_id:      String(row.stop_id).trim(),
            stop_name:    String(row.stop_name || '').trim(),
            agency:       'TGSRTC',
            transit_type: 'bus',
            location: { type: 'Point', coordinates: [lon, lat] }
        });

        // map lowercase name → stop_id for fast lookup
        const key = String(row.stop_name || '').trim().toLowerCase();
        if (!stopNameToId.has(key)) stopNameToId.set(key, String(row.stop_id).trim());
    }

    await insertBatched(Stop, stopDocs);
    console.log(`✅ ${stopDocs.length} stops loaded\n`);

    // ════════════════════════════════════════════════════════════════════════
    // 2. ROUTES + TRIPS + STOP-TIMES  –  route_ids.csv
    //    Columns: route, route_id, origin_destination
    //    e.g.  127K, 1, KOTI TO KONDAPUR
    // ════════════════════════════════════════════════════════════════════════
    console.log('🚌 Loading routes from route_ids.csv ...');
    const routesCSV = await readCSV(path.join(__dirname, 'data', 'route_ids.csv'));

    const routeDocs    = [];
    const tripDocs     = [];
    const stopTimeDocs = [];

    // helper: resolve a stop name to its stop_id (fuzzy-ish: tries exact then partial)
    function resolveStopId(name) {
        const key = name.trim().toLowerCase();
        if (stopNameToId.has(key)) return stopNameToId.get(key);
        // partial match — find first entry whose name contains the search key
        for (const [k, id] of stopNameToId) {
            if (k.includes(key) || key.includes(k)) return id;
        }
        return null; // not found
    }

    // helper: parse "ORIGIN TO DESTINATION" → { origin, destination }
    function parseOD(od) {
        const upper = String(od || '').toUpperCase();
        const idx   = upper.indexOf(' TO ');
        if (idx === -1) return { origin: od.trim(), destination: '' };
        return {
            origin:      od.substring(0, idx).trim(),
            destination: od.substring(idx + 4).trim()
        };
    }

    for (const row of routesCSV) {
        const routeShort = String(row.route     || '').trim();   // e.g. "127K"
        const routeIdStr = String(row.route_id  || '').trim();   // e.g. "1"
        const od         = String(row.origin_destination || '').trim();

        if (!routeShort || !routeIdStr) continue;

        const { origin, destination } = parseOD(od);
        const longName = od || `${routeShort} Route`;

        // Route document
        routeDocs.push({
            route_id:         routeIdStr,
            route_short_name: routeShort,
            route_long_name:  longName,
            route_type:       3,      // 3 = bus
            agency:           'TGSRTC'
        });

        // Trip document  (one trip per route row in the CSV)
        const tripId = `TGSRTC_T_${routeIdStr}`;
        tripDocs.push({
            route_id:      routeIdStr,
            trip_id:       tripId,
            trip_headsign: destination || routeShort
        });

        // Stop-time documents — link origin → destination stops to this trip
        const originStopId = resolveStopId(origin);
        const destStopId   = resolveStopId(destination);

        if (originStopId) {
            stopTimeDocs.push({
                trip_id:       tripId,
                stop_id:       originStopId,
                arrival_time:  '06:00',   // generic first-departure placeholder
                stop_sequence: 1
            });
        }
        if (destStopId) {
            stopTimeDocs.push({
                trip_id:       tripId,
                stop_id:       destStopId,
                arrival_time:  '06:30',   // generic arrival placeholder
                stop_sequence: 2
            });
        }
    }

    console.log(`  ${routeDocs.length} routes / ${tripDocs.length} trips / ${stopTimeDocs.length} stop-times queued`);

    console.log('\n📤 Inserting Routes...');
    await insertBatched(Route, routeDocs);
    console.log(`✅ ${routeDocs.length} routes loaded`);

    console.log('\n📤 Inserting Trips...');
    await insertBatched(Trip, tripDocs);
    console.log(`✅ ${tripDocs.length} trips loaded`);

    console.log('\n📤 Inserting StopTimes...');
    await insertBatched(StopTime, stopTimeDocs);
    console.log(`✅ ${stopTimeDocs.length} stop-times loaded`);

    // ── Final summary ─────────────────────────────────────────────────────────
    const [sc, rc, tc, stc] = await Promise.all([
        Stop.countDocuments(),
        Route.countDocuments(),
        Trip.countDocuments(),
        StopTime.countDocuments()
    ]);

    console.log('\n═══════════════════════════════════════');
    console.log('✅  INGEST COMPLETE!');
    console.log(`   Stops:       ${sc}`);
    console.log(`   Routes:      ${rc}`);
    console.log(`   Trips:       ${tc}`);
    console.log(`   Stop Times:  ${stc}`);
    console.log('═══════════════════════════════════════\n');
    console.log('🚀 Restart your server and search for any route!\n');

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Ingest failed:', err.message);
    process.exit(1);
});
