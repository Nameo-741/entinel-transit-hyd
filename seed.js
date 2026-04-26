require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// ================= 1. DEFINE HOW THE DATA LOOKS =================
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
        await Stop.deleteMany();
        await Route.deleteMany();
        console.log('🧹 Cleared old broken data from database...');

        const stops = [];
        const routes = [];

        // Read Stops CSV
        console.log('⏳ Reading stops_id.csv...');
        await new Promise((resolve, reject) => {
            fs.createReadStream(path.join(__dirname, 'data', 'stops_id.csv'))
                .pipe(csv())
                .on('data', (row) => {
                    const lat = parseFloat(row.lat);
                    const lon = parseFloat(row.long); 

                    if (!isNaN(lat) && !isNaN(lon)) {
                        stops.push({
                            stop_id: row.stop_id,
                            stop_name: row.stop_name,
                            lat: lat,
                            lon: lon
                        });
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Read Routes CSV
        console.log('⏳ Reading route_ids.csv...');
        await new Promise((resolve, reject) => {
            fs.createReadStream(path.join(__dirname, 'data', 'route_ids.csv'))
                .pipe(csv()) // FIX: We let the parser read his actual headers
                .on('data', (row) => {
                    // FIX: We map to his actual column names: 'route' and 'origin_destination'
                    if (row.route && row.origin_destination) {
                        routes.push({
                            route_id: row.route, // Gives us the bus number (e.g., "10H")
                            route_name: row.origin_destination // Gives us the text (e.g., "SECUNDERABAD TO KONDAPUR")
                        });
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`🚀 Uploading ${stops.length} valid stops and ${routes.length} routes to MongoDB...`);
        
        await Stop.insertMany(stops);
        await Route.insertMany(routes);

        console.log('🎉 SUCCESS! All 2016 transit data is perfectly formatted and live!');
        process.exit();

    } catch (error) {
        console.error('❌ Error importing data:', error);
        process.exit(1);
    }
}

importData();