require('dotenv').config();
const mongoose = require('mongoose');

const dbURI = process.env.MONGO_URI || process.env.DB_URL || 'mongodb://localhost:27017/city_bus_tracker';

const Route = mongoose.model('Route', new mongoose.Schema({
    bus_number: String,
    route_name: String,
    arrival_time: String,
    base_fare: Number
}));

const seedData = [
    { bus_number: '10H', route_name: 'Secunderabad - Ameerpet - Kondapur', arrival_time: '12 mins', base_fare: 15 },
    { bus_number: '47L', route_name: 'Secunderabad - Ameerpet - Hitech City', arrival_time: '5 mins', base_fare: 15 },
    { bus_number: '218D', route_name: 'Patancheru - Koti', arrival_time: '18 mins', base_fare: 15 },
    { bus_number: '1Z', route_name: 'Secunderabad - Koti', arrival_time: '7 mins', base_fare: 15 },
    { bus_number: '113M', route_name: 'Uppal - Mehdipatnam', arrival_time: '15 mins', base_fare: 15 },
    { bus_number: '229', route_name: 'Secunderabad - Medchal', arrival_time: '20 mins', base_fare: 15 },
    { bus_number: '158', route_name: 'Secunderabad - Sanathnagar', arrival_time: '10 mins', base_fare: 15 },
    { bus_number: '9X', route_name: 'Secunderabad - CBS', arrival_time: '8 mins', base_fare: 15 },
    { bus_number: '18C', route_name: 'Secunderabad - Uppal', arrival_time: '14 mins', base_fare: 15 },
    { bus_number: '115', route_name: 'Koti - Uppal', arrival_time: '9 mins', base_fare: 15 },
    { bus_number: '1Z/229', route_name: 'Secunderabad - Afzalgunj - Medchal', arrival_time: '22 mins', base_fare: 15 },
    { bus_number: '2Z', route_name: 'Secunderabad - Charminar', arrival_time: '11 mins', base_fare: 15 },
    { bus_number: '65M', route_name: 'Charminar - Mehdipatnam', arrival_time: '16 mins', base_fare: 15 },
    { bus_number: '25S', route_name: 'Secunderabad - Suchitra', arrival_time: '13 mins', base_fare: 15 },
    { bus_number: '127K', route_name: 'Koti - Kondapur - Hitech City', arrival_time: '25 mins', base_fare: 15 },
    { bus_number: '10K', route_name: 'Secunderabad - Sanathnagar - Kondapur', arrival_time: '8 mins', base_fare: 15 },
    { bus_number: '147', route_name: 'Secunderabad - JNTU - Hitech City', arrival_time: '21 mins', base_fare: 15 },
    { bus_number: '19M', route_name: 'Mehdipatnam - KPHB', arrival_time: '15 mins', base_fare: 15 },
    { bus_number: '8A', route_name: 'Secunderabad - Chandrayangutta', arrival_time: '19 mins', base_fare: 15 },
    { bus_number: '218C', route_name: 'Patancheru - CBS', arrival_time: '30 mins', base_fare: 15 }
];

async function seed() {
    try {
        await mongoose.connect(dbURI);
        console.log('Connected to DB');
        
        await Route.deleteMany({});
        
        await Route.insertMany(seedData);
        console.log('Successfully seeded 20 routes!');
        
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seed();
