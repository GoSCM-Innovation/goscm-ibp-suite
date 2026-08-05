// Sitio reservado para un módulo todavía sin construir.
//
// Existe para que el armazón esté completo y navegable desde ahora: el trabajo de cada módulo
// es una fase entera, y hasta que llegue conviene ver el hueco en su sitio en vez de un menú
// que lleva a la nada.

export default function ModulePlaceholder({ module }) {
  return (
    <div className="content-narrow">
      <div style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 18 }}>
        <span style={{ fontSize: 26 }}>{module.icon}</span>
        <div>
          <div className="page-title">{module.name}</div>
          <p className="page-hint">{module.summary}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">En construcción</div>
        <p className="card-hint" style={{ marginTop: 6 }}>
          Tu empresa tiene este módulo contratado y el acceso ya funciona. Las pantallas
          llegan en su propia fase, cuando se porte desde la aplicación actual.
        </p>
      </div>
    </div>
  )
}
