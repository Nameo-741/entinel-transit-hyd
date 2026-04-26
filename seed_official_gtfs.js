require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const dbURI = process.env.MONGO_URI || process.env.DB_URL;
if (!dbURI) {
    console.log("❌ ERROR: Could not find MongoDB URI");
    process.exit(1);
}

const Route = mongoose.model('Route', new mongoose.Schema({
    route_id: { type: String, index: true },
    route_short_name: String,
    route_long_name: String,
    route_type: Number
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
        coordinates: { type: [Number], required: true } // [lon, lat]
    }
}));

const StopTime = mongoose.model('StopTime', new mongoose.Schema({
    trip_id: { type: String, index: true },
    arrival_time: String,
    stop_id: { type: String, index: true },
    stop_sequence: Number
}));

async function seed() {
    await mongoose.connect(dbURI, { maxPoolSize: 10 });
    console.log("Connected to MongoDB for Seeding");

    console.log("Wiping collections...");
    await Route.deleteMany({});
    await Stop.deleteMany({});
    await Trip.deleteMany({});
    await StopTime.deleteMany({});
    console.log("Collections wiped");

    const runStream = (file, model, mapRow) => {
        return new Promise((resolve) => {
            const buffer = [];
            fs.createReadStream(file)
                .pipe(csv())
                .on('data', (row) => buffer.push(mapRow(row)))
                .on('end', async () => {
                    // process in chunks
                    const chunkSize = 5000;
                    for (let i = 0; i < buffer.length; i += chunkSize) {
                        const chunk = buffer.slice(i, i + chunkSize);
                        const validChunk = chunk.filter(x => x !== null);
                        if (validChunk.length > 0) {
                            await model.insertMany(validChunk);
                        }
                    }
                    console.log(`Finished ${file}`);
                    resolve();
                });
        });
    };

    console.log("Seeding routes...");
    await runStream(path.join(__dirname, 'gtfs_data', 'routes.txt'), Route, (row) => ({
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        route_long_name: row.route_long_name,
        route_type: Number(row.route_type)
    }));

    console.log("Seeding stops (MMTS)...");
    await runStream(path.join(__dirname, 'gtfs_data', 'stops.txt'), Stop, (row) => ({
        stop_id: row.stop_id,
        stop_name: row.stop_name || "Unknown Stop",
        location: {
            type: 'Point',
            coordinates: [parseFloat(row.stop_lon) || 0, parseFloat(row.stop_lat) || 0]
        }
    }));

    console.log("Seeding comprehensive stops (hyd_stops.csv)...");
    await runStream(path.join(__dirname, 'hyd_stops.csv'), Stop, (row) => {
        // Hyd stops format: stop_id,stop_name,zone_id,stop_lat,stop_lon,stop_desc
        if (!row.stop_lat || !row.stop_lon) return null;
        return {
            stop_id: row.stop_id,
            stop_name: row.stop_name || "Unknown Stop",
            location: {
                type: 'Point',
                coordinates: [parseFloat(row.stop_lon), parseFloat(row.stop_lat)]
            }
        };
    });

    console.log("Seeding trips...");
    await runStream(path.join(__dirname, 'gtfs_data', 'trips.txt'), Trip, (row) => ({
        route_id: row.route_id,
        trip_id: row.trip_id,
        trip_headsign: row.trip_headsign
    }));

    console.log("Seeding stop_times...");
    await runStream(path.join(__dirname, 'gtfs_data', 'stop_times.txt'), StopTime, (row) => ({
        trip_id: row.trip_id,
        arrival_time: row.arrival_time,
        stop_id: row.stop_id,
        stop_sequence: Number(row.stop_sequence)
    }));

    console.log("DB Seed Complete");
    process.exit(0);
}

seed();
