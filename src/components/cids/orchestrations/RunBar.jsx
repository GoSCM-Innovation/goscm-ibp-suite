// La barra de ejecución: arrancar, cortar, retomar, y cómo va.
//
// Portada de lo que en v9 eran `RunModal` y `RunSingleModal`. Aquí es una barra y no un diálogo: una
// ejecución dura minutos u horas y hay que poder mirar el dibujo mientras corre, que es justamente
// donde se ve qué paso va. Un diálogo encima taparía lo único que interesa.
//
// El diálogo sí aparece para arrancar, que es cuando hay que elegir agente y variables.

import { useState } from 'react'
import Modal from '../../ui/Modal.jsx'

/** Cómo se pinta cada estado de la ejecución. */
const ESTADO = {
  running: { texto: 'En marcha', color: 'var(--cyan)' },
  success: { texto: 'Terminó bien', color: 'var(--green)' },
  error: { texto: 'Terminó con fallos', color: 'var(--red)' },
  cancelled: { texto: 'Cortada', color: 'var(--text3)' },
}

/** Cuenta cuántos pasos hay en cada estado, mirando también dentro de los grupos. */
function contar(run) {
  const cuenta = {}
  const sumar = (paso) => { cuenta[paso.status] = (cuenta[paso.status] ?? 0) + 1 }
  for (const paso of Object.values(run.nodes ?? {})) {
    if (paso.type === 'group') Object.values(paso.children ?? {}).forEach(sumar)
    else sumar(paso)
  }
  return cuenta
}

export default function RunBar({ run, error, ocupado, enMarcha, sinGuardar, onArrancar, onCortar, onRetomar }) {
  const [pidiendoDatos, setPidiendoDatos] = useState(false)
  const [agente, setAgente] = useState('')
  const [variables, setVariables] = useState('')

  function arrancar() {
    setPidiendoDatos(false)
    onArrancar({
      ...(agente.trim() ? { agentName: agente.trim() } : {}),
      globalVariables: leerVariables(variables),
    })
  }

  const estado = run ? ESTADO[run.status] ?? { texto: run.status, color: 'var(--text2)' } : null
  const cuenta = run ? contar(run) : {}

  return (
    <>
      <div className="run-bar">
        {estado ? (
          <>
            <span className="punto" style={{ background: estado.color }} />
            <span className="run-estado" style={{ color: estado.color }}>{estado.texto}</span>
            <span className="run-cuenta">
              {cuenta.running > 0 && <span style={{ color: 'var(--cyan)' }}>{cuenta.running} corriendo</span>}
              {cuenta.pending > 0 && <span>{cuenta.pending} en espera</span>}
              {cuenta.success > 0 && <span style={{ color: 'var(--green)' }}>{cuenta.success} correctas</span>}
              {cuenta.success_with_errors > 0 && (
                <span style={{ color: 'var(--accent)' }}>{cuenta.success_with_errors} con avisos</span>
              )}
              {cuenta.error > 0 && <span style={{ color: 'var(--red)' }}>{cuenta.error} falladas</span>}
              {cuenta.skipped > 0 && <span>{cuenta.skipped} salteadas</span>}
            </span>
          </>
        ) : (
          <span className="run-cuenta">Sin ejecutar todavía</span>
        )}

        <div style={{ flex: 1 }} />

        {enMarcha ? (
          <button type="button" className="btn btn-sm btn-danger" onClick={onCortar} disabled={ocupado}>
            ✕ Cortar
          </button>
        ) : (
          <>
            {run?.status === 'error' && (
              <button type="button" className="btn btn-sm" onClick={onRetomar} disabled={ocupado}>
                ↻ Retomar desde donde falló
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-run"
              onClick={() => setPidiendoDatos(true)}
              disabled={ocupado || sinGuardar}
              title={sinGuardar ? 'Guarda los cambios antes de ejecutar' : 'Ejecutar la orquestación'}
            >
              ▶ Ejecutar
            </button>
          </>
        )}
      </div>

      {error && <div className="notice notice-error lienzo-error">✕ {error}</div>}

      {pidiendoDatos && (
        <Modal
          title="Ejecutar la orquestación"
          onClose={() => setPidiendoDatos(false)}
          footer={(
            <>
              <div className="modal-foot-info" />
              <button type="button" className="btn btn-sm" onClick={() => setPidiendoDatos(false)}>Cancelar</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={arrancar}>▶ Ejecutar</button>
            </>
          )}
        >
          <p className="page-hint">
            Esto vale para todos los pasos que no tengan lo suyo configurado. Un paso con su propio
            agente o sus propias variables conserva los suyos.
          </p>

          <div className="form-stack" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="run-agente">Agente para todos (opcional)</label>
              <input
                id="run-agente"
                className="input"
                value={agente}
                onChange={(evento) => setAgente(evento.target.value)}
                placeholder="Dejar vacío para que lo decida CI-DS"
              />
            </div>

            <div className="field">
              <label htmlFor="run-variables">Variables para todos (opcional)</label>
              <textarea
                id="run-variables"
                className="input mono"
                rows={4}
                value={variables}
                onChange={(evento) => setVariables(evento.target.value)}
                placeholder={'FECHA=20260804\nPAIS=CL'}
              />
              <span className="card-hint">Una por línea, con el formato NOMBRE=valor.</span>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * Lee las variables escritas a mano, una por línea.
 *
 * Se parte en el PRIMER `=` y no en todos: un valor puede contener el signo —una consulta, una ruta—
 * y romperlo ahí lo cortaría a la mitad.
 */
function leerVariables(texto) {
  return String(texto ?? '')
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const corte = linea.indexOf('=')
      if (corte === -1) return null
      return { name: linea.slice(0, corte).trim(), value: linea.slice(corte + 1).trim() }
    })
    .filter((variable) => variable?.name)
}
