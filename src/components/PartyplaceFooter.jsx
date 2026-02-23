import { PARTYPLACE_URL } from "../lib/plowApi";

export default function PartyplaceFooter({ className = "" }) {
  const footerClassName = `logo-footer ${className}`.trim();

  return (
    <div className={footerClassName}>
      <span className="logo-footer-text">
        POWERED BY{" "}
        <a
          href={PARTYPLACE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="logo-footer-link"
        >
          PARTYPLACE.COM
        </a>
      </span>
    </div>
  );
}
