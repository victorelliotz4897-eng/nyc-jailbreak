import { useState } from "react";
import "./index.css";

// ─── Constants ───────────────────────────────────────────────────────────────

// NYC Street Centerline (CSCL) — street name → physicalid
const CSCL_ENDPOINT    = "https://data.cityofnewyork.us/resource/dpb9-ubdh.json";
// DSNY PlowNYC — physicalid → last plow timestamp
const PLOWNYC_ENDPOINT = "https://data.cityofnewyork.us/resource/rmhc-afj9.json";

const PARTYPLACE_CLEARED_URL = "https://www.partyplace.com/?ref=nyc-jailbreak-cleared";
const PARTYPLACE_SNOWED_URL  = "https://www.partyplace.com/?ref=nyc-jailbreak-snowed";

// YES threshold (spec): plowed within 3 h → cleared
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const SIX_HOURS_MS   = 6 * 60 * 60 * 1000;

// ─── Async helpers ───────────────────────────────────────────────────────────

// NYC CSCL stname_lab uses abbreviated forms — "E 9 ST", "W 57 ST", "5 AV".
// These mappings convert the long forms that users type to those abbreviations.
const STREET_ABBREVS = {
  EAST: "E", WEST: "W", NORTH: "N", SOUTH: "S",
  STREET: "ST", AVENUE: "AV", BOULEVARD: "BLVD",
  DRIVE: "DR", PLACE: "PL", ROAD: "RD", LANE: "LN",
  COURT: "CT", TERRACE: "TER", HIGHWAY: "HWY", PARKWAY: "PKY",
};

/**
 * Normalise free-text street input into the abbreviated uppercase form
 * that stname_lab in NYC CSCL actually stores.
 *
 *   "30 East 9th Street"  →  "E 9 ST"
 *   "west 57th street"    →  "W 57 ST"
 *   "Broadway"            →  "BROADWAY"
 *   "5th Avenue"          →  "5 AV"
 */
function normalizeStreetName(input) {
  return input
    .trim()
    .replace(/^\d+\s+/, "")                      // strip house number
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, "$1") // "9th" → "9"
    .trim()
    .toUpperCase()
    .replace(
      /\b(EAST|WEST|NORTH|SOUTH|STREET|AVENUE|BOULEVARD|DRIVE|PLACE|ROAD|LANE|COURT|TERRACE|HIGHWAY|PARKWAY)\b/g,
      word => STREET_ABBREVS[word],
    );
}

async function getPlowData(streetName) {
  // ── Step 1: CSCL street-name → physicalid ────────────────────────────────
  // Parse house number BEFORE normalization so we can pick the right block.
  const houseNum = parseInt(streetName.trim().match(/^(\d+)/)?.[1] ?? "0", 10);
  const normalized = normalizeStreetName(streetName);

  // Use exact $where match (NOT $q) so we get ALL segments of this street.
  // Also fetch l_low_hn/l_high_hn/r_low_hn/r_high_hn for house-number filtering.
  // encodeURIComponent on the value encodes spaces as %20; Socrata decodes them
  // before parsing SoQL, so the server sees: stname_lab='E 9 ST'  ✓
  const csclUrl =
    `${CSCL_ENDPOINT}` +
    `?$where=stname_lab='${encodeURIComponent(normalized)}'` +
    `&$select=physicalid,stname_lab,l_low_hn,l_high_hn,r_low_hn,r_high_hn` +
    `&$limit=100`;

  let csclRows;
  try {
    console.log("[getPlowData] CSCL fetch →", csclUrl);
    const csclRes = await fetch(csclUrl);
    if (!csclRes.ok) {
      const body = await csclRes.text();
      console.error("[getPlowData] CSCL error body:", body);
      throw new Error(`CSCL error: HTTP ${csclRes.status}`);
    }
    csclRows = await csclRes.json();
    console.table(csclRows);
  } catch (err) {
    console.error("[getPlowData] CSCL fetch failed. URL was:", csclUrl, err);
    throw err;
  }

  if (!csclRows.length) throw new Error("Street name not recognized.");

  // Pick the segment whose house-number range contains the queried house number.
  // Falls back to csclRows[0] if no range matches (e.g. street-only input).
  let bestRow = csclRows[0];
  if (houseNum > 0) {
    const match = csclRows.find(row => {
      const lLow  = parseInt(row.l_low_hn,  10);
      const lHigh = parseInt(row.l_high_hn, 10);
      const rLow  = parseInt(row.r_low_hn,  10);
      const rHigh = parseInt(row.r_high_hn, 10);
      return (houseNum >= lLow && houseNum <= lHigh) ||
             (houseNum >= rLow && houseNum <= rHigh);
    });
    if (match) bestRow = match;
    console.log(`[getPlowData] houseNum=${houseNum} → segment physicalid=${bestRow.physicalid} (l:${bestRow.l_low_hn}-${bestRow.l_high_hn} r:${bestRow.r_low_hn}-${bestRow.r_high_hn})`);
  }

  const physicalid = bestRow.physicalid;
  const st_label   = bestRow.stname_lab;

  // ── Step 2: PlowNYC physicalid → last plow timestamp ──────────────────────
  // Confirmed field name from dataset: 'snapshot' (not 'last_visited').
  // Ordering by snapshot DESC gives the most recent plow record for this segment.
  const plowUrl =
    `${PLOWNYC_ENDPOINT}` +
    `?physical_id=${encodeURIComponent(physicalid)}` +
    `&$order=snapshot DESC` +
    `&$limit=1`;

  let plowRows;
  try {
    console.log("[getPlowData] PlowNYC fetch →", plowUrl);
    const plowRes = await fetch(plowUrl);
    if (!plowRes.ok) {
      const body = await plowRes.text();
      console.error("[getPlowData] PlowNYC error body:", body);
      throw new Error(`PlowNYC error: HTTP ${plowRes.status}`);
    }
    plowRows = await plowRes.json();
    console.table(plowRows);
  } catch (err) {
    console.error("[getPlowData] PlowNYC fetch failed. URL was:", plowUrl, err);
    throw err;
  }

  // Confirmed field name from dataset inspection: 'snapshot'.
  const lastVisitedRaw = plowRows[0]?.snapshot ?? null;
  const lastVisited = lastVisitedRaw ? new Date(lastVisitedRaw) : null;
  const isPlowed    = lastVisited
    ? (Date.now() - lastVisited.getTime()) <= 180 * 60 * 1000
    : false;

  return { physicalid, streetName: st_label || streetName, lastVisited, isPlowed };
}

// ─── Jailbreak evaluation ─────────────────────────────────────────────────────

/**
 * Map getPlowData() output → UI status string.
 *
 *   isPlowed true  (≤180 min) → "cleared"
 *   3–6 h ago                → "borderline"
 *   > 6 h ago                → "crunchy"
 *   no record                → "snowed_in"
 *
 * Returns { status, lastVisited: Date|null, streetName }
 */
function evaluateStatus({ streetName, lastVisited, isPlowed }) {
  if (!lastVisited) return { status: "snowed_in", lastVisited: null, streetName };

  if (isPlowed) return { status: "cleared", lastVisited, streetName };

  const ageMs = Date.now() - lastVisited.getTime();
  if (ageMs <= SIX_HOURS_MS) return { status: "borderline", lastVisited, streetName };
  return                            { status: "crunchy",    lastVisited, streetName };
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
            "Enter a street name → looked up in NYC Street Centerline (CSCL) for physicalid",
            "physicalid used to query DSNY PlowNYC dataset for last plow timestamp",
            "Socrata returns ISO-8601 UTC timestamp — compared against current time",
            "<3h = cleared · 3–6h = borderline · >6h / no record = snowed in",
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
      const plowData   = await getPlowData(address);
      const evaluation = evaluateStatus(plowData);
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
