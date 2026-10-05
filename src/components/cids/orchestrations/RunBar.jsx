// La barra de ejecución: iniciar, cancelar, reanudar, repetir, y cómo va.
//
// Portada de la barra del editor de `Orchestrations.jsx` de v9 (insignia, «hechos/total» y los
// botones) y de su `checkBeforeRun`. Aquí es una barra y no un diálogo para el avance: una ejecución
// dura minutos u horas y hay que poder mirar el dibujo mientras corre, que es justamente donde se ve
// qué paso va. El diálogo sí aparece para iniciar (`RunModal`), que es cuando hay que elegir agente
// y variables.
//
// Se conserva de esta plataforma, y no de v9:
//   - «Guarda los cambios antes de ejecutar»: lo que corre es lo GUARDADO, no lo que hay dibujado.
//   - El recuento por estado («3 correctas, 1 falladas…») junto al «hechos/total» de v9.
//
// Props opcionales (sin ellas todo sigue funcionando, con menos):
//   grafo            { nodes, edges } del dibujo; para la guarda de tasks sueltas, para saber si hay
//                    algo que iniciar y para ofrecer las variables de sus tareas.
//   destino          a qué conexión consultar agentes y configuraciones, y cómo se llaman los presets.
//   ultimosParametros, puedeRepetir, onRepetir
//                    «↺ Repetir». Si no se pasan, la barra recuerda lo que ella misma inició.

import { useEffect, useRef, useState } from 'react'

import {
  avanceDeCorrida,
  etiquetaDeCorrida,
  hayNodosDePrimerNivel,
  tareasFueraDeGrupo,
  textoDeRepetir,
} from '../../../lib/orchestration-run-form.js'
import RunModal from './RunModal.jsx'
import './ejecucion.css'

/** Cuánto dura a la vista el aviso de tasks sueltas. Es el tiempo de v9. */
const AVISO_MS = 6000

/** El color de cada estado de la corrida. */
const COLOR = {
  running: 'var(--cyan)',
  success: 'var(--green)',
  error: 'var(--red)',
  cancelled: 'var(--text3)',
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

export default function RunBar({
  run, error, ocupado, enMarcha, sinGuardar, onArrancar, onCortar, onRetomar,
  grafo, destino, ultimosParametros, puedeRepetir, onRepetir,
}) {
  const [pidiendoDatos, setPidiendoDatos] = useState(false)
  const [sueltas, setSueltas] = useState(null)
  const [propios, setPropios] = useState(null)
  const temporizador = useRef(null)

  // El aviso se apaga solo; si la barra desaparece antes, el temporizador no debe tocar nada.
  useEffect(() => () => clearTimeout(temporizador.current), [])

  // Con una acción en curso y sin corrida viva es «Iniciando…»; con la corrida viva, «Cancelando…».
  const iniciando = Boolean(ocupado) && !enMarcha
  const cancelando = Boolean(ocupado) && enMarcha

  const parametros = ultimosParametros ?? propios
  const repetirDisponible = puedeRepetir ?? Boolean(parametros)
  const sinNodos = grafo ? !hayNodosDePrimerNivel(grafo) : false

  function iniciar() {
    // `checkBeforeRun` de v9: con grupos en el dibujo, una tarea suelta no tiene dónde correr.
    const fuera = tareasFueraDeGrupo(grafo)
    if (fuera.length > 0) {
      setSueltas(fuera)
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => setSueltas(null), AVISO_MS)
      return
    }
    setSueltas(null)
    setPidiendoDatos(true)
  }

  function arrancar(valores) {
    setPidiendoDatos(false)
    setPropios(valores)
    onArrancar(valores)
  }

  function repetir() {
    if (onRepetir) onRepetir()
    else if (parametros) onArrancar(parametros)
  }

  const color = run ? COLOR[run.status] ?? 'var(--text2)' : null
  const cuenta = run ? contar(run) : {}
  const avance = run ? avanceDeCorrida(run) : null

  return (
    <>
      <div className="run-bar">
        {run ? (
          <>
            <span className="ej-insignia" style={{ color }}>{etiquetaDeCorrida(run.status)}</span>
            {enMarcha && avance.total > 0 && (
              <span className="ej-avance" title="Pasos de primer nivel terminados">
                {avance.hechos}/{avance.total}
              </span>
            )}
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

        {!enMarcha && run && repetirDisponible && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={repetir}
            disabled={ocupado}
            title={textoDeRepetir(parametros)}
          >
            {iniciando ? 'Iniciando…' : '↺ Repetir'}
          </button>
        )}

        {!enMarcha && run?.status === 'error' && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={onRetomar}
            disabled={ocupado}
            title="Reanudar desde el primer nodo fallido, conservando los resultados ya completados"
          >
            {iniciando ? 'Iniciando…' : '⏭ Reanudar'}
          </button>
        )}

        <button
          type="button"
          className="btn btn-sm btn-run"
          onClick={iniciar}
          disabled={enMarcha || sinNodos || ocupado || sinGuardar}
          title={sinGuardar ? 'Guarda los cambios antes de ejecutar' : undefined}
        >
          {iniciando ? 'Iniciando…' : '▶ Iniciar'}
        </button>

        {enMarcha && (
          <button type="button" className="btn btn-sm btn-danger" onClick={onCortar} disabled={ocupado}>
            {cancelando ? 'Cancelando…' : '■ Cancelar'}
          </button>
        )}
      </div>

      {sueltas && (
        <div className="ej-franja" role="alert">
          <span>
            ⚠ Los siguientes tasks deben estar dentro de un grupo para poder iniciar: <strong>{sueltas.join(', ')}</strong>
          </span>
          <button type="button" aria-label="Cerrar el aviso" onClick={() => setSueltas(null)}>×</button>
        </div>
      )}

      {error && <div className="notice notice-error lienzo-error">✕ {error}</div>}

      {pidiendoDatos && (
        <RunModal
          destino={destino}
          grafo={grafo}
          onConfirmar={arrancar}
          onClose={() => setPidiendoDatos(false)}
        />
      )}
    </>
  )
}
