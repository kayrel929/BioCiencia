import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe as group, expect, it } from "vitest";
import {
  anovaFactorial, anovaOneWay, anovaRcbd, chiSquare, compactLetters, describe, kruskalWallis, levene, linearRegression,
  pearson, shapiroWilk, spearman, tTestIndependent, tTestPaired, tukeyHsd,
} from "../src/index.ts";

/**
 * Cada resultado se compara con SciPy 1.18 / statsmodels 0.15 (tests/ref/referencias.json,
 * generado por tests/ref/generar_referencias.py). Tolerancia relativa indicada en cada caso.
 */
const REF = JSON.parse(readFileSync(join(__dirname, "ref", "referencias.json"), "utf8"));
const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b) / Math.max(Math.abs(b), 1e-300), `${a} vs ${b}`).toBeLessThan(rel);

group("PlantGrowth (Dobson 1983, conjunto clásico de R)", () => {
  const { y, g } = REF.plantgrowth;
  const ctrl = y.slice(0, 10);
  const trt2 = y.slice(20);

  it("ANOVA de una vía igual que statsmodels", () => {
    const a = anovaOneWay(y, g);
    close(a.table[0]!.ss, REF.plantgrowth.anova.ss_trt);
    close(a.table[1]!.ss, REF.plantgrowth.anova.ss_err);
    close(a.table[0]!.f!, REF.plantgrowth.anova.f);
    close(a.table[0]!.p!, REF.plantgrowth.anova.p, 1e-8);
  });

  it("Tukey HSD igual que scipy.stats.tukey_hsd y letras correctas", () => {
    const a = anovaOneWay(y, g);
    const t = tukeyHsd(y, g, a.mse, a.dfError);
    const p = (x: string, z: string) => t.pairs.find((q) => (q.a === x && q.b === z) || (q.a === z && q.b === x))!.p;
    close(p("ctrl", "trt1"), REF.plantgrowth.tukey_p["ctrl-trt1"], 1e-6);
    close(p("ctrl", "trt2"), REF.plantgrowth.tukey_p["ctrl-trt2"], 1e-6);
    close(p("trt1", "trt2"), REF.plantgrowth.tukey_p["trt1-trt2"], 1e-6);
    // Solo trt1 y trt2 difieren → trt2 «a», ctrl «ab», trt1 «b»
    expect(t.groups.map((x) => [x.name, x.letters])).toEqual([["trt2", "a"], ["ctrl", "ab"], ["trt1", "b"]]);
  });

  it("Levene, Shapiro-Wilk de residuos y Kruskal-Wallis", () => {
    const lv = levene(y, g);
    close(lv.f, REF.plantgrowth.levene[0]);
    close(lv.p, REF.plantgrowth.levene[1], 1e-8);
    const sw = shapiroWilk(anovaOneWay(y, g).residuals);
    close(sw.w, REF.plantgrowth.shapiro_resid[0], 1e-6);
    close(sw.p, REF.plantgrowth.shapiro_resid[1], 1e-4);
    const kw = kruskalWallis(y, g);
    close(kw.h, REF.plantgrowth.kruskal[0]);
    close(kw.p, REF.plantgrowth.kruskal[1], 1e-8);
  });

  it("descriptiva y pruebas t (Welch, Student, pareada)", () => {
    const d = describe(ctrl);
    const r = REF.plantgrowth.describe_ctrl;
    close(d.mean, r.mean);
    close(d.sd, r.sd);
    close(d.q1, r.q1);
    close(d.median, r.median);
    close(d.q3, r.q3);
    close(d.ci95[0], r.ci95[0], 1e-9);
    close(d.ci95[1], r.ci95[1], 1e-9);
    const w = tTestIndependent(ctrl, trt2);
    close(w.t, REF.plantgrowth.welch[0]);
    close(w.p, REF.plantgrowth.welch[1], 1e-8);
    const s = tTestIndependent(ctrl, trt2, true);
    close(s.t, REF.plantgrowth.student[0]);
    close(s.p, REF.plantgrowth.student[1], 1e-8);
    const pr = tTestPaired(ctrl, trt2);
    close(pr.t, REF.plantgrowth.paired[0]);
    close(pr.p, REF.plantgrowth.paired[1], 1e-8);
  });
});

group("diseños experimentales", () => {
  it("DBCA (5 tratamientos × 4 bloques) igual que statsmodels", () => {
    const r = REF.rcbd;
    const a = anovaRcbd(r.y, r.t, r.b);
    close(a.table[0]!.ss, r.ss_t);
    close(a.table[1]!.ss, r.ss_b);
    close(a.table[2]!.ss, r.ss_e);
    close(a.table[0]!.f!, r.f_t);
    close(a.table[0]!.p!, r.p_t, 1e-7);
    close(a.table[1]!.p!, r.p_b, 1e-7);
    close(a.mse, r.mse);
  });

  it("DBCA incompleto o con repetidos: error explicativo", () => {
    expect(() => anovaRcbd([1, 2, 3], ["A", "B", "A"], ["1", "1", "2"])).toThrow(/Faltan datos/);
    expect(() => anovaRcbd([1, 2], ["A", "A"], ["1", "1"])).toThrow(/aparece dos veces/);
  });

  it("factorial 3 × 2 con interacción igual que statsmodels", () => {
    const f = REF.factorial;
    const a = anovaFactorial(f.y, f.a, f.b);
    for (let i = 0; i < 4; i++) close(a.table[i === 3 ? 3 : i]!.ss, f.ss[i]);
    for (let i = 0; i < 3; i++) {
      close(a.table[i]!.f!, f.f[i]);
      close(a.table[i]!.p!, f.p[i], 1e-7);
    }
  });
});

group("relación entre variables", () => {
  const { x, y } = REF.relacion;
  it("Pearson, Spearman y regresión lineal", () => {
    const p = pearson(x, y);
    close(p.r, REF.relacion.pearson[0]);
    close(p.p, REF.relacion.pearson[1], 1e-6);
    const s = spearman(x, y);
    close(s.rho, REF.relacion.spearman[0]);
    const lr = linearRegression(x, y);
    close(lr.slope, REF.relacion.slope);
    close(lr.intercept, REF.relacion.intercept);
    close(lr.r2, REF.relacion.r2);
    close(lr.seSlope, REF.relacion.se_slope);
    close(lr.seIntercept, REF.relacion.se_intercept);
    close(lr.p, REF.relacion.p, 1e-6);
  });
  it("χ² de independencia", () => {
    const c = chiSquare(REF.chi2.table);
    close(c.chi2, REF.chi2.chi2);
    close(c.p, REF.chi2.p, 1e-8);
    expect(c.df).toBe(REF.chi2.df);
  });
});

group("Shapiro-Wilk en varios tamaños", () => {
  for (const [n, r] of Object.entries(REF.shapiro) as [string, { x: number[]; w: number; p: number }][]) {
    it(`n = ${n}`, () => {
      const sw = shapiroWilk(r.x);
      close(sw.w, r.w, 1e-6);
      close(sw.p, r.p, 2e-4);
    });
  }
});

group("letras de agrupación", () => {
  it("cadena de diferencias a–b–c", () => {
    const L = compactLetters(
      [{ name: "A", mean: 10 }, { name: "B", mean: 8 }, { name: "C", mean: 6 }, { name: "D", mean: 4 }],
      [["A", "C"], ["A", "D"], ["B", "D"]],
    );
    expect([...L.entries()]).toEqual([["A", "a"], ["B", "ab"], ["C", "bc"], ["D", "c"]]);
  });
  it("sin diferencias: todos «a»", () => {
    const L = compactLetters([{ name: "X", mean: 2 }, { name: "Y", mean: 1 }], []);
    expect([...L.values()]).toEqual(["a", "a"]);
  });
});

import { completeRows, formatP, parseTable } from "../src/index.ts";

group("tablas pegadas desde Excel", () => {
  it("tabulador con coma decimal (Excel en español)", () => {
    const t = parseTable("Tratamiento\tBloque\tRendimiento\nT1\tI\t4,52\nT2\tI\t5,10\nT1\tII\t\nT2\tII\t1.234,5\n");
    expect(t.delimiter).toBe("\t");
    expect(t.decimalComma).toBe(true);
    expect(t.columns.map((c) => [c.name, c.kind])).toEqual([["Tratamiento", "text"], ["Bloque", "text"], ["Rendimiento", "number"]]);
    expect(t.columns[2]!.num.map((v) => (Number.isNaN(v) ? null : v))).toEqual([4.52, 5.1, null, 1234.5]);
    expect(completeRows(t, ["Tratamiento", "Rendimiento"])).toEqual({ index: [0, 1, 3], dropped: 1 });
  });
  it("CSV con comillas y punto decimal", () => {
    const t = parseTable('dosis,"altura, cm"\n0,"12.5"\n50,14\n');
    expect(t.columns[1]!.name).toBe("altura, cm");
    expect(t.columns[1]!.num).toEqual([12.5, 14]);
  });
  it("punto y coma con coma decimal y aviso de filas irregulares", () => {
    const t = parseTable("a;b\n1,5;2\n3\n");
    expect(t.decimalComma).toBe(true);
    expect(t.warnings[0]).toMatch(/número de columnas distinto/);
  });
  it("formato de p", () => {
    expect(formatP(0.0004)).toBe("< 0,001");
    expect(formatP(0.0159)).toBe("0,016");
  });
});
