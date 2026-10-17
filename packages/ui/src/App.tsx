import { useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import type { BioRepo } from "@biociencia/storage";
import { AppProvider, useApp, type Platform, type SaveFile, type SyncFolderAccess } from "./context.tsx";
import { tr, useLang } from "./i18n.tsx";
import { Logo } from "./components/Logo.tsx";
import { Icon } from "./components/Icon.tsx";
import { Welcome } from "./screens/Welcome.tsx";
import { Home } from "./screens/Home.tsx";
import { Search } from "./screens/Search.tsx";
import { Library } from "./screens/Library.tsx";
import { Settings } from "./screens/Others.tsx";
import { Analysis } from "./screens/Analysis.tsx";
import { Review } from "./screens/Review.tsx";
import { Help } from "./screens/Help.tsx";
import { Discovery } from "./screens/Discovery.tsx";
import { Researchers } from "./screens/Researchers.tsx";
import { AutoSync, SyncScreen } from "./screens/Sync.tsx";

// Las etiquetas del menú van por clave de idioma; en inglés se traducen (estilo Consensus), en español quedan como siempre.
const NAV: { groupKey: string; items: { to: string; labelKey: string; icon: string; phase?: number }[] }[] = [
  {
    groupKey: "nav.group1",
    items: [
      { to: "/", labelKey: "nav.home", icon: "home" },
      { to: "/buscar", labelKey: "nav.search", icon: "search" },
      { to: "/revision", labelKey: "nav.review", icon: "review" },
      { to: "/analisis", labelKey: "nav.ai", icon: "ai" },
    ],
  },
  {
    groupKey: "nav.group2",
    items: [
      { to: "/biblioteca", labelKey: "nav.library", icon: "library" },
      { to: "/descubrimiento", labelKey: "nav.discovery", icon: "discover" },
    ],
  },
  {
    groupKey: "nav.group3",
    items: [
      { to: "/investigadores", labelKey: "nav.researchers", icon: "people" },
      { to: "/sincronizacion", labelKey: "nav.sync", icon: "sync" },
      { to: "/configuracion", labelKey: "nav.settings", icon: "settings" },
      { to: "/ayuda", labelKey: "nav.help", icon: "help" },
    ],
  },
];

function Shell() {
  const { identity, theme, setTheme } = useApp();
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  if (!identity) return <Welcome />;
  return (
    <div className={`bc-shell ${open ? "menu-open" : ""}`}>
      <button className="bc-btn bc-menu-btn" onClick={() => setOpen(!open)} aria-label="Menú">
        <Icon name="menu" />
      </button>
      <aside className="bc-sidebar" onClick={() => setOpen(false)}>
        <div className="bc-brand">
          <Logo size={34} />
          <div>
            <div className="bc-brand-name">
              Bio<span>Ciencia</span>
            </div>
            <div className="bc-brand-tag">Investigación científica colaborativa</div>
          </div>
        </div>
        <nav className="bc-nav" aria-label="Principal">
          {NAV.map((g) => (
            <div key={g.groupKey}>
              <div className="bc-nav-group">{tr(lang, g.groupKey)}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"}>
                  <Icon name={i.icon} />
                  {tr(lang, i.labelKey)}
                  {i.phase ? <span className="bc-soon" aria-hidden="true" title={`Pendiente: Fase ${i.phase}`}>F{i.phase}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="bc-sidebar-foot">
          <div style={{ color: "var(--bc-text-2)", fontWeight: 600 }}>{identity.displayName}</div>
          <button
            className="bc-btn bc-btn-ghost bc-btn-sm"
            style={{ paddingLeft: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              setTheme(theme === "dark" ? "light" : "dark");
            }}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={15} /> {tr(lang, theme === "dark" ? "nav.light" : "nav.theme")}
          </button>
          <button
            className="bc-btn bc-btn-ghost bc-btn-sm"
            style={{ paddingLeft: 0 }}
            data-testid="lang-toggle"
            title="Change the interface language / Cambiar el idioma de la interfaz"
            onClick={(e) => {
              e.stopPropagation();
              void setLang(lang === "es" ? "en" : "es");
            }}
          >
            {lang === "es" ? "🌐 English" : "🌐 Español"}
          </button>
        </div>
      </aside>
      <main className="bc-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/buscar" element={<Search />} />
          <Route path="/analisis" element={<Analysis />} />
          <Route path="/biblioteca" element={<Library />} />
          <Route path="/revision" element={<Review />} />
          <Route path="/ayuda" element={<Help />} />
          <Route path="/descubrimiento" element={<Discovery />} />
          <Route path="/investigadores" element={<Researchers />} />
          <Route path="/sincronizacion" element={<SyncScreen />} />
          <Route path="/configuracion" element={<Settings />} />
          <Route path="*" element={<div className="bc-page">Página no encontrada.</div>} />
        </Routes>
      </main>
    </div>
  );
}

export function BioCienciaApp({ repo, platform, saveFile, syncFolder }: { repo: BioRepo; platform: Platform; saveFile?: SaveFile; syncFolder?: SyncFolderAccess }) {
  return (
    <AppProvider repo={repo} platform={platform} saveFile={saveFile} syncFolder={syncFolder ?? null}>
      <AutoSync />
      <HashRouter>
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}

/** Pantalla mostrada si la base de datos no se puede abrir. */
export function StartupError({ message }: { message: string }) {
  return (
    <div style={{ padding: 32, fontFamily: "system-ui" }}>
      <h1>BioCiencia no pudo abrir su base de datos</h1>
      <p>{message}</p>
      <p>Sus datos no se han modificado. Cierre la aplicación y vuelva a intentarlo; si el problema continúa, envíe este mensaje al responsable del proyecto.</p>
    </div>
  );
}
