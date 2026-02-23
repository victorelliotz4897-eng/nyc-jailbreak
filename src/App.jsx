import { useState, useEffect, useRef } from "react";
import "./index.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const NOMINATIM_ENDPOINT     = "https://nominatim.openstreetmap.org/search";
const PLOWNYC_REALTIME       = "https://plownyc.cityofnewyork.us/mappingapi/api/highlight/info";
const GEOSEARCH_AUTOCOMPLETE = "https://geosearch.planninglabs.nyc/v2/autocomplete";
const PARTYPLACE_URL         = "https://www.partyplace.com/?ref=nyc-jailbreak";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const SIX_HOURS_MS   = 6 * 60 * 60 * 1000;

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function getPlowData(address) {
  const geocodeUrl =
    `${NOMINATIM_ENDPOINT}` +
    `?q=${encodeURIComponent(address + ", New York City, NY")}` +
    `&format=json&limit=1&countrycodes=us` +
    `&viewbox=-74.2591,40.9176,-73.7004,40.4774&bounded=1`;

  const geoRes = await fetch(geocodeUrl, { headers: { "User-Agent": "nyc-jailbreak/1.0" } });
  if (!geoRes.ok) throw new Error(`Geocode error: HTTP ${geoRes.status}`);
  const geoRows = await geoRes.json();
  if (!geoRows.length) throw new Error("Address not found. Try including your borough — e.g. Brooklyn, Manhattan.");
  const { lat, lon } = geoRows[0];

  const plowUrl = `${PLOWNYC_REALTIME}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&t=${Date.now()}`;
  const plowRes = await fetch(plowUrl);
  if (!plowRes.ok) throw new Error(`PlowNYC error: HTTP ${plowRes.status}`);
  const text = await plowRes.text();
  const plowData = text.trim() ? JSON.parse(text) : {};

  const lastVisitedRaw = plowData.VisitedTime ?? null;
  const lastVisited    = lastVisitedRaw ? new Date(lastVisitedRaw) : null;
  const isPlowed       = lastVisited ? (Date.now() - lastVisited.getTime()) <= THREE_HOURS_MS : false;

  return { streetName: plowData.Street ?? address, lastVisited, isPlowed };
}

function evaluateStatus({ streetName, lastVisited, isPlowed }) {
  if (!lastVisited) {
    return { answer: "NO", streetName, lastVisited: null, detail: "No plow record found for this segment." };
  }
  const ageMs = Date.now() - lastVisited.getTime();
  if (isPlowed) {
    return { answer: "YES", streetName, lastVisited, detail: "Plowed in the last 3 hours." };
  }
  if (ageMs <= SIX_HOURS_MS) {
    return { answer: "YES", streetName, lastVisited, detail: "Plowed in the last 6 hours." };
  }
  return { answer: "NO", streetName, lastVisited, detail: "Last plowed over 6 hours ago." };
}

function formatTime(date) {
  if (!date) return "unknown time";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short",
  });
}

// ─── Snow Canvas ──────────────────────────────────────────────────────────────

function SnowCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let animId, width, height;
    const particles = [];

    function resize() {
      width  = canvas.width  = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }

    function makeFlake() {
      return {
        x:    Math.random() * width,
        y:    Math.random() * height,
        vx:   (Math.random() - 0.5),
        vy:   Math.random() * 2 + 1,
        size: Math.random() * 3 + 1,
      };
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > height) { p.y = -10; p.x = Math.random() * width; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fill();
      }
      animId = requestAnimationFrame(animate);
    }

    resize();
    for (let i = 0; i < 100; i++) particles.push(makeFlake());
    animate();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 50 }}
    />
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [view,    setView]    = useState("landing"); // "landing" | "result" | "error"
  const [fading,  setFading]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);

  // Address + autocomplete
  const [address,     setAddress]     = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showList,    setShowList]    = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const debounceRef = useRef(null);
  const wrapperRef  = useRef(null);

  // Apply/remove body state class based on result
  useEffect(() => {
    if (result) {
      document.body.classList.add(result.answer === "YES" ? "state-yes" : "state-no");
    }
    return () => document.body.classList.remove("state-yes", "state-no");
  }, [result]);

  // Close autocomplete on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setShowList(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setAddress(val);
    setActiveIdx(-1);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 3) { setSuggestions([]); setShowList(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${GEOSEARCH_AUTOCOMPLETE}?text=${encodeURIComponent(val)}&size=5`);
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
    if (!showList || !suggestions.length) return;
    if      (e.key === "ArrowDown")               { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp")                 { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); selectSuggestion(suggestions[activeIdx]); }
    else if (e.key === "Escape")                  { setShowList(false); }
  }

  async function handleSearch(addr) {
    if (!addr.trim() || loading) return;
    setShowList(false);
    setLoading(true);
    setFading(true);
    try {
      // Fetch data in parallel with the minimum fade-out time
      const [plowData] = await Promise.all([
        getPlowData(addr),
        new Promise(r => setTimeout(r, 400)),
      ]);
      const evaluation = evaluateStatus(plowData);
      setResult(evaluation);
      setError(null);
      setView("result");
    } catch (err) {
      setError(err.message || "An unexpected error occurred.");
      setResult(null);
      setView("error");
    } finally {
      setLoading(false);
      setFading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    handleSearch(address);
  }

  function resetSearch() {
    setFading(true);
    setTimeout(() => {
      setView("landing");
      setResult(null);
      setError(null);
      setAddress("");
      setSuggestions([]);
      setFading(false);
    }, 400);
  }

  return (
    <>
      <SnowCanvas />

      {/* ── Landing ── */}
      {view === "landing" && (
        <div
          className="container landing-view"
          style={{ opacity: fading ? 0 : 1, transition: "opacity 0.4s ease" }}
        >
          <div className="storm-advisory">STORM ADVISORY: 8–14 IN. EXPECTED</div>

          <h1 className="hero-title">CAN I GO<br />OUTSIDE?</h1>

          <p className="hero-tagline">
            Check if your NYC street has been plowed.<br />Real-time data, no fluff.
          </p>

          <form className="search-container" onSubmit={handleSubmit} ref={wrapperRef}>
            <input
              type="text"
              placeholder="ENTER YOUR NYC ADDRESS..."
              autoComplete="off"
              value={address}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length > 0 && setShowList(true)}
              disabled={loading}
            />
            <button type="submit" className="search-btn" disabled={loading || !address.trim()}>
              {loading ? "..." : "CHECK"}
            </button>
            {showList && (
              <ul className="autocomplete-list">
                {suggestions.map((label, i) => (
                  <li
                    key={i}
                    onMouseDown={() => selectSuggestion(label)}
                    className={i === activeIdx ? "active" : ""}
                  >
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </form>

          <div className="logo-footer">
            <span className="logo-circle" />
            POWERED BY PARTYPLACE.COM
          </div>
        </div>
      )}

      {/* ── Result ── */}
      {view === "result" && result && (
        <div className="container" style={{ animation: "fadeIn 0.8s ease forwards" }}>
          <div className="status-hero">
            <div className="label-text">CURRENT STATUS</div>
            <div className="big-answer">{result.answer}.</div>
            <div className="plow-data">
              {result.detail.toUpperCase()}<br />
              {result.lastVisited && <>LAST VISITED AT {formatTime(result.lastVisited)}.<br /></>}
              {result.streetName && <>{result.streetName.toUpperCase()}<br /></>}
              <span style={{ opacity: 0.5, fontSize: "0.7em" }}>
                SOURCE: PLOWNYC REAL-TIME API · OPENSTREETMAP NOMINATIM
              </span>
            </div>
            <button className="reset-search" onClick={resetSearch}>SEARCH ANOTHER</button>
          </div>

          <div className="cards-section">
            <p style={{ marginBottom: "2rem", opacity: 0.7, fontSize: "0.95rem", letterSpacing: "0.05em" }}>
              {result.answer === "YES"
                ? "Roads are passable. Time to celebrate."
                : "Stuck inside? Find a warm venue near you."}
            </p>
            <a href={PARTYPLACE_URL} target="_blank" rel="noopener noreferrer" className="partyplace-btn">
              FIND A VENUE ON PARTYPLACE →
            </a>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {view === "error" && (
        <div className="container" style={{ animation: "fadeIn 0.8s ease forwards" }}>
          <div className="status-hero">
            <div className="label-text">TRANSMISSION ERROR</div>
            <div className="big-answer" style={{ fontSize: "clamp(5rem, 12vw, 10rem)", color: "var(--safety-orange)" }}>
              OOPS.
            </div>
            <div className="plow-data" style={{ borderLeftColor: "var(--safety-orange)" }}>
              {error}
            </div>
            <button className="reset-search" onClick={resetSearch}>TRY AGAIN</button>
          </div>
        </div>
      )}
    </>
  );
}
