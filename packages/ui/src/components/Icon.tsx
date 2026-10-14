/** Íconos de trazo propios (24 px) para la navegación. */
const PATHS: Record<string, string> = {
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm5.5 12.5L21 21",
  ai: "M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15.5-3.5 1z",
  project: "M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 7V5a1 1 0 0 1 1-1h5l2 2",
  editor: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  stats: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0M17 3a4 4 0 0 1 0 8m5 10a7 7 0 0 0-4-6.3",
  sync: "M20 8A8 8 0 0 0 5.3 6.3L3 9m1 7a8 8 0 0 0 14.7 1.7L21 15M3 4v5h5m13 11v-5h-5",
  settings: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  plus: "M12 5v14M5 12h14",
  menu: "M4 6h16M4 12h16M4 18h16",
  external: "M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0-6v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
};

export function Icon({ name, size = 18, filled = false }: { name: keyof typeof PATHS | string; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
