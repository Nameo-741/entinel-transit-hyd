/**
 * ingest_gtfs.js
 * Pulls preprocessed GTFS data from the interactive-gtfs GitHub repo
 * (stops.geojson, routes.geojson, timetable.json) and loads it into MongoDB.
 *
 * Usage:  node ingest_gtfs.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const BASE_URL = 'https://raw.githubusercontent.com/surajreddykarra/interactive-gtfs/main/app/public/data';

// ====== Schemas (match server.js) ======
const RouteSchema = new mongoose.Schema({
    route_id:         { type: String, index: true },
    route_short_name: String,
    route_long_name:  String,
    route_type:       Number,
    agency:           String
});
const TripSchema = new mongoose.Schema({
    route_id:      { type: String, index: true },
    trip_id:       { type: String, index: true },
    trip_headsign: String
});
const StopSchema = new mongoose.Schema({
    stop_id:   { type: String, index: true },
    stop_name: { type: String, index: true },
    agency:    String,
    transit_type: String,
    routes:    [String],
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

async function fetchJSON(url) {
    console.log(`Fetching ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}

// Insert in batches to avoid hitting MongoDB document limits
async function insertBatched(Model, docs, batchSize = 2000) {
    for (let i = 0; i < docs.length; i += batchSize) {
        await Model.insertMany(docs.slice(i, i + batchSize), { ordered: false }).catch(() => {});
        process.stdout.write(`\r  Inserted ${Math.min(i + batchSize, docs.length)} / ${docs.length}`);
    }
    console.log('');
}

async function run() {
    const dbURI = process.env.MONGO_URI || process.env.DB_URL;
    if (!dbURI) { console.error('No MONGO_URI in .env'); process.exit(1); }

    await mongoose.connect(dbURI, { maxPoolSize: 5 });
    console.log('✅ MongoDB connected');

    // ── Wipe existing collections ──────────────────────────────────────────
    console.log('\n🗑️  Wiping old data...');
    await Promise.all([
        Route.deleteMany({}),
        Trip.deleteMany({}),
        Stop.deleteMany({}),
        StopTime.deleteMany({})
    ]);

    // ── Create 2dsphere index for geo queries ──────────────────────────────
    await Stop.collection.createIndex({ location: '2dsphere' }).catch(() => {});

    // ════════════════════════════════════════════════════════════════════════
    // 1. STOPS from stops.geojson
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n📍 Ingesting STOPS from stops.geojson ...');
    const stopsGeoJSON = await fetchJSON(`${BASE_URL}/stops.geojson`);
    const stopDocs = stopsGeoJSON.features.map(f => ({
        stop_id:      f.properties.stop_id,
        stop_name:    f.properties.name,
        agency:       f.properties.agency,
        transit_type: f.properties.transit_type,
        routes:       f.properties.routes || [],
        location: {
            type:        'Point',
            coordinates: f.geometry.coordinates   // [lon, lat]
        }
    }));
    await insertBatched(Stop, stopDocs);
    console.log(`✅ ${stopDocs.length} stops loaded`);

    // ════════════════════════════════════════════════════════════════════════
    // 2. ROUTES from routes.geojson
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n🚌 Ingesting ROUTES from routes.geojson ...');
    const routesGeoJSON = await fetchJSON(`${BASE_URL}/routes.geojson`);
    const routeDocs = routesGeoJSON.features.map(f => {
        const p = f.properties;
        // Determine route_type from agency
        let route_type = 3; // bus by default
        if (p.agency === 'HMRL') route_type = 1;   // metro
        else if (p.agency === 'MMTS') route_type = 2; // rail

        return {
            route_id:         p.route_id,
            route_short_name: p.route_short_name || p.route_id,
            route_long_name:  p.route_long_name  || p.route_short_name || p.route_id,
            route_type,
            agency:           p.agency
        };
    });
    await insertBatched(Route, routeDocs);
    console.log(`✅ ${routeDocs.length} routes loaded`);

    // ════════════════════════════════════════════════════════════════════════
    // 3. TRIPS + STOP TIMES from timetable.json
    //    Format: { route_id: { trip_id: [ { stop_id, arrival_time, sequence } ] } }
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n🗓️  Ingesting TIMETABLE (trips + stop_times) ...');
    const timetable = await fetchJSON(`${BASE_URL}/timetable.json`);

    const tripDocs     = [];
    const stopTimeDocs = [];

    for (const [routeId, trips] of Object.entries(timetable)) {
        for (const [tripId, stops] of Object.entries(trips)) {
            if (!Array.isArray(stops) || stops.length === 0) continue;

            // Use last stop's name as headsign
            const lastStop = stops[stops.length - 1];
            tripDocs.push({
                route_id:      routeId,
                trip_id:       tripId,
                trip_headsign: lastStop.stop_name || lastStop.stop_id || ''
            });

            stops.forEach((s, idx) => {
                stopTimeDocs.push({
                    trip_id:       tripId,
                    stop_id:       s.stop_id,
                    arrival_time:  s.arrival_time || s.time || '',
                    stop_sequence: s.stop_sequence || idx
                });
            });
        }
    }

    console.log(`  Processing ${tripDocs.length} trips, ${stopTimeDocs.length} stop_times`);
    await insertBatched(Trip, tripDocs);
    console.log(`✅ ${tripDocs.length} trips loaded`);

    await insertBatched(StopTime, stopTimeDocs, 5000);
    console.log(`✅ ${stopTimeDocs.length} stop_times loaded`);

    // ── Final counts ───────────────────────────────────────────────────────
    const [sc, rc, tc, stc] = await Promise.all([
        Stop.countDocuments(),
        Route.countDocuments(),
        Trip.countDocuments(),
        StopTime.countDocuments()
    ]);
    console.log(`\n✅ Ingest complete!`);
    console.log(`   Stops:      ${sc}`);
    console.log(`   Routes:     ${rc}`);
    console.log(`   Trips:      ${tc}`);
    console.log(`   Stop Times: ${stc}`);

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Ingest failed:', err.message);
    process.exit(1);
});
