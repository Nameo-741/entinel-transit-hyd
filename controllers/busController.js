const Bus = require("../models/Bus");

exports.searchBuses = async (req, res) => {
    try {
        let { from, to } = req.query;

        // Normalize input
        from = from.trim().toLowerCase();
        to = to.trim().toLowerCase();

        // Fetch ALL buses and filter manually (strong + reliable)
        const allBuses = await Bus.find();

        const filtered = allBuses.filter(bus =>
            bus.from.toLowerCase() === from &&
            bus.to.toLowerCase() === to
        );

        console.log("SEARCH:", from, "→", to);
        console.log("FOUND:", filtered.length);

        res.json(filtered);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};