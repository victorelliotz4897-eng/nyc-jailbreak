import { useEffect, useState } from "react";
import ErrorView from "./components/ErrorView";
import LandingView from "./components/LandingView";
import ResultView from "./components/ResultView";
import SnowCanvas from "./components/SnowCanvas";
import { evaluateStatus, getPlowData } from "./lib/plowApi";
import "./index.css";

export default function App() {
  const [view, setView] = useState("landing"); // "landing" | "result" | "error"
  const [fading, setFading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [address, setAddress] = useState("");

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

  function handleChange(event) {
    setAddress(event.target.value);
  }

  async function handleSearch(addressQuery) {
    if (!addressQuery.trim() || loading) return;

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
      setFading(false);
    }, 400);
  }

  return (
    <>
      <SnowCanvas />

      {view === "landing" && (
        <LandingView
          address={address}
          loading={loading}
          fading={fading}
          onSubmit={handleSubmit}
          onChange={handleChange}
        />
      )}

      {view === "result" && result && <ResultView result={result} onReset={resetSearch} />}

      {view === "error" && <ErrorView error={error} onReset={resetSearch} />}
    </>
  );
}
