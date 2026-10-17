import { normalizeDoi, worseRetraction, type RetractionInfo } from "@biociencia/core";
import { crossrefByDois } from "./crossref.ts";
import { europePmcRetractedDois } from "./europepmc.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Revisa si las publicaciones fueron retractadas, retiradas o corregidas:
 *  - Crossref «updated-by», que incluye la base de Retraction Watch (todas las áreas, también agronomía);
 *  - PubMed / Europe PMC «Retracted Publication» (biomedicina).
 * Lo que una fuente no pudo revisar se informa en `errors`; nada se da por «sin retractación» si no se consultó.
 */
export async function checkRetractions(
  http: HttpGet,
  dois: string[],
  opts: { email?: string | null; sleep?: (ms: number) => Promise<void>; pauseMs?: number } = {},
): Promise<{ results: Map<string, RetractionInfo | null>; checked: Set<string>; errors: string[] }> {
  const clean = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))];
  const results = new Map<string, RetractionInfo | null>();
  const checked = new Set<string>();
  const errors: string[] = [];
  const cr = await crossrefByDois(http, clean, new Date().toISOString(), { email: opts.email, sleep: opts.sleep, pauseMs: opts.pauseMs });
  for (const w of cr.works) {
    if (!w.doi) continue;
    checked.add(w.doi);
    results.set(w.doi, w.retraction ?? null);
  }
  if (cr.error) errors.push(`Crossref: ${cr.error}`);
  try {
    const epmc = await europePmcRetractedDois(http, clean);
    for (const d of epmc) {
      checked.add(d);
      results.set(d, worseRetraction(results.get(d), { status: "retracted", source: "pubmed" }));
    }
  } catch (e) {
    errors.push(`Europe PMC: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { results, checked, errors };
}
