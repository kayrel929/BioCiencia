import { useState } from "react";
import { describeSmartRules, parseSmartRules, SMART_FIELDS, SMART_OP_LABEL, type SmartField, type SmartRule, type SmartRules } from "@biociencia/core";
import { WORK_TYPES } from "@biociencia/sources";
import type { Collection, SmartGroup } from "@biociencia/storage";
import { useApp } from "../context.tsx";
import { Dialog } from "./Pending.tsx";

const SOURCES: Record<string, string> = {
  europepmc: "Europe PMC", pubmed: "PubMed", crossref: "Crossref", doaj: "DOAJ", openalex: "OpenAlex", semanticscholar: "Semantic Scholar", arxiv: "arXiv", openaire: "OpenAIRE", orcid: "ORCID", manual: "Ingreso manual", import: "Importado",
};

/**
 * Crear o editar un grupo inteligente: reglas sobre los datos de la biblioteca.
 * `onClose(id)` devuelve el id guardado, null si se borró o undefined si se canceló.
 */
export function SmartGroupEditor({ group, tags, collections, onClose }: {
  group: SmartGroup | null;
  tags: string[];
  collections: Collection[];
  onClose: (id?: string | null) => void;
}) {
  const { repo } = useApp();
  const initial: SmartRules = group ? parseSmartRules(group.rules) : { match: "all", rules: [{ field: "year", op: "gte", value: String(new Date().getFullYear() - 5) }] };
  const [name, setName] = useState(group?.name ?? "");
  const [match, setMatch] = useState<SmartRules["match"]>(initial.match);
  const [rules, setRules] = useState<SmartRule[]>(initial.rules.length ? initial.rules : [{ field: "title", op: "contains", value: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const set = (i: number, r: Partial<SmartRule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...r } : x)));
  const choices = (f: SmartField): { value: string; label: string }[] => {
    if (f === "type") return Object.entries(WORK_TYPES).map(([value, label]) => ({ value, label }));
    if (f === "tag") return tags.map((t) => ({ value: t, label: t }));
    if (f === "collection") return collections.map((c) => ({ value: c.id, label: c.name }));
    if (f === "source") return Object.entries(SOURCES).map(([value, label]) => ({ value, label }));
    return [];
  };

  async function save() {
    setError(null);
    try {
      const id = await repo.saveSmartGroup({ id: group?.id, name, rules: { match, rules } });
      onClose(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog title={group ? "Editar grupo inteligente" : "Nuevo grupo inteligente"} onClose={() => onClose(undefined)} wide>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        Un grupo inteligente no guarda una lista fija: muestra siempre las publicaciones de su biblioteca que cumplen las reglas,
        incluidas las que agregue después.
      </p>
      <label className="bc-label" htmlFor="sg-name">Nombre</label>
      <input id="sg-name" className="bc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Trichoderma desde 2020 con PDF" autoFocus />
      <div className="bc-row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        Mostrar las publicaciones que cumplan
        <select className="bc-select" style={{ width: "auto" }} aria-label="Cómo combinar las reglas" value={match} onChange={(e) => setMatch(e.target.value as SmartRules["match"])}>
          <option value="all">todas las reglas</option>
          <option value="any">al menos una regla</option>
        </select>
      </div>
      <div style={{ marginTop: 8 }}>
        {rules.map((r, i) => {
          const f = SMART_FIELDS.find((x) => x.field === r.field)!;
          const opts = choices(r.field);
          return (
            <div key={i} className="bc-row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }} data-testid="smart-rule">
              <select className="bc-select" style={{ width: "auto" }} aria-label={`Campo de la regla ${i + 1}`} value={r.field} onChange={(e) => {
                const nf = SMART_FIELDS.find((x) => x.field === e.target.value)!;
                set(i, { field: nf.field, op: nf.ops[0]!, value: "" });
              }}>
                {SMART_FIELDS.map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
              </select>
              <select className="bc-select" style={{ width: "auto" }} aria-label={`Condición de la regla ${i + 1}`} value={r.op} onChange={(e) => set(i, { op: e.target.value as SmartRule["op"] })}>
                {f.ops.map((o) => <option key={o} value={o}>{SMART_OP_LABEL[o]}</option>)}
              </select>
              {f.kind === "bool" ? null : f.kind === "choice" ? (
                <select className="bc-select" style={{ width: "auto", minWidth: 160 }} aria-label={`Valor de la regla ${i + 1}`} value={r.value ?? ""} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Elegir…</option>
                  {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  className="bc-input"
                  style={{ width: f.kind === "text" ? 220 : 100 }}
                  aria-label={`Valor de la regla ${i + 1}`}
                  type={f.kind === "text" ? "text" : "number"}
                  min={f.kind === "days" ? 1 : undefined}
                  value={r.value ?? ""}
                  placeholder={f.kind === "text" ? 'palabras o "frase exacta"' : f.kind === "days" ? "días" : "año"}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
              )}
              {f.kind === "days" ? <span>días</span> : null}
              <button className="bc-btn bc-btn-sm bc-btn-ghost" aria-label={`Quitar regla ${i + 1}`} disabled={rules.length === 1} onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button>
            </div>
          );
        })}
        <button className="bc-btn bc-btn-sm" style={{ marginTop: 8 }} onClick={() => setRules([...rules, { field: "title", op: "contains", value: "" }])}>+ Añadir regla</button>
      </div>
      <div className="bc-alert" style={{ marginTop: 10, fontSize: "0.86rem" }}>
        <strong>Resumen:</strong> {describeSmartRules({ match, rules }, { collection: (id) => collections.find((c) => c.id === id)?.name ?? id, type: (t) => WORK_TYPES[t] ?? t }) || "complete al menos una regla"}
      </div>
      {error ? <div className="bc-alert bc-alert-error" role="status" style={{ marginTop: 8 }}>{error}</div> : null}
      <div className="bc-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
        {group ? (
          <button className="bc-btn bc-btn-danger" onClick={async () => {
            if (!armed) return setArmed(true);
            await repo.deleteSmartGroup(group.id);
            onClose(null);
          }}>{armed ? "¿Seguro? Clic otra vez" : "Borrar grupo"}</button>
        ) : <span />}
        <button className="bc-btn bc-btn-primary" onClick={() => void save()}>Guardar grupo</button>
      </div>
    </Dialog>
  );
}
