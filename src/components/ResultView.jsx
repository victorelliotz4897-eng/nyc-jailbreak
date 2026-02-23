import PartyplaceFooter from "./PartyplaceFooter";
import { PARTYPLACE_URL, formatTime } from "../lib/plowApi";

export default function ResultView({ result, onReset }) {
  return (
    <section className="container fade-in" aria-live="polite">
      <div className="status-hero">
        <div className="label-text">CURRENT STATUS</div>
        <div className="big-answer">{result.answer}.</div>

        <div className="plow-data">
          {result.detail.toUpperCase()}
          <br />
          {result.lastVisited && (
            <>
              LAST VISITED AT {formatTime(result.lastVisited).toUpperCase()}.
              <br />
            </>
          )}
          {result.streetName && (
            <>
              {result.streetName.toUpperCase()}
              <br />
            </>
          )}
          <span className="source-note">
            SOURCE: PLOWNYC REAL-TIME API · OPENSTREETMAP NOMINATIM
          </span>
        </div>

        <button className="reset-search" onClick={onReset}>
          SEARCH ANOTHER
        </button>
      </div>

      <div className="cards-section">
        <p className="cards-caption">
          {result.answer === "YES"
            ? "Roads are passable. Time to celebrate."
            : "Stuck inside? Find a warm venue near you."}
        </p>

        <a href={PARTYPLACE_URL} target="_blank" rel="noopener noreferrer" className="partyplace-btn">
          FIND A VENUE ON PARTYPLACE -&gt;
        </a>
      </div>

      <PartyplaceFooter className="page-footer" />
    </section>
  );
}
