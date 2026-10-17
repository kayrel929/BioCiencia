/** Diálogo reutilizable (modal) de BioCiencia. */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="bc-dialog-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bc-card bc-dialog ${wide ? "bc-dialog-wide" : ""}`} role="dialog" aria-label={title}>
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
