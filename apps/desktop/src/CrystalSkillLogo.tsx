type CrystalSkillLogoProps = {
  testId: string;
};

export function CrystalSkillLogo({ testId }: CrystalSkillLogoProps) {
  const glowId = `${testId}-glow`;
  const baseId = `${testId}-base`;
  const midId = `${testId}-mid`;
  const topId = `${testId}-top`;
  const crystalId = `${testId}-crystal`;

  return (
    <svg
      aria-hidden="true"
      className="metis-crystal-logo"
      data-testid={testId}
      focusable="false"
      viewBox="0 0 64 64"
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="52%" r="58%">
          <stop offset="0%" stopColor="#78f2ff" stopOpacity="0.48" />
          <stop offset="70%" stopColor="#6c8cff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#1a2f73" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={baseId} x1="16" x2="50" y1="48" y2="26">
          <stop offset="0%" stopColor="#5a4fe8" />
          <stop offset="52%" stopColor="#5b8dff" />
          <stop offset="100%" stopColor="#88f5ff" />
        </linearGradient>
        <linearGradient id={midId} x1="13" x2="51" y1="39" y2="18">
          <stop offset="0%" stopColor="#6a55f0" />
          <stop offset="54%" stopColor="#3f8dff" />
          <stop offset="100%" stopColor="#9cf8ff" />
        </linearGradient>
        <linearGradient id={topId} x1="18" x2="46" y1="30" y2="12">
          <stop offset="0%" stopColor="#77dfff" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#f5ffff" stopOpacity="0.92" />
        </linearGradient>
        <linearGradient id={crystalId} x1="20" x2="44" y1="8" y2="34">
          <stop offset="0%" stopColor="#8ea9ff" />
          <stop offset="45%" stopColor="#3bdcff" />
          <stop offset="100%" stopColor="#2858ee" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="52" fill={`url(#${glowId})`} rx="24" ry="7" />
      <path
        className="metis-crystal-logo-layer logo-layer-base"
        d="M14 40.5 32 31.5l18 9-18 10.8-18-10.8Z"
        fill={`url(#${baseId})`}
      />
      <path
        className="metis-crystal-logo-layer logo-layer-mid"
        d="M16 33.5 32 25.4l16 8.1-16 9.7-16-9.7Z"
        fill={`url(#${midId})`}
      />
      <path
        className="metis-crystal-logo-layer logo-layer-top"
        d="M18.8 27.1 32 20.4l13.2 6.7L32 35.2 18.8 27.1Z"
        fill={`url(#${topId})`}
      />
      <path
        className="metis-crystal-logo-crystal"
        d="M32 6.5 43.5 20 32 34.4 20.5 20 32 6.5Z"
        fill={`url(#${crystalId})`}
      />
      <path
        className="metis-crystal-logo-facet"
        d="M32 6.5 32 34.4 20.5 20Z"
        fill="#c9fbff"
        opacity="0.38"
      />
      <path
        className="metis-crystal-logo-facet"
        d="M32 6.5 43.5 20 32 20Z"
        fill="#f6ffff"
        opacity="0.44"
      />
      <path
        className="metis-crystal-logo-facet"
        d="M32 20 43.5 20 32 34.4Z"
        fill="#1e52dc"
        opacity="0.26"
      />
      <path
        className="metis-crystal-logo-highlight"
        d="M23.8 20.1 32 10.4 40.2 20.1"
        fill="none"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
    </svg>
  );
}
