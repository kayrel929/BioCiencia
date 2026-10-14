import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useAsync } from "../context.tsx";
import { Icon } from "../components/Icon.tsx";

const EXAMPLES = [
  "Trichoderma contra Ralstonia solanacearum",
  "Stenocarpella macrospora en maíz",
  "Bacillus subtilis biocontrol banano",
  "Meloidogyne en tomate hongos rizosféricos",
];

export function Home() {
  const { repo, identity } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const stats = useAsync(async () => ({
    library: await repo.libraryCount(),
    projects: (await repo.listProjects()).length,
    searches: await repo.listSearches(5),
  }), []);

  const go = (text: string) => text.trim() && nav(`/buscar?q=${encodeURIComponent(text.trim())}`);

  return (
    <div className="bc-page">
      <section className="bc-hero">
        <h1>
          Investigación científica, <span>conectada</span>
        </h1>
        <p className="bc-hero-slogan">La ciencia conectada, el conocimiento compartido</p>
        <form
          className="bc-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go(q);
          }}
        >
          <Icon name="search" size={22} />
          <input
            aria-label="Buscar publicaciones"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Escriba una pregunta, tema, autor o DOI…"
          />
          <button className="bc-btn bc-btn-primary" type="submit">Buscar</button>
        </form>
        <div className="bc-chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="bc-chip" onClick={() => go(ex)} type="button">
              {ex}
            </button>
          ))}
        </div>
      </section>

      <div className="bc-cards">
        <Link to="/biblioteca" className="bc-card" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="bc-stat">{stats.data?.library ?? "–"}</div>
          <div className="bc-stat-label">publicaciones en su biblioteca</div>
        </Link>
        <Link to="/proyectos" className="bc-card" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="bc-stat">{stats.data?.projects ?? "–"}</div>
          <div className="bc-stat-label">proyectos de investigación</div>
        </Link>
        <div className="bc-card">
          <div className="bc-stat-label" style={{ marginBottom: 6 }}>Búsquedas recientes</div>
          {stats.data?.searches.length ? (
            stats.data.searches.map((s) => (
              <div key={s.id} style={{ fontSize: "0.9rem" }}>
                <Link to={`/buscar?s=${s.id}`}>{s.query}</Link>
              </div>
            ))
          ) : (
            <div className="bc-sub" style={{ fontSize: "0.9rem" }}>Aún no hay búsquedas guardadas.</div>
          )}
        </div>
      </div>
      <p className="bc-sub" style={{ marginTop: 24, fontSize: "0.85rem", textAlign: "center" }}>
        Sesión de {identity?.displayName}. Sus datos se guardan en este equipo.
      </p>
    </div>
  );
}
