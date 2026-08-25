// Revisar y confirmar lo que se va a modificar o borrar en el tenant.
//
// Portado de `EditReviewModal.jsx` y `DeleteConfirmModal.jsx` de v8. Son un solo componente porque la
// mitad es la misma —el ciclo, el resultado, los mensajes de SAP— y lo que cambia es qué se enseña y
// qué palabra se pide.
//
// Lo que se enseña ANTES es el valor de esto. Al modificar, cada cambio con su valor de antes y el de
// después: no «hay 14 cambios», sino cuáles. Un valor mal tipeado en una celda es invisible hasta que
// alguien lo lee escrito al lado del que había.
//
// Y al borrar se dice que en SAP IBP es IRREVERSIBLE, porque lo es: no hay papelera ni deshacer.

import { useState } from 'react'

import { MAX_CAMBIOS_LISTADOS, cambiosParaRevisar, resumirCambios } from '../../../core/ibp/master-data-edit.js'
import { valorLegible } from '../../../core/ibp/master-data-model.js'
import Modal from '../ui/Modal.jsx'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** La palabra que hay que escribir para cada operación. */
const PALABRA = { modificar: 'guardar', borrar: 'borrar' }

export default function EdicionDeDatoMaestro({
  accion, entidad, claves, edits, filas, destino, onCerrar, onEscribir,
}) {
  const [escrito, setEscrito] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [salida, setSalida] = useState(null)
  const [error, setError] = useState('')

  const esBorrado = accion === 'borrar'
  const cambios = esBorrado ? [] : cambiosParaRevisar(edits, claves)
  const resumen = resumirCambios(edits)
  const mostrados = cambios.slice(0, MAX_CAMBIOS_LISTADOS)

  /** La identidad de una fila por su clave de negocio: es lo único que la nombra sin ambigüedad. */
  const identidadDe = (fila) => claves.map((clave) => valorLegible(fila?.[clave])).join(' · ') || '—'

  async function escribir() {
    setGuardando(true)
    setError('')
    try {
      setSalida(await onEscribir())
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setGuardando(false)
    }
  }

  if (salida) {
    return (
      <Modal
        title={salida.ok ? 'Hecho' : 'SAP no lo aceptó del todo'}
        subtitle={`${destino.tenant} · ${entidad}`}
        onClose={onCerrar}
        footer={<button type="button" className="btn btn-sm btn-primary" onClick={onCerrar}>Cerrar</button>}
      >
        <div className={`notice notice-${salida.ok ? 'ok' : 'info'}`}>
          {salida.ok ? '✓ ' : ''}
          SAP procesó {numero(salida.filas)} {salida.filas === 1 ? 'fila' : 'filas'}
          {salida.estado !== 'PROCESADA' && ` · estado: ${salida.estado}`}
          {salida.mensajes.length > 0 && ` · rechazó ${numero(salida.mensajes.length)}`}.
        </div>

        {/* Los mensajes de SAP se muestran tal cual: dicen qué fila y por qué, y traducirlos sería
            perder el motivo exacto. */}
        {salida.mensajes.length > 0 && (
          <div className="table-scroll">
            <table className="table-dense">
              <thead><tr><th>Lo que dijo SAP</th></tr></thead>
              <tbody>
                {salida.mensajes.slice(0, 100).map((uno, indice) => (
                  <tr key={`${uno.Message ?? ''}${indice}`}>
                    <td>{uno.Message ?? uno.MessageText ?? JSON.stringify(uno).slice(0, 200)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="exp-sub">Vuelve a consultar la tabla para ver cómo quedó.</p>
      </Modal>
    )
  }

  return (
    <Modal
      wide
      title={esBorrado ? 'Borrar registros' : 'Revisar los cambios'}
      subtitle={`${destino.tenant} · ${entidad} · ${destino.planningArea}`
        + `${destino.versionId ? ` · ${destino.versionId}` : ' · versión base'}`}
      onClose={onCerrar}
      footer={(
        <>
          <button type="button" className="btn btn-sm" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button
            type="button"
            className={`btn btn-sm ${esBorrado ? 'btn-danger' : 'btn-primary'}`}
            onClick={escribir}
            disabled={guardando || escrito.trim().toLowerCase() !== PALABRA[accion]}
          >
            {guardando ? 'Escribiendo…' : esBorrado ? 'Sí, borrar' : 'Sí, guardar'}
          </button>
        </>
      )}
    >
      {error && <div className="notice notice-error">✕ {error}</div>}

      {esBorrado
        ? (
          <>
            <div className="notice notice-error">
              ⚠ Borrar en SAP IBP es <b>irreversible</b>. No hay papelera ni deshacer: la única forma
              de recuperar estos registros es volver a cargarlos.
            </div>
            <p>
              Se van a borrar <b>{numero(filas.length)}</b> {filas.length === 1 ? 'registro' : 'registros'} de{' '}
              <b>{entidad}</b>.
            </p>
            <div className="table-scroll table-alta">
              <table className="table-dense">
                <thead><tr><th>{claves.join(' · ') || 'Registro'}</th></tr></thead>
                <tbody>
                  {filas.slice(0, 300).map((fila, indice) => (
                    <tr key={`${identidadDe(fila)}${indice}`}><td className="mono">{identidadDe(fila)}</td></tr>
                  ))}
                </tbody>
              </table>
              {filas.length > 300 && (
                <div className="exp-sub">y {numero(filas.length - 300)} más.</div>
              )}
            </div>
          </>
        )
        : (
          <>
            <p>
              Se van a escribir <b>{numero(resumen.campos)}</b> {resumen.campos === 1 ? 'cambio' : 'cambios'} en{' '}
              <b>{numero(resumen.filas)}</b> {resumen.filas === 1 ? 'fila' : 'filas'}. Los valores que no
              aparecen aquí no se tocan.
            </p>
            <div className="table-scroll table-alta">
              <table className="table-dense">
                <thead>
                  <tr><th>{claves.join(' · ') || 'Fila'}</th><th>Campo</th><th>Antes</th><th>Después</th></tr>
                </thead>
                <tbody>
                  {mostrados.map((uno) => (
                    <tr key={`${uno.identidad}|${uno.campo}`}>
                      <td className="mono">{uno.identidad}</td>
                      <td>{uno.campo}</td>
                      <td className="mono exp-sub">{valorLegible(uno.antes) || '—'}</td>
                      <td className="mono">{valorLegible(uno.despues) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cambios.length > mostrados.length && (
                <div className="exp-sub">y {numero(cambios.length - mostrados.length)} cambios más.</div>
              )}
            </div>
          </>
        )}

      {destino.esProductivo && (
        <div className="notice notice-error">⚠ Este tenant está marcado como <b>productivo</b>.</div>
      )}

      <label className="exp-enriq">
        <span className="exp-k">Escribe «{PALABRA[accion]}» para confirmar</span>
        <input
          className="input input-sm"
          value={escrito}
          onChange={(evento) => setEscrito(evento.target.value)}
          placeholder={PALABRA[accion]}
        />
      </label>
    </Modal>
  )
}
