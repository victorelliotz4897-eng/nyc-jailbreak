import { useEffect, useRef, useState } from "react";
import ErrorView from "./components/ErrorView";
import LandingView from "./components/LandingView";
import ResultView from "./components/ResultView";
import SnowCanvas from "./components/SnowCanvas";
import { evaluateStatus, getPlowData } from "./lib/plowApi";
import "./index.css";

const GEOSEARCH_AUTOCOMPLETE = "https://geosearch.planninglabs.nyc/v2/autocomplete";
const MIN_AUTOCOMPLETE_CHARS = 2;
const NYC_LOCATION_HINTS = [
  "brooklyn",
  "queens",
  "manhattan",
  "bronx",
  "staten island",
  "new york county",
  "kings county",
  "queens county",
  "bronx county",
  "richmond county",
  "new york, ny",
];

function isNycSuggestion(label) {
  const lowerLabel = label.toLowerCase();
  return NYC_LOCATION_HINTS.some((token) => lowerLabel.includes(token));
}

export default function App() {
  const [view, setView] = useState("landing"); // "landing" | "result" | "error"
  const [fading, setFading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showList, setShowList] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);

  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    document.body.classList.remove("state-yes", "state-no");
    if (result?.answer === "YES") {
      document.body.classList.add("state-yes");
    } else if (result?.answer === "NO") {
      document.body.classList.add("state-no");
    }
    return () => {
      document.body.classList.remove("state-yes", "state-no");
    };
  }, [result]);

  useEffect(() => {
    function handleDocumentMouseDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowList(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  async function fetchSuggestions(query) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_AUTOCOMPLETE_CHARS) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      setShowList(false);
      return;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    try {
      const response = await fetch(
        `${GEOSEARCH_AUTOCOMPLETE}?text=${encodeURIComponent(trimmedQuery)}&size=8`,
      );
      if (!response.ok) return;

      const data = await response.json();
      if (requestSeq !== requestSeqRef.current) return;

      const nextSuggestions = (data.features ?? [])
        .map((feature) => {
          const label = feature.properties?.label;
          const coordinates = feature.geometry?.coordinates;
          if (!label || !Array.isArray(coordinates) || coordinates.length < 2) {
            return null;
          }
          return {
            label,
            lon: coordinates[0],
            lat: coordinates[1],
          };
        })
        .filter(Boolean)
        .filter((item) => isNycSuggestion(item.label));

      const uniqueSuggestions = nextSuggestions.filter(
        (item, index, list) => index === list.findIndex((other) => other.label === item.label),
      );

      setSuggestions(uniqueSuggestions);
      setShowList(uniqueSuggestions.length > 0);
    } catch {
      if (requestSeq !== requestSeqRef.current) return;
      setSuggestions([]);
      setShowList(false);
    }
  }

  function handleChange(event) {
    const value = event.target.value;
    setAddress(value);
    setActiveIdx(-1);
    setSelectedSuggestion(null);

    clearTimeout(debounceRef.current);

    if (value.trim().length < MIN_AUTOCOMPLETE_CHARS) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      setShowList(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 180);
  }

  function selectSuggestion(suggestion) {
    setAddress(suggestion.label);
    setSelectedSuggestion(suggestion);
    setSuggestions([]);
    setShowList(false);
  }

  function handleKeyDown(event) {
    if (!showList || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIdx((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIdx((index) => Math.max(index - 1, -1));
      return;
    }

    if (event.key === "Enter" && activeIdx >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIdx]);
      return;
    }

    if (event.key === "Escape") {
      setShowList(false);
    }
  }

  function handleFocus() {
    const trimmedAddress = address.trim();
    if (trimmedAddress.length < MIN_AUTOCOMPLETE_CHARS) return;

    if (suggestions.length > 0) {
      setShowList(true);
      return;
    }

    fetchSuggestions(trimmedAddress);
  }

  async function handleSearch(addressQuery) {
    if (!addressQuery.trim() || loading) return;

    setShowList(false);
    setLoading(true);
    setFading(true);

    try {
      const [plowData] = await Promise.all([
        getPlowData(addressQuery, selectedSuggestion),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]);

      setResult(evaluateStatus(plowData));
      setError(null);
      setView("result");
    } catch (fetchError) {
      setError(fetchError.message || "An unexpected error occurred.");
      setResult(null);
      setView("error");
    } finally {
      setLoading(false);
      setFading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    handleSearch(address);
  }

  function resetSearch() {
    setFading(true);

    setTimeout(() => {
      setView("landing");
      setResult(null);
      setError(null);
      setAddress("");
      setSelectedSuggestion(null);
      setSuggestions([]);
      setShowList(false);
      setActiveIdx(-1);
      setFading(false);
    }, 400);
  }

  return (
    <>
      <SnowCanvas />

      {view === "landing" && (
        <LandingView
          address={address}
          suggestions={suggestions}
          showList={showList}
          activeIdx={activeIdx}
          loading={loading}
          fading={fading}
          wrapperRef={wrapperRef}
          onSubmit={handleSubmit}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onSelectSuggestion={selectSuggestion}
        />
      )}

      {view === "result" && result && <ResultView result={result} onReset={resetSearch} />}

      {view === "error" && <ErrorView error={error} onReset={resetSearch} />}
    </>
  );
}
