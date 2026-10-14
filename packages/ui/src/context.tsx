import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BioRepo, Identity } from "@biociencia/storage";
import { OpenAlexClient } from "@biociencia/sources";

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
  saveFile: SaveFile;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ repo, platform, saveFile = browserSaveFile, children }: { repo: BioRepo; platform: Platform; saveFile?: SaveFile; children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [version, setVersion] = useState(0);
  const [theme, setThemeState] = useState<"light" | "dark">(
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  const openalex = useMemo(() => new OpenAlexClient((url, init) => fetch(url, init)), []);

  useEffect(() => {
    void repo.getIdentity().then(setIdentity);
    void repo.getSetting("openalex_mailto").then((m) => openalex.setMailto(m || null));
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

  return <Ctx.Provider value={{ repo, platform, identity, version, refresh, setIdentity, theme, setTheme, openalex, saveFile }}>{children}</Ctx.Provider>;
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
