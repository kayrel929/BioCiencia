import { useEffect, useState } from "react";
import type { Work } from "@biociencia/core";
import type { OaInfo } from "@biociencia/sources";
import { useApp } from "../context.tsx";
import { useLang } from "../i18n.tsx";
import { attachPdfFile } from "./Pdf.tsx";

/**
 * Acceso abierto automático (Unpaywall).
 * Muestra la etiqueta «Acceso abierto» en cuanto sabe que hay copia legal gratuita y,
 * cuando existe, ofrece abrir el PDF o guardarlo en la biblioteca con un clic.
 * Solo consulta Unpaywall cuando la fuente no lo dijo ya y hay correo de contacto configurado.
 */

function fileNameFor(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${s || "articulo"}.pdf`;
}

export function OpenAccess({ work, workId, auto = false }: { work: Work; workId?: string; auto?: boolean }) {
  const { unpaywall, contactEmail, repo, refresh } = useApp();
  const { t } = useLang();
  const [info, setInfo] = useState<OaInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const id = workId ?? work.id;
  const sourceSaysOa = work.isOpenAccess === true;
  const needsCheck = auto && !sourceSaysOa && !!work.doi && !!contactEmail;

  useEffect(() => {
    if (!needsCheck) return;
    let alive = true;
    setChecking(true);
    unpaywall
      .lookup(work.doi!)
      .then((i) => {
        if (alive) setInfo(i);
      })
      .catch(() => {
        /* sin conexión o sin correo: se ignora en silencio */
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [needsCheck, work.doi, unpaywall]);

  const isOa = sourceSaysOa || info?.isOa === true;
  const pdfUrl = info?.best?.pdfUrl ?? null;
  const linkUrl = info?.best?.url ?? null;

  async function download() {
    if (!id || !pdfUrl) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(String(res.status));
      const bytes = new Uint8Array(await res.arrayBuffer());
      const file = new File([bytes], fileNameFor(work.title), { type: "application/pdf" });
      await attachPdfFile(repo, id, file);
      refresh();
      setMsg(t("oa.saved"));
    } catch {
      // El sitio no permite la descarga automática (o el navegador la bloquea): se avisa y se usa el enlace.
      setMsg(t("oa.failed"));
    } finally {
      setSaving(false);
    }
  }

  if (!isOa) {
    return checking ? (
      <span className="bc-badge" title={t("oa.checking")}>
        ···
      </span>
    ) : null;
  }

  return (
    <>
      <span className="bc-badge bc-badge-green">{t("wi.openAccess")}</span>
      {linkUrl ? (
        <a className="bc-badge bc-badge-blue" href={linkUrl} target="_blank" rel="noreferrer" title={t("oa.pdfFreeTip")}>
          {t("oa.pdfFree")}
        </a>
      ) : null}
      {id && pdfUrl ? (
        <button type="button" className="bc-btn bc-btn-sm" onClick={() => void download()} disabled={saving} title={t("oa.downloadTip")}>
          {saving ? t("oa.saving") : t("oa.download")}
        </button>
      ) : null}
      {msg ? (
        <span className="bc-sub" style={{ fontSize: "0.78rem" }}>
          {msg}
        </span>
      ) : null}
    </>
  );
}
