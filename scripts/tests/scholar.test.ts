import { describe, expect, it } from "vitest";
import { parseScholarProfile, s2Target, scholarTarget } from "../servir.mjs";

// Fragmento real de una página de perfil de Google Académico (tabla de indicadores).
const html = `
<div id="gsc_prf_in">Investigador de Ejemplo</div>
<h3 class="gsc_rsb_f gs_ibl">Citado por</h3>
<table id="gsc_rsb_st"><thead><tr><th class="gsc_rsb_sth"></th><th class="gsc_rsb_sth">Total</th><th class="gsc_rsb_sth">Desde 2021</th></tr></thead><tbody>
<tr><td class="gsc_rsb_sc1"><a href="javascript:void(0)" class="gsc_rsb_f gs_ibl" title="Recoge el número de veces...">Citas</a></td><td class="gsc_rsb_std">48</td><td class="gsc_rsb_std">44</td></tr>
<tr><td class="gsc_rsb_sc1"><a href="javascript:void(0)" class="gsc_rsb_f gs_ibl" title="Índice h es...">Índice h</a></td><td class="gsc_rsb_std">4</td><td class="gsc_rsb_std">4</td></tr>
<tr><td class="gsc_rsb_sc1"><a href="javascript:void(0)" class="gsc_rsb_f gs_ibl" title="Índice i10 recoge...">Índice i10</a></td><td class="gsc_rsb_std">0</td><td class="gsc_rsb_std">0</td></tr>
</tbody></table>`;

describe("puente de Google Académico (scripts/servir.mjs)", () => {
  it("lee las cifras de la tabla del perfil", () => {
    expect(parseScholarProfile(html)).toEqual({
      name: "Investigador de Ejemplo",
      sinceYear: 2021,
      citations: 48,
      sinceCitations: 44,
      h: 4,
      sinceH: 4,
      i10: 0,
      sinceI10: 0,
    });
  });

  it("no inventa cifras si la página no las trae", () => {
    expect(parseScholarProfile("<html>sin tabla</html>")).toEqual({});
  });

  it("lee el dominio del correo verificado (Google no publica el correo completo)", () => {
    const h = '<div id="gsc_prf_ivh">Dirección de correo verificada de universidad.edu.ec - <a href="#">Página principal</a></div>';
    expect(parseScholarProfile(h)).toEqual({ emailDomain: "universidad.edu.ec" });
  });

  it("acepta el identificador del perfil", () => {
    expect(scholarTarget("", "AbC123xYz9Q")).toBe("https://scholar.google.com/citations?hl=es&user=AbC123xYz9Q");
  });

  it("acepta solo direcciones de Google Académico /citations", () => {
    expect(scholarTarget("https://scholar.google.com/citations?hl=es&user=ABC123", "")).toContain("scholar.google.com/citations");
    expect(scholarTarget("https://scholar.google.es/citations?user=ABC123", "")).toContain("scholar.google.es/citations");
  });

  it("rechaza cualquier otro destino (evita el abuso del puente)", () => {
    expect(scholarTarget("https://evil.example.com/citations?user=ABC123", "")).toBeNull();
    expect(scholarTarget("http://169.254.169.254/latest/meta-data", "")).toBeNull();
    expect(scholarTarget("https://scholar.google.com/scholar?q=otracosa", "")).toBeNull();
    expect(scholarTarget("file:///C:/Windows/win.ini", "")).toBeNull();
    expect(scholarTarget("", "")).toBeNull();
  });

  it("el puente de Semantic Scholar solo acepta un DOI válido", () => {
    expect(s2Target("10.21931/rb/2024.09.01.6")).toBe("10.21931/rb/2024.09.01.6");
    expect(s2Target("doi:10.1234/ABC")).toBe("10.1234/abc");
    expect(s2Target("https://doi.org/10.1234/xyz")).toBe("10.1234/xyz");
    expect(s2Target("https://evil.example.com/")).toBeNull();
    expect(s2Target("no-es-doi")).toBeNull();
    expect(s2Target("")).toBeNull();
  });
});
