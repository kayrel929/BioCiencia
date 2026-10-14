/** Logotipo original de BioCiencia: una hoja formada por una red de nodos (conocimiento conectado). */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="BioCiencia">
      <defs>
        <linearGradient id="bc-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0f9d76" />
          <stop offset="1" stopColor="#1f6fd1" />
        </linearGradient>
      </defs>
      <path d="M10 54 C10 26 28 10 54 10 C54 36 38 54 10 54 Z" fill="url(#bc-g)" />
      <g stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.95">
        <path d="M14 50 L44 20" />
        <path d="M24 40 L24 28" />
        <path d="M32 32 L42 32" />
        <path d="M34 30 L34 22" />
      </g>
      <g fill="#ffffff">
        <circle cx="24" cy="26" r="3.2" />
        <circle cx="44" cy="32" r="3.2" />
        <circle cx="34" cy="20" r="3.2" />
        <circle cx="44" cy="20" r="2.4" />
      </g>
    </svg>
  );
}
