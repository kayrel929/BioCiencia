import { Fragment, useMemo, useState, type ReactNode } from "react";
import guide from "../../../../docs/GUIA_USUARIO.md?raw";

/**
 * Ayuda dentro de la aplicación: muestra docs/GUIA_USUARIO.md (la misma guía del repositorio).
 * Lector de Markdown mínimo que produce elementos de React (sin innerHTML): títulos, párrafos, listas,
 * tablas, bloques de código, citas, separadores, **negrita**, *cursiva*, `código` y enlaces https.
 */

type Node =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "code"; text: string }
  | { t: "quote"; text: string }
  | { t: "hr" };

export function parseGuide(md: string): Node[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Node[] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const buf: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) buf.push(lines[i]!);
      out.push({ t: "code", text: buf.join("\n") });
      i++;
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push({ t: "h", level: h[1]!.length, text: h[2]! }); i++; continue; }
    if (/^-{3,}\s*$/.test(l)) { out.push({ t: "hr" }); i++; continue; }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.startsWith("|"); i++) {
        const cells = lines[i]!.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      out.push({ t: "table", head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (l.startsWith(">")) {
      const buf: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i++) buf.push(lines[i]!.replace(/^>\s?/, ""));
      out.push({ t: "quote", text: buf.join(" ") });
      continue;
    }
    const isUl = (s: string) => /^\s*[-*]\s+/.test(s);
    const isOl = (s: string) => /^\s*\d+\.\s+/.test(s);
    if (isUl(l) || isOl(l)) {
      const ol = isOl(l);
      const items: string[] = [];
      for (; i < lines.length && (ol ? isOl(lines[i]!) : isUl(lines[i]!)) || (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && items.length); i++) {
        const s = lines[i]!;
        if (ol ? isOl(s) : isUl(s)) items.push(s.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        else items[items.length - 1] += "\n" + s.trim();
      }
      out.push(ol ? { t: "ol", items } : { t: "ul", items });
      continue;
    }
    const buf: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|\||>|-{3,}\s*$)/.test(lines[i]!) && !isUl(lines[i]!) && !isOl(lines[i]!); i++) buf.push(lines[i]!.trim());
    out.push({ t: "p", text: buf.join(" ") });
  }
  return out;
}

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|https:\/\/[^\s)]+)/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const s = m[0];
    const k = `${key}-${n++}`;
    if (s.startsWith("**")) out.push(<strong key={k}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith("`")) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (s.startsWith("https://")) {
      const url = s.replace(/[.,;:]+$/, "");
      out.push(<a key={k} href={url} target="_blank" rel="noreferrer">{url}</a>);
      if (url.length < s.length) out.push(s.slice(url.length));
    } else out.push(<em key={k}>{s.slice(1, -1)}</em>);
    last = m.index! + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function Help() {
  const nodes = useMemo(() => parseGuide(guide), []);
  const [q, setQ] = useState("");
  const sections = nodes.filter((n): n is Extract<Node, { t: "h" }> => n.t === "h" && n.level === 2);
  // Filtro: muestra solo las secciones que contienen el texto buscado
  const visible = useMemo(() => {
    if (!q.trim()) return nodes;
    const needle = q.toLowerCase();
    const groups: Node[][] = [[]];
    for (const n of nodes) {
      if (n.t === "h" && n.level === 2) groups.push([n]);
      else groups[groups.length - 1]!.push(n);
    }
    return groups.filter((g) => JSON.stringify(g).toLowerCase().includes(needle)).flat();
  }, [nodes, q]);

  return (
    <div className="bc-page bc-help">
      <div className="bc-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input className="bc-input" style={{ flex: 1, minWidth: 200 }} aria-label="Buscar en la ayuda" placeholder="Buscar en la ayuda (p. ej. «Ollama», «PRISMA», «copia»)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!q ? (
        <nav className="bc-card" aria-label="Contenido de la ayuda" style={{ fontSize: "0.9rem" }}>
          <strong>Contenido</strong>
          <ol style={{ margin: "6px 0 0", columns: 2 }}>
            {sections.map((s) => <li key={s.text}><a href={`#ayuda-${slug(s.text)}`} onClick={(e) => { e.preventDefault(); document.getElementById(`ayuda-${slug(s.text)}`)?.scrollIntoView(); }}>{s.text.replace(/^\d+\.\s*/, "")}</a></li>)}
          </ol>
        </nav>
      ) : null}
      <article className="bc-card" data-testid="help-content">
        {visible.length === 0 ? <p className="bc-empty">No hay resultados para «{q}».</p> : null}
        {visible.map((n, i) => {
          const k = String(i);
          switch (n.t) {
            case "h": {
              const Tag = (n.level === 1 ? "h1" : n.level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
              return <Tag key={k} id={n.level === 2 ? `ayuda-${slug(n.text)}` : undefined}>{inline(n.text, k)}</Tag>;
            }
            case "p": return <p key={k}>{inline(n.text, k)}</p>;
            case "ul": case "ol": {
              const Tag = n.t;
              return <Tag key={k}>{n.items.map((it, j) => <li key={j}>{it.split("\n").map((line, x) => <Fragment key={x}>{x ? <br /> : null}{inline(line, `${k}-${j}-${x}`)}</Fragment>)}</li>)}</Tag>;
            }
            case "table": return (
              <table key={k} className="bc-table" style={{ margin: "8px 0" }}>
                <thead><tr>{n.head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
                <tbody>{n.rows.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x}>{inline(c, `${k}-${j}-${x}`)}</td>)}</tr>)}</tbody>
              </table>
            );
            case "code": return <pre key={k} className="mono" style={{ background: "var(--bc-surface-2)", padding: 10, borderRadius: 6, overflowX: "auto" }}>{n.text}</pre>;
            case "quote": return <blockquote key={k} className="bc-alert" style={{ margin: "8px 0" }}>{inline(n.text, k)}</blockquote>;
            case "hr": return <hr key={k} style={{ border: 0, borderTop: "1px solid var(--bc-border)", margin: "16px 0" }} />;
          }
        })}
      </article>
    </div>
  );
}
