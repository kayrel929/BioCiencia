import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Work } from "@biociencia/core";
import type { Annotation, AnnotationColor, Attachment } from "@biociencia/storage";
import { MAX_PDF_BYTES } from "@biociencia/storage";
import { useApp, useAsync } from "../context.tsx";
import { base64ToBytes, bytesToBase64, extractPdf, isPdf, loadPdfJs, openPdf, pageTexts, sha256OfBytes } from "../pdf.ts";
import { Dialog } from "./Pending.tsx";

export const COLORS: { id: AnnotationColor; label: string; css: string }[] = [
  { id: "amarillo", label: "Amarillo", css: "rgba(255, 214, 0, 0.42)" },
  { id: "verde", label: "Verde", css: "rgba(46, 184, 92, 0.38)" },
  { id: "azul", label: "Azul", css: "rgba(56, 132, 255, 0.34)" },
  { id: "rosado", label: "Rosado", css: "rgba(255, 92, 160, 0.36)" },
];
const colorCss = (c: AnnotationColor) => COLORS.find((x) => x.id === c)?.css ?? COLORS[0]!.css;

const mb = (n: number) => `${(n / 1048576).toFixed(n < 1048576 ? 2 : 1)} MB`;

/** Lee un archivo elegido por el usuario y lo adjunta a la publicación. */
export async function attachPdfFile(repo: ReturnType<typeof useApp>["repo"], workId: string, file: File): Promise<{ id: string; duplicate: boolean; pages: number }> {
  if (file.size > MAX_PDF_BYTES) throw new Error(`«${file.name}» pesa ${mb(file.size)}; el máximo es ${MAX_PDF_BYTES / 1048576} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) throw new Error(`«${file.name}» no es un archivo PDF.`);
  let pages = 0;
  let text = "";
  try {
    const r = await extractPdf(bytes);
    pages = r.pages;
    text = r.text;
  } catch (e) {
    throw new Error(`No se pudo leer «${file.name}» (¿PDF dañado o protegido con contraseña?): ${e instanceof Error ? e.message : String(e)}`);
  }
  const r = await repo.addAttachment({ workId, filename: file.name, base64: bytesToBase64(bytes), size: bytes.length, sha256: await sha256OfBytes(bytes), pages, text });
  return { ...r, pages };
}

/** Botón «PDF» de cada publicación de la biblioteca. */
export function PdfButton({ work, count }: { work: Work; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="bc-btn bc-btn-sm" onClick={() => setOpen(true)} title="Adjuntar, leer y subrayar el PDF">
        {count ? `PDF (${count})` : "Adjuntar PDF"}
      </button>
      {open ? <PdfManager work={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function PdfManager({ work, onClose }: { work: Work; onClose: () => void }) {
  const { repo, refresh } = useApp();
  const [tick, setTick] = useState(0);
  const list = useAsync(() => repo.listAttachments(work.id!), [tick]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [drag, setDrag] = useState(false);

  async function add(files: FileList | File[]) {
    setMsg(null);
    for (const f of Array.from(files)) {
      setBusy(`Leyendo «${f.name}»…`);
      try {
        const r = await attachPdfFile(repo, work.id!, f);
        setMsg({ error: false, text: r.duplicate ? `«${f.name}» ya estaba adjunto.` : `«${f.name}» adjuntado (${r.pages} páginas). Su texto ya se puede buscar en la biblioteca.` });
      } catch (e) {
        setMsg({ error: true, text: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(null);
    setTick((t) => t + 1);
    refresh();
  }

  if (viewing) return <PdfViewer work={work} attachment={viewing} onClose={() => { setViewing(null); setTick((t) => t + 1); }} />;
  return (
    <Dialog title="PDF de la publicación" onClose={() => { refresh(); onClose(); }}>
      <p className="bc-sub" style={{ fontWeight: 600, marginTop: 0 }}>{work.title}</p>
      <div
        className={`bc-dropzone ${drag ? "bc-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files); }}
      >
        <label className="bc-btn bc-btn-primary" style={{ cursor: "pointer" }}>
          Elegir PDF…
          <input type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Elegir archivo PDF" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
        </label>
        <span className="bc-sub" style={{ fontSize: "0.85rem" }}>o arrástrelo aquí. Se guarda en esta computadora (máximo {MAX_PDF_BYTES / 1048576} MB).</span>
      </div>
      {busy ? <div className="bc-alert" role="status" style={{ marginTop: 8 }}>{busy}</div> : null}
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 8 }}>{msg.text}</div> : null}
      <div style={{ marginTop: 10 }}>
        {list.data?.length === 0 ? <p className="bc-empty" style={{ padding: 12 }}>Esta publicación aún no tiene PDF.</p> : null}
        {list.data?.map((a) => (
          <div key={a.id} className="bc-row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--bc-border)", padding: "8px 0", gap: 8 }} data-testid="pdf-attachment">
            <div>
              <div style={{ fontWeight: 600 }}>{a.filename}</div>
              <div className="bc-work-meta">{a.pages ?? "?"} páginas · {mb(a.size)} · {a.annotationCount} subrayado(s)</div>
            </div>
            <div className="bc-row" style={{ gap: 6 }}>
              <button className="bc-btn bc-btn-sm bc-btn-primary" onClick={() => setViewing(a)}>Leer y subrayar</button>
              <DownloadAttachment attachment={a} />
              <ConfirmButton label="Quitar" onConfirm={async () => { await repo.deleteAttachment(a.id); setTick((t) => t + 1); }} />
            </div>
          </div>
        ))}
      </div>
      <p className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 10 }}>
        Use solo PDF que tenga derecho a guardar (acceso abierto, de su biblioteca institucional o enviados por el autor).
      </p>
    </Dialog>
  );
}

/** Botón que pide un segundo clic para confirmar (sin ventanas emergentes del navegador). */
export function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> | void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className="bc-btn bc-btn-sm bc-btn-danger" onClick={() => (armed ? void onConfirm() : setArmed(true))}>
      {armed ? "¿Seguro? Clic otra vez" : label}
    </button>
  );
}

function DownloadAttachment({ attachment }: { attachment: Attachment }) {
  const { repo, saveFile } = useApp();
  return (
    <button className="bc-btn bc-btn-sm" onClick={async () => {
      const b64 = await repo.attachmentData(attachment.id);
      if (b64) await saveFile(attachment.filename, base64ToBytes(b64), "application/pdf");
    }}>Guardar copia</button>
  );
}

type Rect = { x: number; y: number; w: number; h: number };

/** Une los rectángulos de una selección que están en la misma línea. */
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].filter((r) => r.w > 0.001 && r.h > 0.001).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x <= last.x + last.w + 0.01) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = right - last.x;
      last.y = top;
      last.h = bottom - top;
    } else out.push({ ...r });
  }
  return out;
}

export function PdfViewer({ work, attachment, onClose }: { work: Work; attachment: Attachment; onClose: () => void }) {
  const { repo } = useApp();
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof openPdf>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [color, setColor] = useState<AnnotationColor>("amarillo");
  const [annots, setAnnots] = useState<Annotation[]>([]);
  const [pending, setPending] = useState<{ rects: Rect[]; quote: string; x: number; y: number } | null>(null);
  const [find, setFind] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const texts = useAsync(async () => pageTexts(await repo.attachmentText(work.id!)), []);

  const reload = useCallback(async () => setAnnots(await repo.listAnnotations(attachment.id)), [repo, attachment.id]);

  useEffect(() => {
    let cancelled = false;
    let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
    void (async () => {
      try {
        const b64 = await repo.attachmentData(attachment.id);
        if (!b64) throw new Error("No se encontró el archivo.");
        opened = await openPdf(base64ToBytes(b64));
        if (!cancelled) setDoc(opened);
        await reload();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [repo, attachment.id, reload]);

  // Dibuja la página y su capa de texto (para seleccionar)
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    void (async () => {
      const pdfjs = await loadPdfJs();
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ w: viewport.width, h: viewport.height });
      const render = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = render;
      const layer = textRef.current!;
      layer.replaceChildren();
      layer.style.setProperty("--scale-factor", String(zoom));
      layer.style.setProperty("--total-scale-factor", String(zoom));
      layer.style.setProperty("--user-unit", "1");
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      try {
        await Promise.all([render.promise, tl.render()]);
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setPageNum((p) => Math.min(p + 1, doc?.numPages ?? p));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setPageNum((p) => Math.max(p - 1, 1));
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, onClose]);

  function onSelect() {
    const sel = window.getSelection();
    const box = pageRef.current?.getBoundingClientRect();
    if (!sel || sel.isCollapsed || !box || !textRef.current?.contains(sel.anchorNode)) return setPending(null);
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote) return setPending(null);
    const rects = mergeRects(
      [...sel.getRangeAt(0).getClientRects()].map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height })),
    );
    const last = rects[rects.length - 1];
    setPending({ rects, quote, x: last ? (last.x + last.w) * box.width : 0, y: last ? (last.y + last.h) * box.height + 4 : 0 });
  }

  async function highlight(withNote: boolean) {
    if (!pending) return;
    const id = await repo.addAnnotation({ attachmentId: attachment.id, page: pageNum, rects: pending.rects, quote: pending.quote, note: "", color });
    window.getSelection()?.removeAllRanges();
    setPending(null);
    await reload();
    if (withNote) setTimeout(() => document.getElementById(`nota-${id}`)?.focus(), 50);
  }

  const hits = useMemo(() => {
    const q = find.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (q.length < 2 || !texts.data) return [];
    return texts.data.map((t, i) => ({ page: i + 1, n: t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(q).length - 1 })).filter((h) => h.n > 0);
  }, [find, texts.data]);

  const pageAnnots = annots.filter((a) => a.page === pageNum);
  const exportText = () =>
    [`Subrayados de: ${work.title}${work.year ? ` (${work.year})` : ""}${work.doi ? ` https://doi.org/${work.doi}` : ""}`, "",
      ...annots.map((a) => `p. ${a.page} — «${a.quote}»${a.note ? `\n   Nota: ${a.note}` : ""}`)].join("\n");

  return (
    <div className="bc-pdf" role="dialog" aria-label={`PDF: ${attachment.filename}`} aria-modal="true">
      <div className="bc-pdf-bar">
        <button className="bc-btn bc-btn-sm" onClick={onClose}>← Volver</button>
        <strong className="bc-pdf-name" title={attachment.filename}>{attachment.filename}</strong>
        <div className="bc-row" style={{ gap: 4 }}>
          <button className="bc-btn bc-btn-sm" aria-label="Página anterior" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>‹</button>
          <span aria-live="polite" data-testid="pdf-page">Página {pageNum} de {doc?.numPages ?? "…"}</span>
          <button className="bc-btn bc-btn-sm" aria-label="Página siguiente" disabled={!doc || pageNum >= doc.numPages} onClick={() => setPageNum(pageNum + 1)}>›</button>
        </div>
        <div className="bc-row" style={{ gap: 4 }}>
          <button className="bc-btn bc-btn-sm" aria-label="Alejar" onClick={() => setZoom(Math.max(0.5, +(zoom - 0.25).toFixed(2)))}>−</button>
          <span>{Math.round(zoom * 100)} %</span>
          <button className="bc-btn bc-btn-sm" aria-label="Acercar" onClick={() => setZoom(Math.min(3, +(zoom + 0.25).toFixed(2)))}>+</button>
        </div>
        <div className="bc-row" style={{ gap: 4 }} role="radiogroup" aria-label="Color del subrayado">
          {COLORS.map((c) => (
            <button key={c.id} role="radio" aria-checked={color === c.id} aria-label={c.label} title={c.label} className={`bc-swatch ${color === c.id ? "on" : ""}`} style={{ background: c.css }} onClick={() => setColor(c.id)} />
          ))}
        </div>
      </div>
      <div className="bc-pdf-body">
        <div className="bc-pdf-scroll">
          {error ? <div className="bc-alert bc-alert-error" role="status">No se pudo mostrar el PDF: {error}</div> : null}
          <div ref={pageRef} className="bc-pdf-page" style={{ width: size.w || undefined, height: size.h || undefined }} onMouseUp={onSelect}>
            <canvas ref={canvasRef} />
            <div className="bc-pdf-marks" aria-hidden="true">
              {pageAnnots.flatMap((a) => a.rects.map((r, i) => (
                <div key={`${a.id}-${i}`} className="bc-mark" title={a.note || a.quote} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: colorCss(a.color) }} />
              )))}
            </div>
            <div ref={textRef} className="textLayer" data-testid="pdf-text" />
            {pending ? (
              <div className="bc-pdf-pop" style={{ left: Math.min(pending.x, size.w - 230), top: pending.y }} onMouseUp={(e) => e.stopPropagation()}>
                <button className="bc-btn bc-btn-sm bc-btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void highlight(false)}>Subrayar</button>
                <button className="bc-btn bc-btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void highlight(true)}>Subrayar y anotar</button>
              </div>
            ) : null}
          </div>
        </div>
        <aside className="bc-pdf-side" aria-label="Subrayados y notas">
          <input className="bc-input" aria-label="Buscar en el PDF" placeholder="Buscar en el PDF" value={find} onChange={(e) => setFind(e.target.value)} />
          {find.trim().length >= 2 ? (
            <div className="bc-work-meta" style={{ margin: "6px 0" }} role="status">
              {hits.length ? <>Aparece en: {hits.map((h) => <button key={h.page} className="bc-link-btn" onClick={() => setPageNum(h.page)}>p. {h.page} ({h.n})</button>)}</> : "No aparece en el texto del PDF."}
            </div>
          ) : null}
          <div className="bc-row" style={{ justifyContent: "space-between", margin: "10px 0 4px" }}>
            <strong>Subrayados ({annots.length})</strong>
          </div>
          <p className="bc-sub" style={{ fontSize: "0.78rem", margin: 0 }}>Seleccione texto en la página con el ratón y elija «Subrayar».</p>
          {annots.length ? (
            <div className="bc-row" style={{ gap: 6, margin: "6px 0", flexWrap: "wrap" }}>
              <button className="bc-btn bc-btn-sm" onClick={async () => {
                try { await navigator.clipboard.writeText(exportText()); setMsg("Subrayados copiados."); } catch { setMsg("El navegador no permitió copiar."); }
              }}>Copiar todo</button>
              <button className="bc-btn bc-btn-sm" onClick={async () => {
                await repo.appendLibraryNotes(work.id!, exportText());
                setMsg("Añadidos a las observaciones de la publicación.");
              }}>Pasar a observaciones</button>
            </div>
          ) : null}
          {msg ? <div className="bc-alert" role="status" style={{ fontSize: "0.85rem" }}>{msg}</div> : null}
          <ol className="bc-annots">
            {annots.map((a) => (
              <li key={a.id} data-testid="annotation" className={a.page === pageNum ? "here" : ""}>
                <div className="bc-row" style={{ gap: 6, justifyContent: "space-between" }}>
                  <button className="bc-link-btn" onClick={() => setPageNum(a.page)}>p. {a.page}</button>
                  <span className="bc-row" style={{ gap: 3 }}>
                    {COLORS.map((c) => (
                      <button key={c.id} aria-label={`Color ${c.label}`} className={`bc-swatch bc-swatch-sm ${a.color === c.id ? "on" : ""}`} style={{ background: c.css }} onClick={async () => { await repo.updateAnnotation(a.id, { color: c.id }); await reload(); }} />
                    ))}
                    <button className="bc-link-btn" aria-label="Borrar subrayado" onClick={async () => { await repo.deleteAnnotation(a.id); await reload(); }}>Borrar</button>
                  </span>
                </div>
                <blockquote style={{ borderLeft: `4px solid ${colorCss(a.color)}` }}>{a.quote}</blockquote>
                <textarea
                  id={`nota-${a.id}`}
                  className="bc-textarea"
                  aria-label="Nota del subrayado"
                  placeholder="Nota…"
                  defaultValue={a.note}
                  style={{ minHeight: 44, fontSize: "0.85rem" }}
                  onBlur={async (e) => { if (e.target.value !== a.note) { await repo.updateAnnotation(a.id, { note: e.target.value }); await reload(); } }}
                />
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
