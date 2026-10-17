/**
 * Citas en Scopus con el recuadro oficial de Elsevier (Abstract Citations Count API, respuesta text/html).
 * Según la política de Elsevier: lo puede usar quien no tiene licencia de Scopus con su propia clave gratuita
 * (dev.elsevier.com), la llamada se hace desde el navegador del usuario y el recuadro enlaza a Scopus.
 * BioCiencia no suma estos números ni calcula índices con ellos: el índice h de Scopus se consulta en el perfil de autor.
 */
export function scopusWidgetUrl(doi: string, apiKey: string): string {
  const qs = new URLSearchParams({ doi, apiKey, httpAccept: "text/html" });
  return `https://api.elsevier.com/content/abstract/citation-count?${qs}`;
}

export function ScopusBadge({ doi, apiKey }: { doi: string | null | undefined; apiKey: string | null | undefined }) {
  if (!doi || !apiKey) return null;
  return (
    <iframe
      className="bc-scopus"
      title={`Citas en Scopus de ${doi}`}
      src={scopusWidgetUrl(doi, apiKey)}
      loading="lazy"
      referrerPolicy="no-referrer"
      width={200}
      height={50}
    />
  );
}

export const scopusAuthorUrl = (id: string) => `https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(id)}`;
