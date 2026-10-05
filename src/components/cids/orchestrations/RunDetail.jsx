// Qué pasó en cada paso de una ejecución: estado, cuándo, cuánto tardó, y el registro que dejó en SAP.
//
// Portado de `RunLogModal.jsx` de v9. Aquí no es un diálogo sino un panel plegable debajo del lienzo,
// por lo mismo que `RunBar`: un diálogo encima tapa el dibujo, que es donde se ve la forma de la
// cadena.
//
// Lo que faltaba y esto contesta: la barra dice CUÁNTOS pasos van bien y el lienzo colorea los nodos,
// pero ninguna de las dos dice «el paso 3 tardó cuatro minutos y esto dijo». Con una cadena de doce
// pasos que falló anoche, eso es lo único que importa.
//
// El registro se lee con la función que le pasen (`leerRegistro`), porque de dónde sale depende del
// tipo de conexión: en CI-DS es el log de la tarea, en IBP son los mensajes de los pasos del trabajo.
// Es el mismo reparto que en el motor: lo común aquí, lo que difiere en un adaptador.

import { useState } from 'react'

import {
  arbolDeEjecucion, nombreDeEstado, pasosConProblema,
} from '../../../../core/orchestrations/run-detail.js'
import {
  duracionDeCorrida, etiquetaDeCorrida, horaDeCorrida, sufijoDeIdSap,
} from '../../../lib/orchestration-run-form.js'
import './ejecucion.css'

/** El color de cada estado. Mismo criterio que el resto de la aplicación. */
const COLOR = {
  pending: 'var(--text3)',
  running: 'var(--cyan)',
  success: 'var(--green)',
  success_with_errors: 'var(--accent)',
  error: 'var(--red)',
  cancelled: 'var(--accent)',
  skipped: 'var(--text3)',
}

/** El registro que un paso dejó en SAP, pedido solo cuando alguien lo abre. */
function Registro({ paso, leerRegistro }) {
  const [secciones, setSecciones] = useState(null)
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  async function alternar() {
    if (abierto) { setAbierto(false); return }
    // Ya leído: se muestra sin volver a pedirlo. Un registro de una ejecución terminada no cambia.
    if (secciones) { setAbierto(true); return }

    setCargando(true)
    try {
      setSecciones(await leerRegistro(paso))
      setError('')
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCargando(false)
      setAbierto(true)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={alternar} disabled={cargando}>
        {cargando ? '…' : abierto ? 'ocultar logs' : '📄 Logs SAP'}
      </button>

      {abierto && (
        <div className="run-registro">
          {error && <div className="ej-registro-error">Error: {error}</div>}
          {!error && (secciones ?? []).length === 0 && (
            <div className="exp-sub">SAP no devolvió ningún registro para este paso.</div>
          )}
          {(secciones ?? []).map((seccion) => (
            <div key={seccion.nombre}>
              <div className="ej-registro-seccion">{seccion.nombre}</div>
              <pre className="run-registro-texto">{seccion.lineas.join('\n')}</pre>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function RunDetail({ orquestacion, run, leerRegistro }) {
  const [abierto, setAbierto] = useState(false)

  if (!run) return null

  const filas = arbolDeEjecucion(orquestacion, run)
  const conProblema = pasosConProblema(filas)

  return (
    <div className="run-detalle">
      <button type="button" className="btn btn-sm" onClick={() => setAbierto((previo) => !previo)}>
        {abierto ? '▾' : '▸'} Detalle por paso
        <span className="exp-count">{filas.filter((una) => !una.esGrupo).length}</span>
        {conProblema.length > 0 && (
          <span className="exp-count" style={{ color: 'var(--red)' }}>{conProblema.length} con problema</span>
        )}
      </button>

      {abierto && (
        <>
          {/* La cabecera de v9: cómo terminó la corrida entera, a qué hora empezó y cuánto tardó. */}
          <div className="ej-detalle-cab">
            <span className="ej-detalle-titulo">Log de ejecución</span>
            <span className="ej-insignia" style={{ color: COLOR[run.status] ?? 'var(--text2)' }}>
              {etiquetaDeCorrida(run.status)}
            </span>
            <span className="ej-detalle-tiempo">
              {horaDeCorrida(run.startedAt)} · {duracionDeCorrida(run.startedAt, run.finishedAt)}
            </span>
          </div>

          {filas.length === 0 ? (
            <div className="ej-detalle-vacio">Sin nodos ejecutados</div>
          ) : (
            <div className="table-scroll">
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>Paso</th><th>Estado</th><th>Empezó</th><th>Duró</th><th>Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((paso) => (
                    <tr key={paso.id}>
                      <td style={{ paddingLeft: paso.nivel ? 22 : undefined }}>
                        {paso.esGrupo && <span className="tag">grupo</span>} {paso.nombre}
                        {paso.error && <div className="exp-sub" style={{ color: 'var(--red)' }}>{paso.error}</div>}
                        {paso.reintentos > 0 && (
                          <div className="exp-sub">
                            {paso.reintentos} {paso.reintentos === 1 ? 'reintento' : 'reintentos'}
                          </div>
                        )}
                      </td>
                      <td style={{ color: COLOR[paso.status] }}>{nombreDeEstado(paso.status)}</td>
                      <td className="mono">{horaDeCorrida(paso.startedAt)}</td>
                      <td className="mono">{duracionDeCorrida(paso.startedAt, paso.finishedAt)}</td>
                      <td>
                        {/* Solo tiene registro lo que de verdad corrió en SAP: un grupo no se lanza, y un
                            paso saltado o pendiente no dejó nada. */}
                        {!paso.esGrupo && paso.sapRunId ? (
                          <>
                            <span className="ej-id-sap mono" title="Identificador de la ejecución en SAP">
                              {sufijoDeIdSap(paso.sapRunId)}
                            </span>
                            {leerRegistro && <Registro paso={paso} leerRegistro={leerRegistro} />}
                          </>
                        ) : <span className="exp-sub">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
