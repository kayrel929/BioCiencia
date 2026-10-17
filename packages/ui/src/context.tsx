import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BioRepo, Identity } from "@biociencia/storage";
import { ArxivClient, CitationClient, CrossrefClient, DoajClient, EuropePmcClient, OpenAlexClient, OpenAlexSource, OpenaireClient, OrcidClient, PubMedClient, SemanticScholarClient, SemanticScholarSource, UnpaywallClient, type FreeSource, type HttpGet } from "@biociencia/sources";
import { SyncEngine, type SyncTransport } from "@biociencia/sync";
import { redact } from "@biociencia/core";

export type Platform = "desktop" | "web";

/** Guarda un archivo generado por la app. Devuelve false si el usuario canceló. */
export type SaveFile = (fileName: string, content: string | Uint8Array, mime: string) => Promise<boolean>;

/** Implementación web: descarga del navegador. */
export const browserSaveFile: SaveFile = async (fileName, content, mime) => {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type: typeof content === "string" ? `${mime};charset=utf-8` : mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
};

export type SearchSourceId = "openalex" | "europepmc" | "pubmed" | "crossref" | "doaj" | "semanticscholar" | "arxiv" | "openaire";

/** Acceso a una carpeta de sincronización (solo en la aplicación de Windows). */
export interface SyncFolderAccess {
  /** "desktop": comandos de Windows. "browser": File System Access API (Edge/Chrome) con permiso de carpeta. */
  readonly kind: "desktop" | "browser";
  /** Abre el diálogo para elegir la carpeta. Devuelve null si el usuario cancela. */
  pick(): Promise<string | null>;
  transport(root: string): SyncTransport;
  /** Solo navegador: vuelve a pedir el permiso de la carpeta (necesita un clic del usuario). */
  ensurePermission?(): Promise<boolean>;
  /** Solo navegador: ¿ya está concedido el permiso de la carpeta guardada? */
  hasPermission?(): Promise<boolean>;
}

interface AppState {
  repo: BioRepo;
  platform: Platform;
  identity: Identity | null;
  /** Se incrementa cada vez que cambian los datos, para que las pantallas recarguen. */
  version: number;
  refresh: () => void;
  setIdentity: (i: Identity) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  /** Cliente de OpenAlex (usa fetch del navegador o de la WebView de Windows) */
  openalex: OpenAlexClient;
  /** Fuentes de búsqueda (OpenAlex con costo; las demás gratuitas) */
  sources: Record<SearchSourceId, FreeSource>;
  unpaywall: UnpaywallClient;
  orcid: OrcidClient;
  citations: CitationClient;
  /** Semantic Scholar: citas de un artículo en otra base abierta y gratuita */
  semanticscholar: SemanticScholarClient;
  /** Correo de contacto para las APIs (OpenAlex, Crossref, PubMed, Unpaywall) */
  contactEmail: string | null;
  setContactEmail: (v: string | null) => void;
  /** Prefijo del proxy de la biblioteca institucional (opcional) */
  libraryProxy: string | null;
  setLibraryProxy: (v: string | null) => void;
  saveFile: SaveFile;
  sync: SyncEngine;
  syncFolder: SyncFolderAccess | null;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({
  repo, platform, saveFile = browserSaveFile, syncFolder = null, children,
}: { repo: BioRepo; platform: Platform; saveFile?: SaveFile; syncFolder?: SyncFolderAccess | null; children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [version, setVersion] = useState(0);
  const [theme, setThemeState] = useState<"light" | "dark">(
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  const openalex = useMemo(() => new OpenAlexClient((url, init) => fetch(url, init)), []);
  const [contactEmail, setContactState] = useState<string | null>(null);
  const [libraryProxy, setProxyState] = useState<string | null>(null);
  const emailRef = useRef<string | null>(null);
  const { sources, unpaywall, orcid, citations, semanticscholar } = useMemo(() => {
    const http = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => fetch(url, init);
    const email = () => emailRef.current;
    /**
     * Semantic Scholar y arXiv no permiten leer sus respuestas desde el navegador (CORS) y la primera
     * además limita las consultas seguidas. Cuando el programa se abre con el lanzador, sus consultas
     * las hace esta computadora con los puentes locales /api/s2 y /api/arxiv; si el puente no está
     * (modo desarrollo), se intenta directo.
     */
    const bridged: HttpGet = (url, init) => {
      const search = url.match(/^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/search\?(.*)$/);
      const paper = url.match(/^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/DOI:(.+?)(?:\?.*)?$/);
      const arxiv = url.match(/^https:\/\/export\.arxiv\.org\/api\/query\?(.*)$/);
      const local = search ? `/api/s2?${search[1]}` : paper ? `/api/s2?doi=${paper[1]}` : arxiv ? `/api/arxiv?${arxiv[1]}` : null;
      if (!local) return http(url, init);
      return (async () => {
        try {
          const r = await fetch(local, { signal: init?.signal });
          // Sin puente (p. ej. en modo desarrollo el servidor devuelve la página de la app)
          if (!(r.headers.get("content-type") ?? "").includes("text/html")) return r;
        } catch {
          /* sin puente: se intenta directo */
        }
        return http(url, init);
      })();
    };
    return {
      sources: {
        openalex: new OpenAlexSource(openalex),
        europepmc: new EuropePmcClient(http),
        pubmed: new PubMedClient(http, { email }),
        crossref: new CrossrefClient(http, { mailto: email }),
        doaj: new DoajClient(http),
        semanticscholar: new SemanticScholarSource(bridged),
        arxiv: new ArxivClient(bridged),
        openaire: new OpenaireClient(http),
      } satisfies Record<SearchSourceId, FreeSource>,
      unpaywall: new UnpaywallClient(http, { email }),
      orcid: new OrcidClient(http, { mailto: email }),
      citations: new CitationClient(http, { email }),
      semanticscholar: new SemanticScholarClient(bridged),
    };
  }, [openalex]);
  const setContactEmail = useCallback(
    (v: string | null) => {
      emailRef.current = v;
      setContactState(v);
      openalex.setMailto(v);
      void repo.setSetting("openalex_mailto", v ?? "");
    },
    [repo, openalex],
  );
  const setLibraryProxy = useCallback(
    (v: string | null) => {
      setProxyState(v);
      void repo.setSetting("library_proxy", v ?? "");
    },
    [repo],
  );
  const sync = useMemo(() => new SyncEngine(repo), [repo]);

  // Con identidad creada, la sincronización escucha los cambios de proyectos compartidos
  useEffect(() => {
    if (!identity) return;
    void sync.attach().catch((e) => console.error("Sincronización:", redact(e instanceof Error ? e.message : String(e))));
    return () => sync.detach();
  }, [identity, sync]);

  useEffect(() => {
    void repo.getIdentity().then(setIdentity);
    void repo.getSetting("openalex_mailto").then((m) => {
      emailRef.current = m || null;
      setContactState(m || null);
      openalex.setMailto(m || null);
    });
    void repo.getSetting("library_proxy").then((p) => setProxyState(p || null));
    void repo.getSetting("theme").then((t) => {
      if (t === "light" || t === "dark") setThemeState(t);
    });
  }, [repo, openalex]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback(
    (t: "light" | "dark") => {
      setThemeState(t);
      void repo.setSetting("theme", t);
    },
    [repo],
  );
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return <Ctx.Provider value={{ repo, platform, identity, version, refresh, setIdentity, theme, setTheme, openalex, sources, unpaywall, orcid, contactEmail, setContactEmail, libraryProxy, setLibraryProxy, saveFile, sync, syncFolder, citations, semanticscholar }}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp fuera de AppProvider");
  return c;
}

/** Carga datos asíncronos y recarga cuando cambian las dependencias o los datos. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean } {
  const { version } = useApp();
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: unknown) => alive && setState({ data: undefined, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return state;
}
