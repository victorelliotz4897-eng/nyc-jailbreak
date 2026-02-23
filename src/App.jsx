import { useState } from "react";
import "./index.css";

// ─── Constants ───────────────────────────────────────────────────────────────

// ArcGIS Snow Vehicle Activity — single spatial query returns street + plow timestamp
const ARCGIS_SNOW_ENDPOINT =
  "https://services.arcgis.com/vls6WvPaHNJ83Spx/ArcGIS/rest/services/Snow_Vehicle_Activity/FeatureServer/0/query";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

const PARTYPLACE_CLEARED_URL = "https://www.partyplace.com/?ref=nyc-jailbreak-cleared";
const PARTYPLACE_SNOWED_URL  = "https://www.partyplace.com/?ref=nyc-jailbreak-snowed";

const TWO_HOURS_MS        = 2 * 60 * 60 * 1000;
const SIX_HOURS_MS        = 6 * 60 * 60 * 1000;
// ArcGIS stores timestamps in Eastern Time but labels them as UTC.
// Add 4 hours to shift ET → UTC before comparing against Date.now().
const ARCGIS_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

// ─── Async helpers ───────────────────────────────────────────────────────────

/**
 * Geocode a plain-text address to {lat, lon} using Nominatim (OpenStreetMap).
 * Appends ", New York City" if no borough info detected, to bias results toward NYC.
 */
async function geocodeAddress(address) {
  const query = /new york|nyc|brooklyn|queens|bronx|manhattan|staten island/i.test(address)
    ? address
    : `${address}, New York City`;

  const params = new URLSearchParams({
    q:              query,
    format:         "json",
    addressdetails: "1",
    limit:          "1",
  });

  const res = await fetch(`${NOMINATIM_ENDPOINT}?${params}`, {
    headers: { "Accept-Language": "en" },
  });

  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);

  const data = await res.json();
  if (!data.length) {
    throw new Error("Address not found. Try adding a borough (e.g., Brooklyn, Queens).");
  }

  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

/**
 * Query the ArcGIS Snow Vehicle Activity layer for the nearest plow record.
 * Returns the raw ArcGIS JSON response ({ features: [...] }).
 */
const fetchPlowStatus = async (lat, lng) => {
  const geometry = JSON.stringify({
    x: lng,
    y: lat,
    spatialReference: { wkid: 4326 }
  });

  const params = new URLSearchParams({
    f:              'json',
    geometry:       geometry,
    geometryType:   'esriGeometryPoint',
    spatialRel:     'esriSpatialRelIntersects',
    outFields:      'last_visited,street_name,status',
    inSR:           '4326',
    outSR:          '4326',
    distance:       '150', // Look within 150 meters (covers geocoder pin-on-roof offset)
    units:          'esriSRUnit_Meter',
    returnGeometry: 'false'
  });

  const response = await fetch(`${ARCGIS_SNOW_ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`Server Error: ${response.status}`);
  return await response.json();
};

/** Fetches plow status and tags the result with _source for evaluateStatus. */
async function querySnowActivity(lat, lon) {
  const data = await fetchPlowStatus(lat, lon);
  if (!data.features || !data.features.length) {
    // No ArcGIS features within radius → nothing nearby at all
    return { _source: "no_features", street_name: "your street", last_visited: null, status: null };
  }
  // Features found — block may still be pending within those features
  return { ...data.features[0].attributes, _source: "features" };
}

// ─── Jailbreak evaluation ─────────────────────────────────────────────────────

/**
 * Determine jailbreak status from raw ArcGIS attributes.
 *
 * Status codes (from the official PlowNYC map):
 *   1 / "Recently Serviced"     → cleared     ("FREEDOM. Plowed in the last hour.")
 *   2 / "Serviced 1-6 hours ago"→ borderline  ("CLEAR. Plowed recently.")
 *   3                           → crunchy     ("CRUNCHY. Plowed over 6 hours ago.")
 *   0 / null                    → fall back to last_visited timestamp age
 *   "Pending" (with features)   → neighborhood ("Put the kettle on.")
 *   no features at all          → snowed_in
 *
 * Returns { status: "cleared"|"borderline"|"crunchy"|"neighborhood"|"snowed_in",
 *           lastVisited: Date|null, streetName: string }
 */
function evaluateStatus(attributes) {
  const streetName     = attributes.street_name || attributes.STREET_NAME || "your street";
  const statusRaw      = attributes.status ?? attributes.STATUS;
  const statusNum      = Number(statusRaw);                                  // NaN if string
  const statusStr      = typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";
  const lastVisitedRaw = attributes.last_visited ?? attributes.LAST_VISITED;

  // Shift ArcGIS ET-stored-as-UTC timestamps to true UTC before age comparison
  const parseTs = (raw) => (raw != null ? new Date(Number(raw) + ARCGIS_UTC_OFFSET_MS) : null);

  // ── No features within radius → definitively nothing nearby ──────────────
  if (attributes._source === "no_features") {
    return { status: "snowed_in", lastVisited: null, streetName };
  }

  // ── Features found but block explicitly pending → plow is close ──────────
  if (statusStr === "pending") {
    return { status: "neighborhood", lastVisited: null, streetName };
  }

  // ── Status 1 / "Recently Serviced" → FREEDOM ─────────────────────────────
  if (statusNum === 1 || statusStr.includes("recently serviced")) {
    return { status: "cleared", lastVisited: parseTs(lastVisitedRaw), streetName };
  }

  // ── Status 2 / "Serviced 1-6 hours ago" → CLEAR ──────────────────────────
  if (statusNum === 2 || statusStr.includes("serviced 1")) {
    return { status: "borderline", lastVisited: parseTs(lastVisitedRaw), streetName };
  }

  // ── Status 3 → CRUNCHY ───────────────────────────────────────────────────
  if (statusNum === 3) {
    return { status: "crunchy", lastVisited: parseTs(lastVisitedRaw), streetName };
  }

  // ── Status 0 / null / unknown → fall back to timestamp age ───────────────
  if (!lastVisitedRaw) {
    return { status: "snowed_in", lastVisited: null, streetName };
  }
  const lastVisited = parseTs(lastVisitedRaw);
  const ageMs = Date.now() - lastVisited.getTime();
  if (ageMs <= TWO_HOURS_MS) return { status: "cleared",    lastVisited, streetName };
  if (ageMs <= SIX_HOURS_MS) return { status: "borderline", lastVisited, streetName };
  return                            { status: "crunchy",     lastVisited, streetName };
}

function formatTime(date) {
  if (!date) return "unknown time";
  return date.toLocaleTimeString("en-US", {
    hour:         "2-digit",
    minute:       "2-digit",
    hour12:       true,
    timeZoneName: "short",
  });
}

// ─── UI components ────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="text-center pt-8 pb-4 px-4">
      <div className="bg-yellow-400 text-black font-mono font-black text-xs sm:text-sm py-1 px-4 mb-4 tracking-widest uppercase">
        ⚠ &nbsp; Emergency Broadcast System &nbsp;—&nbsp; NYC Snow Operations &nbsp; ⚠
      </div>

      <h1 className="font-mono font-black text-5xl sm:text-6xl md:text-7xl tracking-tighter text-white uppercase leading-none">
        THE NYC
      </h1>
      <h1 className="font-mono font-black text-5xl sm:text-6xl md:text-7xl tracking-tighter text-yellow-400 uppercase leading-none">
        JAILBREAK
      </h1>

      <p className="mt-3 text-gray-500 font-mono text-xs tracking-widest uppercase">
        Powered by&nbsp;
        <span className="text-yellow-400">NYC Snow Vehicle Activity</span>
        &nbsp;•&nbsp; ArcGIS FeatureServer
      </p>
    </header>
  );
}

function AddressForm({ onSubmit, loading }) {
  const [address, setAddress] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (address.trim()) onSubmit(address.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto mt-6 px-4">
      <label
        htmlFor="address"
        className="block font-mono text-xs tracking-widest uppercase text-gray-500 mb-2"
      >
        Enter your NYC address
      </label>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 123 Main St, Brooklyn"
          disabled={loading}
          className="flex-1 bg-black border-2 border-gray-700 focus:border-yellow-400 outline-none
                     text-white font-mono text-sm px-4 py-3 placeholder-gray-700
                     transition-colors duration-200 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="bg-yellow-400 hover:bg-yellow-300 disabled:bg-gray-800 disabled:text-gray-600
                     text-black font-mono font-black text-sm tracking-widest uppercase
                     px-8 py-3 transition-colors duration-200 whitespace-nowrap cursor-pointer
                     disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="blink">▐</span> Scanning...
            </span>
          ) : (
            "Check My Block"
          )}
        </button>
      </div>

      <p className="mt-2 text-gray-700 font-mono text-xs">
        Tip: Include your borough for best results — Brooklyn, Queens, Bronx, Manhattan, Staten Island
      </p>
    </form>
  );
}

function AlertCard({ result }) {
  const { status, lastVisited, streetName } = result;

  const isCleared      = status === "cleared";
  const isBorderline   = status === "borderline";
  const isCrunchy      = status === "crunchy";
  const isNeighborhood = status === "neighborhood";
  const isSnowedIn     = status === "snowed_in";

  const borderClass = isCleared      ? "alert-green border-green-600"
                    : isBorderline   ? "border-yellow-500"
                    : isCrunchy      ? "border-orange-600"
                    : isNeighborhood ? "border-blue-600"
                    : "alert-red border-red-700";
  const headerBg    = isCleared      ? "bg-green-700"
                    : isBorderline   ? "bg-yellow-500"
                    : isCrunchy      ? "bg-orange-700"
                    : isNeighborhood ? "bg-blue-800"
                    : "bg-red-800";
  const headerText  = isBorderline ? "text-black" : "text-white";

  const headline = isCleared      ? "⬛ STATUS: FREEDOM"
                 : isBorderline   ? "▲  STATUS: CLEAR"
                 : isCrunchy      ? "~ STATUS: CRUNCHY"
                 : isNeighborhood ? "◐ STATUS: ALMOST..."
                 : "⬛ STATUS: STAY IN BED";

  const badge = isCleared      ? { cls: "bg-green-500 text-white",    label: "● FREEDOM"   }
              : isBorderline   ? { cls: "bg-yellow-300 text-black",   label: "✓ CLEAR"     }
              : isCrunchy      ? { cls: "bg-orange-500 text-white",   label: "~ CRUNCHY"   }
              : isNeighborhood ? { cls: "bg-blue-500 text-white",     label: "◐ NEARBY"    }
              :                  { cls: "bg-red-600 text-white",      label: "✖ UNPLOWED"  };

  return (
    <div className={`w-full max-w-2xl mx-auto mt-8 px-4 border-2 bg-black font-mono ${borderClass}`}>
      <div className={`${headerBg} ${headerText} px-4 py-2 flex items-center justify-between flex-wrap gap-2`}>
        <span className="font-black text-sm tracking-widest uppercase flex items-center gap-2">
          <span className="blink">▌</span>
          {headline}
        </span>
        <span className={`font-black text-xs tracking-widest uppercase px-3 py-1 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      <div className="p-5">
        <p className="text-gray-600 text-xs tracking-widest uppercase mb-1">Street Segment</p>
        <p className="text-white text-xl font-black uppercase tracking-tight mb-4">
          {streetName}
        </p>

        {isCleared && (
          <div className="border-l-4 border-green-500 pl-4">
            <p className="text-green-400 text-2xl sm:text-3xl font-black leading-tight">
              FREEDOM.
            </p>
            <p className="text-gray-300 mt-1 text-sm">
              Plowed in the last hour.
              {lastVisited && <> Last visited at <span className="text-green-400 font-black">{formatTime(lastVisited)}</span>.</>}
            </p>
          </div>
        )}

        {isBorderline && (
          <div className="border-l-4 border-yellow-500 pl-4">
            <p className="text-yellow-400 text-2xl sm:text-3xl font-black leading-tight">
              CLEAR.
            </p>
            <p className="text-gray-300 mt-1 text-sm">
              Plowed recently.
              {lastVisited && <> Last visited at <span className="text-yellow-400 font-black">{formatTime(lastVisited)}</span>.</>}
            </p>
          </div>
        )}

        {isCrunchy && (
          <div className="border-l-4 border-orange-500 pl-4">
            <p className="text-orange-400 text-2xl sm:text-3xl font-black leading-tight">
              CRUNCHY.
            </p>
            <p className="text-gray-300 mt-1 text-sm">
              Plowed over 6 hours ago.
              {lastVisited && <> Last visited at <span className="text-orange-400 font-black">{formatTime(lastVisited)}</span>.</>}
            </p>
          </div>
        )}

        {isNeighborhood && (
          <div className="border-l-4 border-blue-500 pl-4">
            <p className="text-blue-400 text-2xl sm:text-3xl font-black leading-tight">
              PUT THE KETTLE ON.
            </p>
            <p className="text-gray-300 mt-1 text-sm">
              The plow is in your neighborhood but hasn't hit your block.
            </p>
          </div>
        )}

        {isSnowedIn && (
          <div className="border-l-4 border-red-600 pl-4">
            <p className="text-red-400 text-2xl sm:text-3xl font-black leading-tight">
              STAY IN BED.
            </p>
            <p className="text-gray-300 mt-1 text-sm">
              {lastVisited
                ? `Last plowed at ${formatTime(lastVisited)}. That's too long ago — you are officially snowed in.`
                : "No recent plow activity on record. You are officially snowed in."}
            </p>
          </div>
        )}

        <p className="mt-5 text-gray-700 text-xs">
          Source: NYC Snow Vehicle Activity (ArcGIS) · OpenStreetMap Nominatim
        </p>
      </div>
    </div>
  );
}

function PartyPlaceCard({ result }) {
  const cleared = result.status === "cleared" || result.status === "borderline";

  return (
    <div className="w-full max-w-2xl mx-auto mt-5 mb-10 px-4 border-2 border-gray-800 bg-black font-mono">
      <div className="bg-gray-900 border-b-2 border-gray-800 px-4 py-2 flex items-center gap-3">
        <span className="text-yellow-400 font-black text-sm tracking-widest uppercase">
          ◈ WHAT NOW?
        </span>
        <span className="text-gray-600 text-xs tracking-widest uppercase">
          — Powered by PartyPlace
        </span>
      </div>

      <div className="p-5">
        {cleared ? (
          <>
            <p className="text-gray-500 text-xs tracking-widest uppercase mb-3">
              Roads are passable. Time to celebrate.
            </p>
            <p className="text-white text-base sm:text-lg leading-relaxed mb-5">
              The plows did their job —{" "}
              <span className="text-yellow-400 font-black">now you do yours.</span>
              <br />
              Book a table by a fireplace and thaw out in style.
            </p>
            <a
              href={PARTYPLACE_CLEARED_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-yellow-400 hover:bg-yellow-300 text-black
                         font-black text-sm tracking-widest uppercase px-6 py-3
                         transition-colors duration-200"
            >
              Book a Fireplace Table on PartyPlace →
            </a>
          </>
        ) : (
          <>
            <p className="text-gray-500 text-xs tracking-widest uppercase mb-3">
              You're trapped. Make the most of it.
            </p>
            <p className="text-white text-base sm:text-lg leading-relaxed mb-5">
              Trapped?{" "}
              <span className="text-yellow-400 font-black">Start a group chat</span> and
              pick your{" "}
              <span className="text-yellow-400 font-black">
                "I Survived the Blizzard"
              </span>{" "}
              venue for this weekend on PartyPlace.
            </p>
            <a
              href={PARTYPLACE_SNOWED_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-gray-700 hover:bg-gray-600 text-white
                         font-black text-sm tracking-widest uppercase px-6 py-3
                         transition-colors duration-200"
            >
              Plan Your Survival Venue on PartyPlace →
            </a>
          </>
        )}

        <div className="mt-5 pt-4 border-t border-gray-900 text-gray-700 text-xs">
          PartyPlace — NYC's best venues for every occasion, blizzard or not.
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ message, onReset }) {
  return (
    <div className="w-full max-w-2xl mx-auto mt-8 px-4 border-2 border-red-900 bg-black font-mono">
      <div className="bg-red-950 px-4 py-2">
        <span className="font-black text-sm tracking-widest uppercase text-red-400">
          ⚠ TRANSMISSION ERROR
        </span>
      </div>
      <div className="p-5">
        <p className="text-red-400 text-sm">{message}</p>
        <button
          onClick={onReset}
          className="mt-4 border border-gray-700 hover:border-yellow-400 text-gray-500
                     hover:text-yellow-400 font-mono text-xs tracking-widest uppercase
                     px-4 py-2 transition-colors duration-200 bg-transparent cursor-pointer"
        >
          ↩ Try Again
        </button>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="w-full max-w-2xl mx-auto mt-8 px-4 font-mono">
      <div className="border border-gray-900 bg-black p-4">
        <p className="text-gray-700 text-xs tracking-widest uppercase mb-3">How it works</p>
        <ol className="space-y-2 text-xs text-gray-600">
          {[
            "Enter address → geocoded via OpenStreetMap Nominatim",
            "Lat/lon sent to NYC Snow Vehicle Activity (ArcGIS FeatureServer)",
            "Nearest record within 100 m returns street name + last plow timestamp",
            "<2h = cleared · 2–6h = borderline · >6h / no record = snowed in",
          ].map((step, i) => (
            <li key={i}>
              <span className="text-gray-800 mr-2">{String(i + 1).padStart(2, "0")}.</span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);

  async function handleAddressSubmit(address) {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { lat, lon }  = await geocodeAddress(address);
      const attributes    = await querySnowActivity(lat, lon);
      const evaluation    = evaluateStatus(attributes);
      setResult(evaluation);
    } catch (err) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
  }

  return (
    <div
      className="min-h-screen bg-black text-white"
      style={{ backgroundImage: "radial-gradient(ellipse at top, #0f0f0f 0%, #000 70%)" }}
    >
      <Header />

      <main className="pb-16">
        <AddressForm onSubmit={handleAddressSubmit} loading={loading} />

        {!result && !error && <HowItWorks />}

        {error && <ErrorCard message={error} onReset={handleReset} />}

        {result && (
          <>
            <AlertCard result={result} />
            <PartyPlaceCard result={result} />
            <div className="text-center mt-2 mb-4">
              <button
                onClick={handleReset}
                className="font-mono text-xs tracking-widest uppercase text-gray-700
                           hover:text-yellow-400 transition-colors duration-200 bg-transparent
                           border-none cursor-pointer"
              >
                ↩ Check Another Address
              </button>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-gray-900 py-4 text-center font-mono text-xs text-gray-700 tracking-widest uppercase">
        NYC Jailbreak &nbsp;|&nbsp; Data: NYC Snow Vehicle Activity &amp; OpenStreetMap &nbsp;|&nbsp; Not affiliated with NYC
      </footer>
    </div>
  );
}
