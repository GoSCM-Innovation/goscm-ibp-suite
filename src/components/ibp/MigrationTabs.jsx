// La pestaña «Migración», con sus dos modos.
//
// Portado tal cual de `Migration/MigrationTabs.jsx` de v8: la barra de sub-pestañas y los dos modos,
//   · «Dato maestro»       → la migración de dato maestro (MigrationPlan)
//   · «Dato transaccional» → la migración de key figures (KfMigration)
//
// Como en v8, cambiar de modo no pregunta nada. Desmonta el modo que se deja, y eso corta la copia que
// estuviera en marcha —cada modo la cancela al desmontarse—. La guarda de salida protege salir de la
// pestaña «Migración» o de la conexión, que es donde v8 preguntaba.

import { useState } from 'react'

import { useIsMobile } from '../../lib/useIsMobile.js'
import KfMigration from './KfMigration.jsx'
import MigrationPlan from './MigrationPlan.jsx'

const TABS = [
  { id: 'master', label: 'Dato maestro' },
  { id: 'kf', label: 'Dato transaccional' },
]

export default function MigrationTabs({ connection }) {
  const isMobile = useIsMobile()
  const [mode, setMode] = useState('master')

  return (
    // `flex: 1` y `minHeight: 0` además del `height: '100%'` de v8: el contenedor de la suite es una
    // columna flexible sin alto fijo, y sin esto el porcentaje no se resuelve y no hay desplazamiento.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg)', padding: isMobile ? '0 12px' : '0 24px', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button key={tab.id} type="button" onClick={() => setMode(tab.id)} style={{
            padding: isMobile ? '8px 12px' : '8px 16px', fontSize: 12, background: 'none', border: 'none',
            borderBottom: mode === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            color: mode === tab.id ? 'var(--text)' : 'var(--text2)', fontWeight: mode === tab.id ? 600 : 400,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {mode === 'master' && <MigrationPlan connection={connection} />}
        {mode === 'kf' && <KfMigration connection={connection} />}
      </div>
    </div>
  )
}
