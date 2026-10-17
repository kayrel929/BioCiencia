import { describe, expect, it } from "vitest";
import { citationsSince, hIndex, i10Index, scholarMetrics, type CitationHistory } from "../src/index.ts";

describe("índices h e i10", () => {
  it("definición de Hirsch", () => {
    expect(hIndex([10, 8, 5, 4, 3])).toBe(4);
    expect(hIndex([25, 8, 5, 3, 3])).toBe(3);
    expect(hIndex([1, 1, 1])).toBe(1);
    expect(hIndex([0, 0])).toBe(0);
    expect(hIndex([])).toBe(0);
    expect(hIndex([100])).toBe(1);
  });
  it("i10: publicaciones con 10 citas o más", () => {
    expect(i10Index([10, 9, 30, 0])).toBe(2);
  });
});

describe("indicadores del perfil", () => {
  const hs: CitationHistory[] = [
    { total: 12, byYear: { "2019": 4, "2022": 5, "2024": 3 } },
    { total: 3, byYear: { "2023": 2, "2025": 1 } },
    { total: 2, byYear: { "2017": 1 } }, // una cita sin año: suma al total, no a «desde»
    { total: 0, byYear: {} },
  ];
  it("todas y desde 2021", () => {
    expect(citationsSince(hs[0]!, 2021)).toBe(8);
    const m = scholarMetrics(hs, 2021);
    expect(m.citations).toEqual({ all: 17, since: 11 });
    expect(m.h).toEqual({ all: 2, since: 2 });
    expect(m.i10).toEqual({ all: 1, since: 0 });
    expect(m.perYear).toEqual([
      { year: 2017, n: 1 }, { year: 2019, n: 4 }, { year: 2022, n: 5 }, { year: 2023, n: 2 }, { year: 2024, n: 3 }, { year: 2025, n: 1 },
    ]);
    expect(m.works).toBe(4);
  });
});
