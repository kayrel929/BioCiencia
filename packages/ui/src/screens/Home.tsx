import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useAsync } from "../context.tsx";
import { tr, useLang } from "../i18n.tsx";
import { Icon } from "../components/Icon.tsx";
import { AlertsPanel } from "../components/Alerts.tsx";


export function Home() {
  const { repo, identity } = useApp();
  const { lang, t } = useLang();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const stats = useAsync(async () => ({
    library: await repo.libraryCount(),
    searches: await repo.listSearches(5),
  }), []);

  const go = (text: string) => text.trim() && nav(`/buscar?q=${encodeURIComponent(text.trim())}`);

  return (
    <div className="bc-page">
      <section className="bc-hero">
        <h1>
          {lang === "en" ? (
            <>
              What does the <span>literature</span> say?
            </>
          ) : (
            <>
              ¿Qué dice la <span>literatura</span>?
            </>
          )}
        </h1>
        <p className="bc-hero-slogan">{t("home.slogan")}</p>
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
            placeholder={t("home.placeholder")}
          />
          <button className="bc-btn bc-btn-primary" type="submit">{t("home_button")}</button>
        </form>

      </section>

      <div className="bc-cards">
        <Link to="/biblioteca" className="bc-card" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="bc-stat">{stats.data?.library ?? "–"}</div>
          <div className="bc-stat-label">{t("home.cardLibrary")}</div>
        </Link>
        <div className="bc-card">
          <div className="bc-stat-label" style={{ marginBottom: 6 }}>{t("home.cardSearches")}</div>
          {stats.data?.searches.length ? (
            stats.data.searches.map((s) => (
              <div key={s.id} style={{ fontSize: "0.9rem" }}>
                <Link to={`/buscar?s=${s.id}`}>{s.query}</Link>
              </div>
            ))
          ) : (
            <div className="bc-sub" style={{ fontSize: "0.9rem" }}>{t("home.cardEmpty")}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <AlertsPanel />
      </div>
      <p className="bc-sub" style={{ marginTop: 24, fontSize: "0.85rem", textAlign: "center" }}>
        {t("home.session")} {identity?.displayName}. {t("home.sessionTag")}
      </p>
    </div>
  );
}
