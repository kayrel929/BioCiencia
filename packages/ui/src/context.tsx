import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BioRepo, Identity } from "@biociencia/storage";
import { CrossrefClient, DoajClient, EuropePmcClient, OpenAlexClient, OpenAlexSource, OrcidClient, PubMedClient, UnpaywallClient, type FreeSource } from "@biociencia/sources";
import { SyncEngine, type SyncTransport } from "@biociencia/sync";

export type Platform = "desktop" | "web";

/** Guarda un archivo generado por la app. Devuelve false si el usuario canceló. */
export type SaveFile = (fileName: string, content: string, mime: string) => Promise<boolean>;

/** Implementación web: descarga del navegador. */
export const browserSaveFile: SaveFile = async (fileName, content, mime) => {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
};

export type SearchSourceId = "openalex" | "europepmc" | "pubmed" | "crossref" | "doaj";

/** Acceso a una carpeta de sincronización (solo en la aplicación de Windows). */
export interface SyncFolderAccess {
  /** Abre el diálogo para elegir la carpeta. Devuelve null si el usuario cancela. */
  pick(): Promise<string | null>;
  transport(root: string): SyncTransport;
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
  const { sources, unpaywall, orcid } = useMemo(() => {
    const http = (url: string, init?: RequestInit) => fetch(url, init);
    const email = () => emailRef.current;
    return {
      sources: {
        openalex: new OpenAlexSource(openalex),
        europepmc: new EuropePmcClient(http),
        pubmed: new PubMedClient(http, { email }),
        crossref: new CrossrefClient(http, { mailto: email }),
        doaj: new DoajClient(http),
      } satisfies Record<SearchSourceId, FreeSource>,
      unpaywall: new UnpaywallClient(http, { email }),
      orcid: new OrcidClient(http, { mailto: email }),
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
    void sync.attach().catch((e) => console.error("Sincronización:", e instanceof Error ? e.message : e));
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

  return <Ctx.Provider value={{ repo, platform, identity, version, refresh, setIdentity, theme, setTheme, openalex, sources, unpaywall, orcid, contactEmail, setContactEmail, libraryProxy, setLibraryProxy, saveFile, sync, syncFolder }}>{children}</Ctx.Provider>;
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
