// Pantalla de arranque provisional. El shell real (barra, menú de módulos, estados de
// "no contratado") se construye en el paso 6 de la Fase 1, una vez que existan
// core/auth y core/connections. Ver docs/FASE-0-LEVANTAMIENTO.md §8.

const MODULES = [
  { id: 'explorer', name: 'Explorer', detail: 'Jerarquía BOM, red logística, analizadores' },
  { id: 'jobs', name: 'Jobs / Migración', detail: 'Application Jobs y migración de datos' },
  { id: 'cids', name: 'Integración CI-DS', detail: 'Monitoreo y orquestación de tareas' },
]

export default function App() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 4px' }}>Suite IBP</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 2rem' }}>
        GoSCM · v{__APP_VERSION__} · esqueleto en construcción
      </p>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card)',
          padding: '1.25rem 1.5rem',
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>Módulos previstos</p>
        {MODULES.map((m) => (
          <div
            key={m.id}
            style={{
              padding: '10px 0',
              borderTop: '1px solid var(--border)',
              fontSize: 14,
            }}
          >
            {m.name}
            <span style={{ color: 'var(--text-hint)', fontSize: 12 }}> · {m.detail}</span>
          </div>
        ))}
      </div>
    </main>
  )
}
