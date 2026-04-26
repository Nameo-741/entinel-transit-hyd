const mongoose = require("mongoose");

const busSchema = new mongoose.Schema({
    busNumber: String,
    type: String, // Express, Ordinary
    from: String,
    to: String,
    departureTime: String,
    duration: String,
    fare: Number
});

module.exports = mongoose.model("Bus", busSchema);