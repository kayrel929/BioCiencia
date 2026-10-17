import { useState } from "react";
import { useApp, useAsync } from "../context.tsx";
import { Icon } from "../components/Icon.tsx";
import { WorkItem } from "../components/WorkItem.tsx";
import { ManualWorkForm } from "../components/ManualWorkForm.tsx";
import { CiteButton, ExportButton, ImportDialog } from "../components/RefsIO.tsx";
import { CitationNetworkButton } from "../components/CitationNetwork.tsx";
import { FullTextButton } from "../components/FullText.tsx";
import { Dialog } from "../components/Pending.tsx";
import { PdfButton } from "../components/Pdf.tsx";
import { BibliographyButton } from "../components/Bibliography.tsx";
import { RetractionCheckButton } from "../components/Retractions.tsx";
import { SmartGroupEditor } from "../components/SmartGroups.tsx";
import { describeSmartRules, matchSmartGroup, parseSmartRules } from "@biociencia/core";
import { WORK_TYPES } from "@biociencia/sources";
import type { LibraryEntry, SmartGroup } from "@biociencia/storage";

export function Library() {
  const { repo, refresh } = useApp();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [own, setOwn] = useState(false);
  const ownIds = useAsync(() => repo.ownWorkIds(), []);
  const [tag, setTag] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibraryEntry | null>(null);
  const [groupId, setGroupId] = useState("");
  const [editingGroup, setEditingGroup] = useState<SmartGroup | "new" | null>(null);
  const groups = useAsync(() => repo.listSmartGroups(), []);
  const group = groups.data?.find((g) => g.id === groupId) ?? null;

  const filters = { text: query || undefined, favorite, own, tag: tag || undefined, collectionId: collectionId || undefined };
  /** Publicaciones de la vista actual (con el grupo inteligente aplicado, si hay uno) */
  async function viewEntries(limit?: number): Promise<LibraryEntry[]> {
    if (!group) return repo.listLibrary({ ...filters, limit });
    const rules = parseSmartRules(group.rules);
    const all = await repo.listLibrary({ ...filters, limit: 100000 });
    const now = Date.now();
    return all.filter((e) => matchSmartGroup(e, rules, now)).slice(0, limit ?? 500);
  }
  const entries = useAsync(() => viewEntries(), [query, favorite, own, tag, collectionId, groupId, group?.updatedAt]);
  const tags = useAsync(() => repo.allTags(), []);
  const collections = useAsync(() => repo.listCollections(), []);

  async function act(fn: () => Promise<unknown>) {
    await fn();
    refresh();
  }

  return (
    <div className="bc-page">
      <div className="bc-page-head">
        <div>
          <h1>Biblioteca</h1>
          <p className="bc-sub">Sus publicaciones guardadas. Disponible sin internet.</p>
        </div>
        <div className="bc-row">
          <button className="bc-btn" onClick={() => setNewCollection("")}>
            <Icon name="plus" /> Colección
          </button>
          <button className="bc-btn" onClick={() => setEditingGroup("new")} title="Colección que se llena sola según reglas">
            <Icon name="plus" /> Grupo inteligente
          </button>
          <button className="bc-btn" onClick={() => setImporting(true)}>Importar</button>
          <button className="bc-btn bc-btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Referencia manual
          </button>
        </div>
      </div>

      <div className="bc-card" style={{ marginBottom: 16 }}>
        <form
          className="bc-row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(text.trim());
          }}
        >
          <input className="bc-input" style={{ flex: 1, minWidth: 220 }} aria-label="Buscar en la biblioteca" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar por título, autor, resumen, revista o palabra clave" />
          <button className="bc-btn" type="submit">Buscar</button>
          <label className="bc-row" style={{ gap: 6 }}>
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} /> Favoritos
          </label>
          <label className="bc-row" style={{ gap: 6 }}>
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> Mis publicaciones
          </label>
          <select className="bc-select" style={{ width: "auto" }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Etiqueta">
            <option value="">Todas las etiquetas</option>
            {tags.data?.map((t) => (
              <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>
            ))}
          </select>
          <select className="bc-select" style={{ width: "auto" }} value={collectionId} onChange={(e) => setCollectionId(e.target.value)} aria-label="Colección">
            <option value="">Todas las colecciones</option>
            {collections.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.itemCount})</option>
            ))}
          </select>
          <select className="bc-select" style={{ width: "auto" }} value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Grupo inteligente">
            <option value="">Sin grupo inteligente</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>⚙ {g.name}</option>)}
          </select>
        </form>
        {group ? (
          <div className="bc-alert" style={{ marginTop: 10, fontSize: "0.86rem" }} data-testid="smart-group-info">
            <strong>Grupo inteligente «{group.name}»:</strong>{" "}
            {describeSmartRules(parseSmartRules(group.rules), { collection: (id) => collections.data?.find((c) => c.id === id)?.name ?? id, type: (t) => WORK_TYPES[t] ?? t }) || "sin reglas"}
            {" "}<button className="bc-link-btn" onClick={() => setEditingGroup(group)}>Editar</button>
          </div>
        ) : null}
        <div className="bc-row" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <span className="bc-sub" style={{ fontSize: "0.85rem" }}>{entries.data ? `${entries.data.length} publicación(es) en esta vista` : ""}</span>
          <div className="bc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <RetractionCheckButton />
            <BibliographyButton getWorks={async () => (await viewEntries(100000)).map((e) => e.work)} label="Bibliografía de esta vista" />
            <ExportButton
              baseName={group?.name || query || tag || "biblioteca"}
              label="Exportar esta vista"
              getWorks={async () => (await viewEntries(100000)).map((e) => e.work)}
            />
          </div>
        </div>
      </div>

      <div className="bc-card">
        {entries.error ? <div className="bc-alert bc-alert-error">{entries.error}</div> : null}
        {entries.data && entries.data.length === 0 ? (
          <div className="bc-empty">
            {query || favorite || own || tag || collectionId || group ? "Ninguna publicación coincide con los filtros." : "Su biblioteca está vacía. Guarde resultados desde el Buscador o añada una referencia manual."}
          </div>
        ) : null}
        {entries.data?.map((e) => (
          <WorkItem
            key={e.work.id}
            work={e.work}
            extra={
              <>
                {e.tags.length ? (
                  <div className="bc-work-tags">
                    {e.tags.map((t) => (
                      <span key={t} className="bc-badge bc-badge-blue">#{t}</span>
                    ))}
                  </div>
                ) : null}
                {e.notes ? <div className="bc-alert" style={{ marginTop: 8, fontSize: "0.88rem" }}>{e.notes}</div> : null}
              </>
            }
            actions={
              <>
                <PdfButton work={e.work} count={e.pdfCount} />
                <FullTextButton work={e.work} />
                <button
                  className="bc-btn bc-btn-sm"
                  aria-pressed={!!ownIds.data?.has(e.work.id!)}
                  title="Marcar como publicación propia"
                  onClick={() => act(() => repo.setOwnWork(e.work.id!, !ownIds.data?.has(e.work.id!)))}
                >
                  {ownIds.data?.has(e.work.id!) ? "✓ Mi publicación" : "Es mía"}
                </button>
                <CiteButton work={e.work} />
                <CitationNetworkButton work={e.work} />
                <button className="bc-btn bc-btn-sm" aria-pressed={e.favorite} onClick={() => act(() => repo.setFavorite(e.work.id!, !e.favorite))} title="Favorito">
                  <Icon name="star" size={15} filled={e.favorite} /> {e.favorite ? "Favorito" : "Marcar favorito"}
                </button>
                <button className="bc-btn bc-btn-sm" onClick={() => setEditing(e)}>Etiquetas y notas</button>
                <button className="bc-btn bc-btn-sm bc-btn-danger" onClick={() => act(() => repo.removeFromLibrary(e.work.id!))}>Quitar</button>
              </>
            }
          />
        ))}
      </div>

      {adding ? <ManualWorkForm onClose={() => setAdding(false)} /> : null}
      {editingGroup ? (
        <SmartGroupEditor
          group={editingGroup === "new" ? null : editingGroup}
          tags={tags.data?.map((t) => t.tag) ?? []}
          collections={collections.data ?? []}
          onClose={(id) => {
            setEditingGroup(null);
            if (id !== undefined) setGroupId(id ?? "");
            refresh();
          }}
        />
      ) : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}

      {newCollection !== null ? (
        <Dialog title="Nueva colección" onClose={() => setNewCollection(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newCollection.trim()) return;
              await repo.createCollection(newCollection.trim());
              setNewCollection(null);
              refresh();
            }}
          >
            <label className="bc-label" htmlFor="nc-name">Nombre</label>
            <input id="nc-name" className="bc-input" value={newCollection} onChange={(e) => setNewCollection(e.target.value)} autoFocus />
            <div className="bc-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="bc-btn bc-btn-primary" type="submit">Crear</button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {editing ? (
        <EntryEditor
          entry={editing}
          collections={collections.data ?? []}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function EntryEditor({
  entry,
  collections,
  onClose,
}: {
  entry: LibraryEntry;
  collections: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { repo } = useApp();
  const id = entry.work.id!;
  const [notes, setNotes] = useState(entry.notes);
  const [tags, setTags] = useState(entry.tags);
  const [newTag, setNewTag] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Dialog title="Organizar publicación" onClose={onClose}>
      <p className="bc-sub" style={{ fontWeight: 600 }}>{entry.work.title}</p>
      <label className="bc-label">Etiquetas</label>
      <div className="bc-work-tags" style={{ marginBottom: 8 }}>
        {tags.map((t) => (
          <button
            key={t}
            className="bc-badge bc-badge-blue"
            style={{ cursor: "pointer" }}
            title="Quitar etiqueta"
            onClick={async () => {
              await repo.removeTag(id, t);
              setTags(tags.filter((x) => x !== t));
            }}
          >
            #{t} ✕
          </button>
        ))}
      </div>
      <form
        className="bc-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const t = newTag.trim();
          if (!t) return;
          await repo.addTag(id, t);
          setTags([...new Set([...tags, t])].sort());
          setNewTag("");
        }}
      >
        <input className="bc-input" style={{ flex: 1 }} value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta" aria-label="Nueva etiqueta" />
        <button className="bc-btn" type="submit">Añadir</button>
      </form>

      <label className="bc-label" htmlFor="ee-notes">Observaciones</label>
      <textarea id="ee-notes" className="bc-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="bc-btn" style={{ marginTop: 8 }} onClick={async () => { await repo.setLibraryNotes(id, notes); setMsg("Observaciones guardadas."); }}>
        Guardar observaciones
      </button>

      <div className="bc-grid-2" style={{ marginTop: 12 }}>
        <div>
          <label className="bc-label">Añadir a colección</label>
          <select className="bc-select" defaultValue="" onChange={async (e) => { if (e.target.value) { await repo.addToCollection(e.target.value, id); setMsg("Añadida a la colección."); } }}>
            <option value="">Elegir…</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {msg ? <div className="bc-alert" style={{ marginTop: 12 }}>{msg}</div> : null}
      <div className="bc-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="bc-btn bc-btn-primary" onClick={onClose}>Listo</button>
      </div>
    </Dialog>
  );
}
