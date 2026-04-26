require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// ================= 1. DEFINE HOW THE DATA LOOKS =================
// These tell MongoDB exactly what shape our data is in
const stopSchema = new mongoose.Schema({
    stop_id: String,
    stop_name: String,
    lat: Number,
    lon: Number
});
const Stop = mongoose.model('Stop', stopSchema);

const routeSchema = new mongoose.Schema({
    route_id: String,
    route_name: String
});
const Route = mongoose.model('Route', routeSchema);

// ================= 2. CONNECT TO MONGODB =================
// Grab the URI from your .env file (Make sure your variable name matches! Often MONGO_URI)
const dbURI = process.env.MONGO_URI || process.env.DB_URL; 

if (!dbURI) {
    console.log("❌ ERROR: Could not find your MongoDB URI in the .env file.");
    process.exit(1);
}

mongoose.connect(dbURI)
    .then(() => console.log('✅ Connected to MongoDB Atlas!'))
    .catch(err => console.error('Connection error:', err));

// ================= 3. THE IMPORT FUNCTION =================
async function importData() {
    try {
        // Wipe the old collections so we start fresh
        await Stop.deleteMany();
        await Route.deleteMany();
        console.log('🧹 Cleared old data from database...');

        const stops = [];
        const routes = [];

        // Read Stops CSV
        console.log('⏳ Reading stops_id.csv...');
        await new Promise((resolve, reject) => {
            fs.createReadStream(path.join(__dirname, 'data', 'stops_id.csv'))
                .pipe(csv())
                .on('data', (row) => {
                    // Make sure we format the numbers correctly
                    stops.push({
                        stop_id: row.stop_id,
                        stop_name: row.stop_name,
                        lat: parseFloat(row.lat),
                        lon: parseFloat(row.long)
                    });
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Read Routes CSV
        console.log('⏳ Reading route_ids.csv...');
        await new Promise((resolve, reject) => {
            fs.createReadStream(path.join(__dirname, 'data', 'route_ids.csv'))
                .pipe(csv(['route_id', 'route_name'])) // Specifying headers if they are missing
                .on('data', (row) => {
                    routes.push({
                        route_id: row.route_id,
                        route_name: row.route_name
                    });
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Push everything to MongoDB Cloud!
        console.log(`🚀 Uploading ${stops.length} stops and ${routes.length} routes to MongoDB...`);
        
        await Stop.insertMany(stops);
        await Route.insertMany(routes);

        console.log('🎉 SUCCESS! All 2016 transit data is now live in your MongoDB Database!');
        process.exit();

    } catch (error) {
        console.error('❌ Error importing data:', error);
        process.exit(1);
    }
}

// Fire the engines
importData();