export default function ErrorView({ error, onReset }) {
  return (
    <section className="container fade-in" aria-live="assertive">
      <div className="status-hero">
        <div className="label-text">TRANSMISSION ERROR</div>

        <div className="big-answer error-answer">OOPS.</div>

        <div className="plow-data error-data">{error}</div>

        <button className="reset-search" onClick={onReset}>
          TRY AGAIN
        </button>
      </div>
    </section>
  );
}
