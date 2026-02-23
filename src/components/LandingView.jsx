export default function LandingView({
  address,
  loading,
  fading,
  onSubmit,
  onChange,
}) {
  return (
    <section
      id="landing-view"
      className="container landing-view"
      style={{ opacity: fading ? 0 : 1 }}
    >
      <div className="storm-advisory">STORM ADVISORY: 15-18 IN. EXPECTED</div>

      <h1 className="hero-title">
        CAN I GO
        <br />
        OUTSIDE?
      </h1>

      <p className="hero-tagline">
        Check if your NYC street has been plowed.
        <br />
        Real-time data, no fluff.
      </p>

      <form className="search-container" onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="ENTER YOUR NYC ADDRESS..."
          autoComplete="off"
          value={address}
          onChange={onChange}
          disabled={loading}
          aria-label="NYC address"
        />

        <button type="submit" className="search-btn" disabled={loading || !address.trim()}>
          {loading ? "..." : "CHECK"}
        </button>
      </form>

      <div className="logo-footer">
        <span className="logo-circle" />
        POWERED BY PARTYPLACE.COM
      </div>
    </section>
  );
}
