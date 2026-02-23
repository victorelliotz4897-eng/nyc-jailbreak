import { useState, useEffect, useRef } from "react";
import "./index.css";

// ─── Constants ───────────────────────────────────────────────────────────────

// OpenStreetMap Nominatim — address → lat/lon
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
// PlowNYC real-time API — lat/lon → last plow timestamp
const PLOWNYC_REALTIME   = "https://plownyc.cityofnewyork.us/mappingapi/api/highlight/info";

const PARTYPLACE_CLEARED_URL = "https://www.partyplace.com/?ref=nyc-jailbreak-cleared";
const PARTYPLACE_SNOWED_URL  = "https://www.partyplace.com/?ref=nyc-jailbreak-snowed";

// YES threshold (spec): plowed within 3 h → cleared
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const SIX_HOURS_MS   = 6 * 60 * 60 * 1000;

// ─── Async helpers ───────────────────────────────────────────────────────────

async function getPlowData(address) {
  // ── Step 1: Geocode address → lat/lon via Nominatim ──────────────────────
  // Constrain to NYC bounding box so partial addresses resolve correctly.
  const geocodeUrl =
    `${NOMINATIM_ENDPOINT}` +
    `?q=${encodeURIComponent(address + ", New York City, NY")}` +
    `&format=json&limit=1&countrycodes=us` +
    `&viewbox=-74.2591,40.9176,-73.7004,40.4774&bounded=1`;

  let lat, lon;
  try {
    console.log("[getPlowData] Nominatim fetch →", geocodeUrl);
    const geoRes = await fetch(geocodeUrl, {
      headers: { "User-Agent": "nyc-jailbreak/1.0" },
    });
    if (!geoRes.ok) throw new Error(`Geocode error: HTTP ${geoRes.status}`);
    const geoRows = await geoRes.json();
    if (!geoRows.length) throw new Error("Address not found. Try including your borough — e.g. Brooklyn, Manhattan.");
    lat = geoRows[0].lat;
    lon = geoRows[0].lon;
    console.log("[getPlowData] Geocode →", lat, lon, geoRows[0].display_name);
  } catch (err) {
    console.error("[getPlowData] Nominatim failed:", err);
    throw err;
  }

  // ── Step 2: PlowNYC real-time API → last plow timestamp ──────────────────
  // VisitedTime is UTC with Z suffix — new Date() parses this correctly.
  const plowUrl =
    `${PLOWNYC_REALTIME}` +
    `?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&t=${Date.now()}`;

  let plowData;
  try {
    console.log("[getPlowData] PlowNYC fetch →", plowUrl);
    const plowRes = await fetch(plowUrl);
    if (!plowRes.ok) throw new Error(`PlowNYC error: HTTP ${plowRes.status}`);
    const text = await plowRes.text();
    // Empty body = no plow record for this segment (valid — treat as unplowed)
    plowData = text.trim() ? JSON.parse(text) : {};
    console.log("[getPlowData] PlowNYC →", plowData);
  } catch (err) {
    console.error("[getPlowData] PlowNYC failed:", err);
    throw err;
  }

  const lastVisitedRaw = plowData.VisitedTime ?? null;
  const lastVisited    = lastVisitedRaw ? new Date(lastVisitedRaw) : null;
  const isPlowed       = lastVisited
    ? (Date.now() - lastVisited.getTime()) <= THREE_HOURS_MS
    : false;

  return { streetName: plowData.Street ?? address, lastVisited, isPlowed };
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
        <span className="text-yellow-400">PlowNYC Real-Time API</span>
        &nbsp;•&nbsp; Live GPS Data
      </p>
    </header>
  );
}

const GEOSEARCH_AUTOCOMPLETE = "https://geosearch.planninglabs.nyc/v2/autocomplete";

function AddressForm({ onSubmit, loading }) {
  const [address,     setAddress]     = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showList,    setShowList]    = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const debounceRef = useRef(null);
  const wrapperRef  = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowList(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setAddress(val);
    setActiveIdx(-1);

    clearTimeout(debounceRef.current);
    if (val.trim().length < 3) { setSuggestions([]); setShowList(false); return; }

    debounceRef.current = setTimeout(async () => {
      try {
        const url = `${GEOSEARCH_AUTOCOMPLETE}?text=${encodeURIComponent(val)}&size=5`;
        const res  = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const labels = (data.features ?? []).map(f => f.properties.label);
        setSuggestions(labels);
        setShowList(labels.length > 0);
      } catch { /* silently ignore autocomplete errors */ }
    }, 200);
  }

  function selectSuggestion(label) {
    setAddress(label);
    setSuggestions([]);
    setShowList(false);
  }

  function handleKeyDown(e) {
    if (!showList || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setShowList(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setShowList(false);
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

      <div className="flex flex-col sm:flex-row gap-2" ref={wrapperRef}>
        <div className="relative flex-1">
          <input
            id="address"
            type="text"
            value={address}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowList(true)}
            placeholder="e.g. 123 Main St, Brooklyn"
            disabled={loading}
            autoComplete="off"
            className="w-full bg-black border-2 border-gray-700 focus:border-yellow-400 outline-none
                       text-white font-mono text-sm px-4 py-3 placeholder-gray-700
                       transition-colors duration-200 disabled:opacity-50"
          />
          {showList && (
            <ul className="absolute z-50 w-full bg-black border-2 border-yellow-400 border-t-0
                           font-mono text-sm text-white max-h-60 overflow-y-auto">
              {suggestions.map((label, i) => (
                <li
                  key={i}
                  onMouseDown={() => selectSuggestion(label)}
                  className={`px-4 py-2 cursor-pointer truncate
                    ${i === activeIdx ? "bg-yellow-400 text-black" : "hover:bg-gray-900"}`}
                >
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>
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
        Tip: Select a suggestion or include your borough — Brooklyn, Queens, Bronx, Manhattan, Staten Island
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
          Source: PlowNYC Real-Time API · OpenStreetMap Nominatim
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
            "Enter your NYC address → geocoded to lat/lon via OpenStreetMap Nominatim",
            "Coordinates sent to PlowNYC real-time API (same data as maps.nyc.gov/snow)",
            "VisitedTime is UTC — parsed and compared against current time",
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
        NYC Jailbreak &nbsp;|&nbsp; Data: PlowNYC Real-Time API &amp; OpenStreetMap &nbsp;|&nbsp; Not affiliated with NYC
      </footer>
    </div>
  );
}
