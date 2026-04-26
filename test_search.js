require('dotenv').config();
const mongoose = require('mongoose');

const Route    = mongoose.model('Route',    new mongoose.Schema({ route_id: String, route_short_name: String, route_long_name: String }));
const Trip     = mongoose.model('Trip',     new mongoose.Schema({ route_id: String, trip_id: String, trip_headsign: String }));
const Stop     = mongoose.model('Stop',     new mongoose.Schema({ stop_id: String, stop_name: String, location: Object }));
const StopTime = mongoose.model('StopTime', new mongoose.Schema({ trip_id: String, arrival_time: String, stop_id: String, stop_sequence: Number }));

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const from = 'koti', to = 'kondapur';

    const fromStops = await Stop.find({ stop_name: { $regex: from, $options: 'i' } }).select('stop_id').lean();
    const toStops   = await Stop.find({ stop_name: { $regex: to,   $options: 'i' } }).select('stop_id').lean();
    console.log(`From "${from}" stops: ${fromStops.length}  |  To "${to}" stops: ${toStops.length}`);

    const fromIds = fromStops.map(s => s.stop_id);
    const toIds   = toStops.map(s => s.stop_id);

    const fromTimes = await StopTime.find({ stop_id: { $in: fromIds } }).lean();
    const toTimes   = await StopTime.find({ stop_id: { $in: toIds   } }).lean();
    console.log(`StopTimes from: ${fromTimes.length}  |  StopTimes to: ${toTimes.length}`);

    const toMap = new Map();
    for (const t of toTimes) {
        if (!toMap.has(t.trip_id) || t.stop_sequence > toMap.get(t.trip_id))
            toMap.set(t.trip_id, t.stop_sequence);
    }

    const valid = fromTimes.filter(f => toMap.has(f.trip_id) && toMap.get(f.trip_id) > f.stop_sequence);
    console.log(`Valid trips (${from} → ${to}): ${valid.length}`);

    if (valid.length > 0) {
        const trip  = await Trip.findOne({ trip_id: valid[0].trip_id }).lean();
        const route = await Route.findOne({ route_id: trip.route_id }).lean();
        console.log(`\n✅ First bus result:`);
        console.log(`   Bus Number : ${route.route_short_name}`);
        console.log(`   Route Name : ${route.route_long_name}`);
        console.log(`   Towards    : ${trip.trip_headsign}`);
    } else {
        console.log('\n⚠️  No trips found for this pair.');
    }

    process.exit(0);
}).catch(e => { console.error('DB Error:', e.message); process.exit(1); });
