/** Aviso honesto para módulos que todavía no están implementados. */
export function Pending({ phase, title, items }: { phase: number; title: string; items: string[] }) {
  return (
    <div className="bc-phase" data-testid="pending">
      <span className="bc-badge bc-badge-warn">Pendiente · Fase {phase}</span>
      <h2 style={{ marginTop: 10 }}>{title}</h2>
      <p className="bc-sub">Este módulo aún no está implementado. Cuando llegue su fase incluirá:</p>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="bc-dialog-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bc-card bc-dialog" role="dialog" aria-label={title}>
        <div className="bc-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="bc-btn bc-btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
