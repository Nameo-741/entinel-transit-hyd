const mongoose = require('mongoose');

const StopSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    area: String
});

module.exports = mongoose.model('Stop', StopSchema);