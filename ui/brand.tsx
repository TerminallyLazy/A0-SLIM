/** Owner-supplied artwork. Framing happens in CSS; the source composition stays intact. */
export function Brand() {
  return (
    <span className="slim-wordmark" role="img" aria-label="A0 SLIM">
      <img src="/brand/a0-slim-wordmark.webp" width="2172" height="724" alt="" />
    </span>
  );
}

export function BrandBanner() {
  return (
    <div className="slim-banner">
      <img
        className="dark-logo"
        src="/brand/a0-slim-banner-dark.webp"
        width="2172"
        height="724"
        loading="lazy"
        alt="A0 SLIM"
      />
      <img
        className="light-logo"
        src="/brand/a0-slim-wordmark.webp"
        width="2172"
        height="724"
        loading="lazy"
        alt="A0 SLIM"
      />
    </div>
  );
}
