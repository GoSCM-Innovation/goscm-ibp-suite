// La pestaña «Migración», con sus dos modos.
//
// Portado de `Migration/MigrationTabs.jsx` de v8. Allí «Migración» era UNA pestaña con dos sub-modos
// —«Dato maestro» y «Dato transaccional»—, y aquí se habían convertido en dos pestañas de primer
// nivel («Migración» y «Migrar cifras»). Vuelven a ser una.
//
// No es cosmético: las dos migran del mismo origen al mismo destino y comparten la guarda de salida
// —irse de la pantalla cancela lo que esté en marcha—. Presentadas como dos pestañas separadas, saltar
// de una a otra parece gratis y no lo es.

import { lazy, Suspense, useState } from 'react'

import { puedeSalir } from '../../lib/guarda-de-salida.js'

const MigrationPlan = lazy(() => import('./MigrationPlan.jsx'))
const KfMigration = lazy(() => import('./KfMigration.jsx'))

/** Los dos modos, con los nombres de v8. */
const MODOS = [
  { id: 'master', label: 'Dato maestro' },
  { id: 'kf', label: 'Dato transaccional' },
]

export default function MigrationTabs() {
  const [modo, setModo] = useState('master')

  return (
    <>
      <div className="tabs tabs-sub">
        {MODOS.map((uno) => (
          <button
            key={uno.id}
            type="button"
            className={`tab${modo === uno.id ? ' active' : ''}`}
            // Cambiar de modo desmonta la migración en curso, que es lo que la cancela.
            onClick={() => { if (puedeSalir()) setModo(uno.id) }}
            aria-pressed={modo === uno.id}
          >
            {uno.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<div className="page-hint">Cargando…</div>}>
        {modo === 'master' ? <MigrationPlan /> : <KfMigration />}
      </Suspense>
    </>
  )
}
