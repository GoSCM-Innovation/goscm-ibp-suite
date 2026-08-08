// Cuánta CPU y memoria está consumiendo el tenant.
//
// Portado de `ResourceStats.jsx` de v8. La diferencia es dónde se hacen las cuentas: allí el
// componente leía las 4.320 filas de treinta días y las promediaba en el navegador; aquí llega la
// serie ya agrupada desde `core/ibp/resource-stats.js`, que además es donde se puede probar.
//
// SAP muestrea cada diez minutos, así que refrescar más seguido que eso solo repetiría la respuesta.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { RANGOS_DE_RECURSOS } from '../../../core/ibp/resource-series.js'
import { clockLabelEpochMs, dayLabelEpochMs, formatEpochMs, readStoredTzMode, storeTzMode, TZ_OPTIONS } from '../../lib/dates.js'
import { fetchResourceStats } from '../../lib/ibp-resources.js'
import { SinDatos, UsageLines } from '../ui/StatusCharts.jsx'

/** Cada cuánto se vuelve a preguntar. Diez minutos: es el paso con el que SAP escribe la serie. */
const REFRESCO_MS = 10 * 60_000

/** Verde mientras sobre sitio, ámbar cuando aprieta, rojo cuando ya no queda. */
function colorDeUso(valor) {
  if (valor === null) return undefined
  if (valor >= 90) return 'var(--red)'
  return valor >= 75 ? 'var(--accent)' : 'var(--green)'
}

function Kpi({ etiqueta, valor, detalle, color }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{etiqueta}</div>
      <div className="kpi-valor" style={color ? { color } : undefined}>
        {valor === null ? '—' : `${valor}%`}
      </div>
      {detalle && <div className="kpi-detalle">{detalle}</div>}
    </div>
  )
}

export default function ResourceStats({ conexionId }) {
  const [horas, setHoras] = useState(24)
  const [zona, setZona] = useState(readStoredTzMode)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [ultima, setUltima] = useState(null)

  const cargar = useCallback(() => {
    let abandonado = false
    setCargando(true)

    fetchResourceStats(conexionId, horas)
      .then((respuesta) => {
        if (abandonado) return
        setDatos(respuesta)
        setUltima(Date.now())
        setError('')
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })

    return () => { abandonado = true }
  }, [conexionId, horas])

  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  // En pausa mientras la pestaña no se ve: nadie mira un gráfico que está detrás de otra ventana.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) cargar() }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  function cambiarZona(modo) {
    storeTzMode(modo)
    setZona(modo)
  }

  const resumen = datos?.resumen ?? null
  const serie = useMemo(() => datos?.serie ?? [], [datos])

  // Por debajo de un día el eje va en horas; por encima, en días. En 30 días "03:00" repetido
  // treinta veces no dice nada.
  const etiquetaEje = useCallback(
    (ts) => (horas <= 24 ? clockLabelEpochMs(ts, zona) : dayLabelEpochMs(ts, zona)),
    [horas, zona],
  )
  const etiquetaPunto = useCallback((ts) => formatEpochMs(ts, zona), [zona])

  return (
    <div className="module-body">
      <div className="monitor-bar">
        <div className="seg">
          {TZ_OPTIONS.map((opcion) => (
            <button
              key={opcion.value}
              type="button"
              className={`seg-btn${zona === opcion.value ? ' active' : ''}`}
              onClick={() => cambiarZona(opcion.value)}
              aria-pressed={zona === opcion.value}
            >
              {opcion.label}
            </button>
          ))}
        </div>

        <div className="seg">
          {RANGOS_DE_RECURSOS.map((rango) => (
            <button
              key={rango.horas}
              type="button"
              className={`seg-btn${horas === rango.horas ? ' active' : ''}`}
              onClick={() => setHoras(rango.horas)}
              aria-pressed={horas === rango.horas}
            >
              {rango.label}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn-sm" onClick={cargar} disabled={cargando}>↺ Actualizar</button>

        <span className="page-hint">
          {cargando
            ? 'Consultando…'
            : ultima
              ? `${resumen?.muestras ?? 0} muestras · actualizado a las ${new Date(ultima).toLocaleTimeString()}`
              : ''}
        </span>
      </div>

      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="tablero">
        <div className="grid-kpi">
          <Kpi
            etiqueta="CPU ahora"
            valor={resumen?.cpu ?? null}
            detalle={resumen?.cpuMax === null || resumen === null ? '' : `pico ${resumen.cpuMax}% · media ${resumen.cpuMedia}%`}
            color={colorDeUso(resumen?.cpu ?? null)}
          />
          <Kpi
            etiqueta="Memoria ahora"
            valor={resumen?.mem ?? null}
            detalle={resumen?.memMax === null || resumen === null ? '' : `pico ${resumen.memMax}% · media ${resumen.memMedia}%`}
            color={colorDeUso(resumen?.mem ?? null)}
          />
        </div>

        <div className="card">
          <div className="card-label">
            Consumo del tenant
            {resumen?.desde && (
              <span className="exp-sub"> · {formatEpochMs(resumen.desde, zona)} → {formatEpochMs(resumen.hasta, zona)}</span>
            )}
          </div>

          {cargando && serie.length === 0
            ? <div className="sin-datos">Consultando…</div>
            : error
              ? <SinDatos />
              : <UsageLines serie={serie} etiquetaEje={etiquetaEje} etiquetaPunto={etiquetaPunto} />}
        </div>
      </div>
    </div>
  )
}
