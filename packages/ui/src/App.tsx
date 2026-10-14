import { useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import type { BioRepo } from "@biociencia/storage";
import { AppProvider, useApp, type Platform, type SaveFile, type SyncFolderAccess } from "./context.tsx";
import { Logo } from "./components/Logo.tsx";
import { Icon } from "./components/Icon.tsx";
import { Welcome } from "./screens/Welcome.tsx";
import { Home } from "./screens/Home.tsx";
import { Search } from "./screens/Search.tsx";
import { Library } from "./screens/Library.tsx";
import { ProjectDetail, Projects } from "./screens/Projects.tsx";
import { Analysis, Editor, Researchers, Settings, Statistics } from "./screens/Others.tsx";
import { AutoSync, SyncScreen } from "./screens/Sync.tsx";

const NAV: { group: string; items: { to: string; label: string; icon: string; phase?: number }[] }[] = [
  {
    group: "Investigar",
    items: [
      { to: "/", label: "Inicio", icon: "home" },
      { to: "/buscar", label: "Buscador", icon: "search" },
      { to: "/analisis", label: "Análisis con IA", icon: "ai", phase: 7 },
    ],
  },
  {
    group: "Organizar",
    items: [
      { to: "/biblioteca", label: "Biblioteca", icon: "library" },
      { to: "/proyectos", label: "Proyectos", icon: "project" },
      { to: "/editor", label: "Editor científico", icon: "editor", phase: 8 },
      { to: "/estadistica", label: "Estadística", icon: "stats", phase: 9 },
    ],
  },
  {
    group: "Colaborar",
    items: [
      { to: "/investigadores", label: "Investigadores", icon: "people", phase: 6 },
      { to: "/sincronizacion", label: "Sincronización", icon: "sync" },
      { to: "/configuracion", label: "Configuración", icon: "settings" },
    ],
  },
];

function Shell() {
  const { identity, theme, setTheme } = useApp();
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
            <div key={g.group}>
              <div className="bc-nav-group">{g.group}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"}>
                  <Icon name={i.icon} />
                  {i.label}
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
            <Icon name={theme === "dark" ? "sun" : "moon"} size={15} /> {theme === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
        </div>
      </aside>
      <main className="bc-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/buscar" element={<Search />} />
          <Route path="/analisis" element={<Analysis />} />
          <Route path="/biblioteca" element={<Library />} />
          <Route path="/proyectos" element={<Projects />} />
          <Route path="/proyectos/:id" element={<ProjectDetail />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/estadistica" element={<Statistics />} />
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
