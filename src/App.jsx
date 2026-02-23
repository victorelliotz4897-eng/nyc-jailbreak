import { useEffect, useRef, useState } from "react";
import ErrorView from "./components/ErrorView";
import LandingView from "./components/LandingView";
import ResultView from "./components/ResultView";
import SnowCanvas from "./components/SnowCanvas";
import { evaluateStatus, getPlowData } from "./lib/plowApi";
import "./index.css";

const GEOSEARCH_AUTOCOMPLETE = "https://geosearch.planninglabs.nyc/v2/autocomplete";

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

  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

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

  function handleChange(event) {
    const value = event.target.value;
    setAddress(value);
    setActiveIdx(-1);

    clearTimeout(debounceRef.current);

    if (value.trim().length < 3) {
      setSuggestions([]);
      setShowList(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`${GEOSEARCH_AUTOCOMPLETE}?text=${encodeURIComponent(value)}&size=5`);
        if (!response.ok) return;

        const data = await response.json();
        const labels = (data.features ?? []).map((feature) => feature.properties.label);
        setSuggestions(labels);
        setShowList(labels.length > 0);
      } catch {
        // Intentionally silent: autocomplete failures should not block search.
      }
    }, 200);
  }

  function selectSuggestion(label) {
    setAddress(label);
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

  async function handleSearch(addressQuery) {
    if (!addressQuery.trim() || loading) return;

    setShowList(false);
    setLoading(true);
    setFading(true);

    try {
      const [plowData] = await Promise.all([
        getPlowData(addressQuery),
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
          onFocus={() => suggestions.length > 0 && setShowList(true)}
          onSelectSuggestion={selectSuggestion}
        />
      )}

      {view === "result" && result && <ResultView result={result} onReset={resetSearch} />}

      {view === "error" && <ErrorView error={error} onReset={resetSearch} />}
    </>
  );
}
