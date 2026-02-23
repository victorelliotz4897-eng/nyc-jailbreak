export default function LandingView({
  address,
  suggestions,
  showList,
  activeIdx,
  loading,
  fading,
  wrapperRef,
  onSubmit,
  onChange,
  onKeyDown,
  onFocus,
  onSelectSuggestion,
}) {
  return (
    <section
      id="landing-view"
      className="container landing-view"
      style={{ opacity: fading ? 0 : 1 }}
    >
      <div className="storm-advisory">STORM ADVISORY: 8-14 IN. EXPECTED</div>

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

      <form className="search-container" onSubmit={onSubmit} ref={wrapperRef}>
        <input
          type="text"
          placeholder="ENTER YOUR NYC ADDRESS..."
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="address-suggestion-list"
          value={address}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          disabled={loading}
          aria-label="NYC address"
        />

        <button type="submit" className="search-btn" disabled={loading || !address.trim()}>
          {loading ? "..." : "CHECK"}
        </button>

        {showList && (
          <ul
            id="address-suggestion-list"
            className="autocomplete-list"
            role="listbox"
            aria-label="NYC address suggestions"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.label}-${index}`}
                onMouseDown={() => onSelectSuggestion(suggestion)}
                className={index === activeIdx ? "active" : ""}
                role="option"
                aria-selected={index === activeIdx}
              >
                {suggestion.label}
              </li>
            ))}
          </ul>
        )}
      </form>
      <p className="search-helper">Start typing to pick an NYC address from the dropdown.</p>

      <div className="logo-footer">
        <span className="logo-circle" />
        POWERED BY PARTYPLACE.COM
      </div>
    </section>
  );
}
