import { describe, expect, it } from "vitest";
import {
  hlcCompare, hlcNow, hlcParse, hlcReceive, hlcToString,
  mergeWork, normalizeArxivId, normalizeDoi, normalizeOpenAlexId, normalizePmid,
  titleKey, ulid, ulidTime, workKeys, type Work,
} from "../src/index.ts";

const base: Work = {
  title: "Prevalence of Stenocarpella maydis and Stenocarpella macrospora causing Diplodia ear rot in Kentucky",
  authors: [{ name: "Nolan R. Anderson" }],
  year: 2023,
  doi: "10.1094/php-06-23-0060-rs",
  source: "openalex",
  fetchedAt: "2026-10-14T10:00:00Z",
};

describe("normalizeDoi", () => {
  it("reconoce el mismo DOI escrito de varias formas", () => {
    const forms = [
      "10.1094/PHP-06-23-0060-RS",
      "https://doi.org/10.1094/php-06-23-0060-rs",
      "http://dx.doi.org/10.1094/php-06-23-0060-rs",
      "doi:10.1094/php-06-23-0060-rs.",
      " doi.org/10.1094/php-06-23-0060-rs ",
    ];
    for (const f of forms) expect(normalizeDoi(f)).toBe("10.1094/php-06-23-0060-rs");
  });
  it("rechaza textos que no son DOI", () => {
    expect(normalizeDoi("hola")).toBeNull();
    expect(normalizeDoi("")).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
    expect(normalizeDoi("11.1234/x")).toBeNull();
  });
});

describe("otros identificadores", () => {
  it("normaliza PMID, OpenAlex y arXiv", () => {
    expect(normalizePmid("https://pubmed.ncbi.nlm.nih.gov/12345678/")).toBe("12345678");
    expect(normalizePmid("abc")).toBeNull();
    expect(normalizeOpenAlexId("https://openalex.org/W2741809807")).toBe("W2741809807");
    expect(normalizeArxivId("https://arxiv.org/abs/2101.00001v2")).toBe("2101.00001");
    expect(normalizeArxivId("arXiv:hep-th/9901001")).toBe("hep-th/9901001");
  });
});

describe("workKeys y duplicados", () => {
  it("prioriza el DOI y no usa el título si hay identificadores", () => {
    const keys = workKeys({ ...base, openalexId: "https://openalex.org/W1" });
    expect(keys[0]).toEqual({ kind: "doi", value: "10.1094/php-06-23-0060-rs" });
    expect(keys.map((k) => k.kind)).toEqual(["doi", "openalex"]);
  });
  it("sin identificadores usa título + año + apellido, insensible a acentos y mayúsculas", () => {
    const a = { title: "Control biológico de Ralstonia", year: 2024, authors: [{ name: "María Pérez" }] };
    const b = { title: "CONTROL BIOLOGICO DE RALSTONIA.", year: 2024, authors: [{ name: "Pérez, María" }] };
    expect(titleKey(a)).toBe(titleKey(b));
    expect(workKeys(a)[0]?.kind).toBe("titlehash");
  });
  it("mergeWork completa campos vacíos sin borrar los existentes", () => {
    const existing: Work = { ...base, abstract: null, keywords: ["maize"], citedByCount: 1 };
    const incoming: Work = { ...base, abstract: "Kentucky corn fields were surveyed…", keywords: ["Diplodia"], citedByCount: 2, venue: "Plant Health Progress", source: "crossref", fetchedAt: "2026-10-15T00:00:00Z" };
    const m = mergeWork(existing, incoming);
    expect(m.abstract).toBe("Kentucky corn fields were surveyed…");
    expect(m.venue).toBe("Plant Health Progress");
    expect(m.keywords).toEqual(["maize", "Diplodia"]);
    expect(m.citedByCount).toBe(2);
    expect(m.source).toBe("openalex"); // la fuente original se conserva
    expect(m.fetchedAt).toBe("2026-10-15T00:00:00Z");
  });
});

describe("ulid", () => {
  it("es único, de 26 caracteres y conserva el tiempo", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid(1_700_000_000_000)));
    expect(ids.size).toBe(1000);
    const one = [...ids][0]!;
    expect(one).toHaveLength(26);
    expect(ulidTime(one)).toBe(1_700_000_000_000);
  });
});

describe("HLC", () => {
  it("avanza aunque el reloj de pared no cambie", () => {
    const a = hlcNow(null, "A", 1000);
    const b = hlcNow(a, "A", 1000);
    expect(hlcCompare(hlcToString(a), hlcToString(b))).toBe(-1);
  });
  it("al recibir un evento remoto queda por delante de ambos", () => {
    const local = hlcNow(null, "A", 1000);
    const remote = { ms: 2000, counter: 3, node: "B" };
    const next = hlcReceive(local, remote, 1500);
    expect(hlcCompare(hlcToString(next), hlcToString(remote))).toBe(1);
    expect(hlcParse(hlcToString(next))).toEqual(next);
  });
  it("rechaza relojes remotos muy adelantados", () => {
    expect(() => hlcReceive(hlcNow(null, "A", 0), { ms: 10 * 60 * 1000, counter: 0, node: "B" }, 0)).toThrow();
  });
});
