import { useEffect, useMemo, useState } from "react";
import { DOCX_MIME, manuscriptDocx, type Block, type Work } from "@biociencia/core";
import { formalAuthorRequest, lookupAuthorEmails, mailtoLink, type LetterLang, type RequesterProfile, type Salutation } from "@biociencia/sources";
import { articleRequestMessages, parseJsonLoose } from "@biociencia/ai";
import { useApp } from "../context.tsx";
import { useAiSetup } from "./Consensus.tsx";
import { Dialog } from "./Pending.tsx";

const PROFILE_KEY = "requester_profile";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Algunos programas de correo cortan los enlaces mailto muy largos */
const MAILTO_SAFE = 1900;

/** Cada línea de la carta es un párrafo; las líneas de la firma van juntas. */
function letterBlocks(body: string): Block[] {
  return body.split(/\n{2,}/).flatMap((para) => para.split("\n").filter((l) => l.trim()).map((l) => ({ type: "p" as const, runs: [{ text: l }] })));
}

/** Botón «Solicitar artículo completo»: abre la carta formal al autor. */
export function RequestArticleButton({ work, label = "Solicitar artículo completo" }: { work: Work; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="bc-btn bc-btn-sm" onClick={() => setOpen(true)} title="Carta formal al autor pidiendo una copia del artículo">
        {label}
      </button>
      {open ? <RequestArticleDialog work={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function RequestArticleDialog({ work, onClose }: { work: Work; onClose: () => void }) {
  const { repo, identity, contactEmail, saveFile } = useApp();
  const { provider } = useAiSetup();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSubject, setAiSubject] = useState<string | null>(null);
  const [profile, setProfile] = useState<RequesterProfile>({ name: identity?.displayName ?? "" });
  const [remember, setRemember] = useState(true);
  const [lang, setLang] = useState<LetterLang>("es");
  const [salutation, setSalutation] = useState<Salutation>("neutral");
  const [purpose, setPurpose] = useState("");
  const [noAccess, setNoAccess] = useState(true);
  const withEmail = work.authors.map((a, i) => ({ i, name: a.name, email: a.email ?? null })).filter((a) => a.email);
  const [recipientIdx, setRecipientIdx] = useState<number>(withEmail[withEmail.length - 1]?.i ?? 0);
  const [to, setTo] = useState(withEmail[withEmail.length - 1]?.email ?? "");
  const [found, setFound] = useState<{ name: string; email: string }[]>([]);
  const [lookup, setLookup] = useState<"idle" | "loading" | "none" | "error">("idle");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(true);

  // Datos del solicitante guardados en esta computadora
  useEffect(() => {
    void (async () => {
      const saved = await repo.getSetting(PROFILE_KEY);
      const orcid = await repo.getSetting("my_orcid");
      let p: RequesterProfile = { name: identity?.displayName ?? "" };
      try {
        if (saved) p = { ...p, ...(JSON.parse(saved) as RequesterProfile) };
      } catch {
        /* ajuste dañado: se ignora */
      }
      if (!p.email && contactEmail) p.email = contactEmail;
      if (!p.orcid && orcid) p.orcid = orcid;
      setProfile(p);
      setShowProfile(!p.institution || !p.email);
    })();
  }, [repo, identity, contactEmail]);

  const recipients = useMemo(() => {
    const list = work.authors.map((a, i) => ({ i, name: a.name, email: a.email ?? found.find((f) => f.name === a.name)?.email ?? null }));
    return list;
  }, [work.authors, found]);
  const recipient = recipients[recipientIdx] ?? null;

  const letter = useMemo(
    () => formalAuthorRequest(work, recipient ? { name: recipient.name } : null, profile, { lang, purpose, salutation, noAccess }),
    [work, recipient, profile, lang, purpose, salutation, noAccess],
  );
  useEffect(() => {
    if (!edited) setBody(letter.body);
  }, [letter, edited]);

  /** El asunto de IA se descarta si cambia la plantilla (idioma, destinatario…). */
  useEffect(() => {
    setAiSubject(null);
  }, [letter.subject]);

  const subject = aiSubject ?? letter.subject;

  /** Redacta la carta con la IA del usuario; siempre queda editable y revisable. */
  async function aiDraft() {
    if (!provider) return;
    setAiBusy(true);
    setMsg(null);
    try {
      const raw = await provider.chat(
        articleRequestMessages({
          work,
          requester: { name: profile.name ?? "", institution: profile.institution ?? "", position: profile.position ?? "", purpose },
          lang: lang === "en" ? "en" : "es",
        }),
        { json: true },
      );
      const parsed = parseJsonLoose(raw);
      const cuerpo = typeof parsed?.cuerpo === "string" ? parsed.cuerpo.trim() : "";
      const asunto = typeof parsed?.asunto === "string" ? parsed.asunto.trim() : "";
      if (!cuerpo) throw new Error("La IA no devolvió una carta utilizable; pruebe otra vez.");
      setEdited(true); // evita que la plantilla borre el texto de la IA
      setBody(cuerpo);
      if (asunto) setAiSubject(asunto);
      setMsg("Carta propuesta por su IA. Revísela y corríjala a su gusto antes de enviarla.");
    } catch (e) {
      setMsg(`No se pudo redactar con IA: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function findEmails() {
    setLookup("loading");
    setLookupError(null);
    try {
      const r = await lookupAuthorEmails((u, i) => fetch(u, i), work);
      setFound(r);
      setLookup(r.length ? "idle" : "none");
      const last = r[r.length - 1];
      if (last) {
        const idx = work.authors.findIndex((a) => a.name === last.name);
        if (idx >= 0) setRecipientIdx(idx);
        setTo(last.email);
      }
    } catch (e) {
      setLookup("error");
      setLookupError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveProfile() {
    if (remember) await repo.setSetting(PROFILE_KEY, JSON.stringify(profile));
  }

  const validTo = EMAIL_RE.test(to.trim());
  const href = validTo ? mailtoLink(to.trim(), subject, body) : undefined;
  const tooLong = (href?.length ?? 0) > MAILTO_SAFE;
  const field = (k: keyof RequesterProfile, label: string, placeholder = "") => (
    <div>
      <label className="bc-label" htmlFor={`rq-${k}`}>{label}</label>
      <input id={`rq-${k}`} className="bc-input" value={profile[k] ?? ""} placeholder={placeholder} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
    </div>
  );

  return (
    <Dialog title="Solicitar el artículo completo al autor" onClose={onClose} wide>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        Carta formal para pedir al autor una copia del artículo para uso académico. Es una vía legal y habitual: muchos autores la envían con gusto.
        BioCiencia no envía nada por su cuenta; usted revisa el texto y lo envía desde su correo.
      </p>
      <div className="bc-alert" style={{ fontSize: "0.88rem" }}><strong>{work.title}</strong></div>

      <h3 style={{ fontSize: "0.95rem", margin: "12px 0 4px" }}>Destinatario</h3>
      <div className="bc-grid-2">
        <div>
          <label className="bc-label" htmlFor="rq-author">Autor</label>
          <select id="rq-author" className="bc-select" value={recipientIdx} onChange={(e) => {
            const i = Number(e.target.value);
            setRecipientIdx(i);
            const em = recipients[i]?.email;
            if (em) setTo(em);
          }}>
            {recipients.map((r) => <option key={r.i} value={r.i}>{r.name}{r.email ? ` — ${r.email}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="bc-label" htmlFor="rq-to">Correo del autor</label>
          <input id="rq-to" className="bc-input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="autor@universidad.edu" />
        </div>
      </div>
      <div className="bc-row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap", fontSize: "0.85rem" }}>
        {work.doi || work.pmid ? (
          <button type="button" className="bc-btn bc-btn-sm" onClick={() => void findEmails()} disabled={lookup === "loading"}>
            {lookup === "loading" ? "Buscando…" : "Buscar correo del autor"}
          </button>
        ) : null}
        {lookup === "none" ? <span role="status" className="bc-sub">Europe PMC no publica el correo de los autores de este artículo. Búsquelo en la página del artículo («Abrir artículo»), donde suele figurar el autor de correspondencia.</span> : null}
        {lookup === "error" ? <span role="status" className="bc-sub">No se pudo consultar Europe PMC: {lookupError}</span> : null}
        {found.length ? <span role="status" className="bc-sub">Correos encontrados en Europe PMC: {found.map((f) => `${f.name} (${f.email})`).join("; ")}</span> : null}
      </div>

      <h3 style={{ fontSize: "0.95rem", margin: "12px 0 4px" }}>Carta</h3>
      {!(profile.email ?? "").trim() ? (
        <div className="bc-alert bc-alert-warn" role="status" style={{ fontSize: "0.82rem", marginBottom: 8 }}>
          Su carta todavía no incluye un correo de contacto. Añádalo abajo en «Mis datos para la firma» (o en Investigadores → «Mis datos de contacto»)
          para que el autor sepa quién le escribe y pueda responderle.
        </div>
      ) : null}
      <div className="bc-grid-2">
        <div>
          <label className="bc-label" htmlFor="rq-lang">Idioma</label>
          <select id="rq-lang" className="bc-select" value={lang} onChange={(e) => setLang(e.target.value as LetterLang)}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="es-en">Español e inglés</option>
          </select>
        </div>
        <div>
          <label className="bc-label" htmlFor="rq-sal">Tratamiento (en español)</label>
          <select id="rq-sal" className="bc-select" value={salutation} onChange={(e) => setSalutation(e.target.value as Salutation)}>
            <option value="neutral">Estimado(a) Dr(a).</option>
            <option value="m">Estimado Dr.</option>
            <option value="f">Estimada Dra.</option>
          </select>
        </div>
      </div>
      <label className="bc-label" htmlFor="rq-purpose">Para qué lo necesita (opcional)</label>
      <input id="rq-purpose" className="bc-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="p. ej. el estudio que desarrollo sobre la pudrición de mazorca en maíz" />
      <label className="bc-row" style={{ gap: 6, marginTop: 6, fontSize: "0.88rem" }}>
        <input type="checkbox" checked={noAccess} onChange={(e) => setNoAccess(e.target.checked)} /> Indicar que mi institución no tiene acceso a la publicación
      </label>
      {provider ? (
        <div className="bc-row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" className="bc-btn bc-btn-sm" data-testid="ai-letter" disabled={aiBusy} onClick={() => void aiDraft()}>
            {aiBusy ? "La IA está redactando…" : "✨ Redactar con IA"}
          </button>
          <span className="bc-sub" style={{ fontSize: "0.78rem" }}>Propone una carta personalizada con su IA ({provider.label}); usted la revisa antes de enviarla.</span>
        </div>
      ) : null}

      <details style={{ marginTop: 10 }} open={showProfile} onToggle={(e) => setShowProfile((e.currentTarget as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.92rem" }}>Mis datos para la firma</summary>
        <div className="bc-grid-2" style={{ marginTop: 6 }}>
          {field("title", "Tratamiento o grado", "Dr., Ing., M. Sc.")}
          {field("name", "Nombre completo")}
          {field("position", "Cargo", "Investigador agropecuario")}
          {field("institution", "Institución", "Universidad, instituto o empresa")}
          {field("email", "Correo")}
          {field("orcid", "ORCID", "0000-0000-0000-0000")}
          {field("phone", "Teléfono (opcional)")}
        </div>
        <label className="bc-row" style={{ gap: 6, marginTop: 6, fontSize: "0.85rem" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Recordar mis datos en esta computadora
        </label>
      </details>

      <label className="bc-label" htmlFor="rq-subject" style={{ marginTop: 10 }}>Asunto</label>
      <input id="rq-subject" className="bc-input" readOnly value={subject} />
      <label className="bc-label" htmlFor="rq-body">Texto de la carta (puede editarlo)</label>
      <textarea id="rq-body" className="bc-textarea" style={{ minHeight: 300, fontSize: "0.88rem" }} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
      {edited ? (
        <button type="button" className="bc-link-btn" onClick={() => { setEdited(false); setAiSubject(null); setBody(letter.body); }}>Volver al texto generado (se pierden sus cambios)</button>
      ) : null}
      {tooLong ? <div className="bc-sub" style={{ fontSize: "0.8rem", marginTop: 4 }}>La carta es larga: algunos programas de correo la cortan al abrirla. Si ocurre, use «Copiar carta» y péguela en el mensaje.</div> : null}
      {msg ? <div className="bc-alert" role="status" style={{ marginTop: 8 }}>{msg}</div> : null}

      <div className="bc-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="bc-btn" onClick={async () => {
          await saveProfile();
          const ok = await saveFile(`Solicitud de articulo - ${work.title.slice(0, 50).replace(/[\\/:*?"<>|]/g, "")}.docx`, manuscriptDocx({ title: subject, layout: "letter", lang: lang === "en" ? "en-US" : "es-ES", blocks: letterBlocks(body) }), DOCX_MIME);
          if (ok) setMsg("Carta guardada como documento Word.");
        }}>Descargar carta (Word)</button>
        <button type="button" className="bc-btn" onClick={async () => {
          await saveProfile();
          try {
            await navigator.clipboard.writeText(`${subject}\n\n${body}`);
            setMsg("Asunto y carta copiados. Péguelos en su correo.");
          } catch {
            setMsg("El navegador no permitió copiar. Seleccione el texto y cópielo con Ctrl+C.");
          }
        }}>Copiar carta</button>
        <a className={`bc-btn bc-btn-primary ${validTo ? "" : "bc-disabled"}`} aria-disabled={!validTo} href={href} onClick={() => void saveProfile()}>
          Abrir en mi correo
        </a>
      </div>
    </Dialog>
  );
}
