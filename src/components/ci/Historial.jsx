// El historial de ejecuciones de una conexión: quién ejecutó qué, cuándo, cuánto tardó y cómo salió.
//
// Es el rastro de lo que se cargó a IBP. Lo más importante que dice, y por eso tiene su propio color, es lo que
// quedó «sin confirmar»: se envió y no se sabe cómo terminó. No se pinta como error ni como éxito.

import { useEffect, useMemo, useState } from 'react'
import { escribirDuracion } from '../../../core/orchestrations/run-detail.js'
import { ESTADOS_DE_EJECUCION, fechaLegible, listarEjecuciones } from '../../lib/ci.js'
import { copyText } from '../../lib/clipboard.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import BotonCopiar from '../ui/BotonCopiar.jsx'
import { textosDeCambios } from '../../../core/ci/ajustes.js'
import { AvisoDeAdvertencia } from './DialogoDeEjecucion.jsx'

const ESTADOS_DEL_FILTRO = [['', 'Todas'], ['error', 'Con error'], ['warning', 'Con advertencias'], ['unconfirmed', 'Sin confirmar'], ['success', 'Completadas']]

export default function Historial({ connection }) {
  const [ejecuciones, setEjecuciones] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('')
  const [abierta, setAbierta] = useState(null)

  // Cada vez que cambia `version` se vuelve a leer. El efecto solo lanza la petición: el estado se toca al volver
  // la respuesta, que es lo que pide la regla de efectos de React.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let vivo = true
    listarEjecuciones(connection.id)
      .then((lista) => { if (vivo) { setEjecuciones(lista); setError('') } })
      .catch((fallo) => { if (vivo) { setError(fallo.message); setEjecuciones((previas) => previas ?? []) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [connection.id, version])

  function cargar() {
    setCargando(true)
    setVersion((v) => v + 1)
  }

  const visibles = useMemo(() => {
    const buscado = texto.trim().toLowerCase()
    return (ejecuciones ?? []).filter((una) => (
      (estado === '' || una.status === estado)
      && (buscado === ''
        || [una.integrationName, una.folder, una.userEmail, una.orchestrationName, una.mplId]
          .some((campo) => String(campo ?? '').toLowerCase().includes(buscado)))
    ))
  }, [ejecuciones, texto, estado])

  if (ejecuciones === null) return <div className="page-hint ci-cargando">Cargando el historial…</div>

  return (
    <div className="ci-historial">
      <div className="ci-historial-barra">
        <input
          className="input input-sm"
          type="search"
          placeholder="Buscar por integración, persona, orquestación o MPL ID…"
          value={texto}
          aria-label="Buscar en el historial"
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <div className="ci-opciones" role="group" aria-label="Estado">
          {ESTADOS_DEL_FILTRO.map(([valor, etiqueta]) => (
            <button
              key={valor || 'todas'}
              type="button"
              className={`btn btn-sm${estado === valor ? ' btn-primary' : ''}`}
              onClick={() => setEstado(valor)}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <BotonActualizar className="btn btn-sm" etiqueta="Actualizar" onClick={cargar} cargando={cargando} confirmar error={Boolean(error)} />
      </div>

      {error && <div className="notice notice-error" role="alert">✕ {error}</div>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Cuándo</th><th>Integración</th><th>Origen</th><th>Quién</th><th>Estado</th><th>HTTP</th><th>Duración</th><th />
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td className="table-empty" colSpan={8}>
                  {(ejecuciones ?? []).length === 0 ? 'Todavía no se ha ejecutado nada en esta conexión.' : 'Ninguna ejecución coincide con el filtro.'}
                </td>
              </tr>
            )}
            {visibles.map((una) => {
              const meta = ESTADOS_DE_EJECUCION[una.status] ?? { texto: una.status, clase: 'espera' }
              const desplegada = abierta === una.id
              return (
                <FilaDeHistorial key={una.id} una={una} meta={meta} desplegada={desplegada} onAlternar={() => setAbierta(desplegada ? null : una.id)} />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilaDeHistorial({ una, meta, desplegada, onAlternar }) {
  return (
    <>
      <tr className="ci-historial-fila" onClick={onAlternar} style={{ cursor: 'pointer' }}>
        <td className="mono">{fechaLegible(una.startedAt)}</td>
        <td>
          <div>
            {una.integrationName}
            {(una.ajustes ?? []).length > 0 && <span className="ci-orq-ajustes-chip" title="La orquestación cambió algo de esta integración al enviarla">con ajustes</span>}
          </div>
          {una.folder && <div className="card-hint">{una.folder}</div>}
        </td>
        <td>{una.origin === 'orchestration' ? `Orquestación${una.orchestrationName ? ` · ${una.orchestrationName}` : ''}` : 'Manual'}</td>
        <td>{una.userEmail ?? '—'}</td>
        <td><span className={`ci-estado ci-estado-${meta.clase}`}>{meta.texto}</span></td>
        <td className="mono">{una.httpStatus ?? '—'}</td>
        <td>{una.durationMs === null ? '—' : escribirDuracion(una.durationMs)}</td>
        <td aria-hidden="true">{desplegada ? '▾' : '▸'}</td>
      </tr>
      {desplegada && (
        <tr className="ci-historial-detalle">
          <td colSpan={8}>
            {una.mplId && (
              <div className="ci-resultado-mpl">
                <span className="card-hint">MPL ID</span>
                <code className="mono">{una.mplId}</code>
                <BotonCopiar titulo="Copiar el MPL ID" onCopiar={() => copyText(una.mplId)} />
              </div>
            )}
            {Object.keys(una.variables ?? {}).length > 0 && (
              <div className="ci-variables-usadas">
                <span className="card-hint">Valores:</span>
                {Object.entries(una.variables).map(([nombre, valor]) => (
                  <code key={nombre} className="mono ci-variable">{nombre} = {valor}</code>
                ))}
              </div>
            )}
            {(una.ajustes ?? []).length > 0 && (
              <div className="ci-variables-usadas">
                <span className="card-hint">Con ajustes:</span>
                {textosDeCambios(una.ajustes).map((texto) => <code key={texto} className="mono ci-variable">{texto}</code>)}
              </div>
            )}
            {una.status === 'warning' && <AvisoDeAdvertencia httpStatus={una.httpStatus} />}
            {una.message ? <pre className="ci-resultado-mensaje mono">{una.message}</pre> : <span className="card-hint">Sin mensaje.</span>}
          </td>
        </tr>
      )}
    </>
  )
}
