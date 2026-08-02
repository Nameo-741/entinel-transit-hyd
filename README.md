# Entinel Transit HYD

This is a Hyderabad transit project I built around one core idea: make route search feel instant and practical, while still leaving room for AI-assisted travel help and safety features.

It has:
- a Node.js + Express backend
- MongoDB-based transit data (stops, routes, trips, stop-times)
- a transit UI in `frontend/` (served directly by the backend)
- a React/Vite landing experience in `landing/`
- ingestion scripts to load local CSV or GTFS-style data

---

## What the app does

- Search buses between two stops
- Autocomplete stop names quickly
- Support "Live" vs "Later" travel view
- AI chat endpoint for transit queries (`/api/chat`)
- Fallback local NLP parser if AI key is not configured
- Route geometry helpers (OpenRouteService + OSRM)
- Trip simulation endpoint for map playback
- Admin flows for adding/updating/deleting bus entries
- SOS / Sentinel-style safety flow integration in frontend logic

---

## Tech stack

- **Backend:** Node.js, Express, Mongoose
- **Database:** MongoDB
- **Realtime:** Socket.IO
- **Frontend (served app):** HTML/CSS/JS in `frontend/`
- **Landing app:** React + Vite in `landing/`

---

## Project structure (important folders/files)

- `/server.js` → main backend server and API routes
- `/frontend` → production-facing transit UI files (`index.html`, `script.js`, `style.css`, `admin.html`)
- `/landing` → React/Vite landing app
- `/data` → local CSV input files (`stops_id.csv`, `route_ids.csv`)
- `/ingest_local.js` → loads local CSV transit data into MongoDB
- `/ingest_gtfs.js` → pulls prepared GTFS JSON from a GitHub source and ingests it
- `/pipeline.js` → demo-boosted ingestion pipeline with route clones/showcase injection

---

## Getting started

### 1) Install dependencies

From repo root:

```bash
npm install
```

For landing app:

```bash
cd landing
npm install
```

### 2) Configure environment

Create a `.env` file in the repository root and add:

```env
MONGO_URI=your_mongodb_connection_string
PORT=5000
OPENROUTER_API_KEY=optional_for_ai_chat
OPENROUTE_API_KEY=optional_for_route_geometry
```

Notes:
- `MONGO_URI` (or `DB_URL`) is required.
- If `OPENROUTER_API_KEY` is missing, `/api/chat` falls back to local NLP extraction.
- If `OPENROUTE_API_KEY` is missing, `/api/route` will not work (OSRM route endpoint is still available separately).

### 3) Load transit data

Pick one ingestion path (run from repo root):

```bash
node ingest_local.js
```

or

```bash
node ingest_gtfs.js
```

or (demo-heavy data)

```bash
node pipeline.js
```

### 4) Run backend

```bash
npm run dev
```

or

```bash
npm start
```

Backend default URL: `http://localhost:5000`

### 5) Run landing app (optional, separate terminal)

```bash
cd landing
npm run dev
```

---

## Main API endpoints

- `GET /api/stops?q=...` → stop lookup
- `GET /api/stops/suggest?q=...` → fast suggestions
- `GET /api/search?from=...&to=...` → route search
- `GET /api/trip-simulation?tripId=...` → schedule + polyline data
- `GET /api/coordinates?location=...` → stop coordinates
- `GET /api/route?...` → OpenRouteService geometry
- `GET /api/osrm-route?...` → OSRM geometry
- `POST /api/chat` → AI/local NLP travel assistant
- `GET /api/admin/buses` / `POST /api/admin/add-bus` / `PUT /api/admin/bus/:id` / `DELETE /api/admin/bus/:id`

---

## Current status

This repo includes both active production-style logic and some older/experimental scripts. The primary runtime path is `server.js` + `frontend/` with data loaded through one of the ingestion scripts above.

If you are contributing, start from that flow first.
