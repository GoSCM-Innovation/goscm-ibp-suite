// Las orquestaciones de una conexión de CI Tools: la lista a la izquierda y el editor a la derecha.
//
// Crear pide el nombre con `prompt` y borrar confirma con `confirm`, como en CI-DS e IBP. La lista de
// integraciones (lo que se puede agregar a un paso) se vuelve a pedir cada vez que se entra a esta pestaña:
// las integraciones se crean en otra, y la lista que se leyó al abrir quedaría vieja.

import { useCallback, useEffect, useState } from 'react'
import { listIntegraciones } from '../../lib/ci.js'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  listOrchestrations,
  saveOrchestration,
} from '../../lib/orchestrations.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import EditorDeOrquestacion from './EditorDeOrquestacion.jsx'

export default function OrquestacionesCi({ connection, visible = true }) {
  // Una orquestación apunta a UN destino: la conexión y, en CI, su marca de productiva. Los dos ambientes de una
  // conexión de IBP son direcciones distintas; en CI cada ambiente es una conexión, así que la marca es la de ella.
  const destino = { connectionId: connection.id, production: Boolean(connection.isProduction) }

  const [orquestaciones, setOrquestaciones] = useState(null)
  const [integraciones, setIntegraciones] = useState([])
  const [elegida, setElegida] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  // Cada vez que se muestra la pestaña (o se pide actualizar) se vuelve a leer todo. El efecto solo lanza la
  // petición: el estado se toca al volver la respuesta, que es lo que pide la regla de efectos de React.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!visible) return undefined
    let vivo = true
    Promise.all([
      listOrchestrations({ connectionId: connection.id, production: Boolean(connection.isProduction) }),
      listIntegraciones(connection.id),
    ])
      .then(([lista, integ]) => {
        if (!vivo) return
        setOrquestaciones(lista)
        setIntegraciones(integ)
        setError('')
      })
      .catch((fallo) => { if (vivo) { setError(fallo.message); setOrquestaciones((previas) => previas ?? []) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [visible, version, connection.id, connection.isProduction])

  function cargar() {
    setCargando(true)
    setVersion((v) => v + 1)
  }

  const abierta = (orquestaciones ?? []).find((una) => una.id === elegida) ?? null

  async function crear() {
    const nombre = window.prompt('Nombre de la nueva orquestación:')?.trim()
    if (!nombre) return
    try {
      const nueva = await createOrchestration(destino, nombre)
      setOrquestaciones((previas) => [...(previas ?? []), nueva])
      setElegida(nueva.id)
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function duplicar(id) {
    try {
      const copia = await duplicateOrchestration(id)
      setOrquestaciones((previas) => [...(previas ?? []), copia])
      setElegida(copia.id)
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function borrar(una) {
    if (!window.confirm(`¿Eliminar «${una.name}»? No se puede deshacer.`)) return
    try {
      await deleteOrchestration(una.id)
      setOrquestaciones((previas) => (previas ?? []).filter((otra) => otra.id !== una.id))
      if (elegida === una.id) setElegida(null)
    } catch (fallo) {
      // Lo más probable: tiene una ejecución en marcha (409). El mensaje lo dice.
      setError(fallo.message)
    }
  }

  /** Una orquestación se guardó sola: se actualiza su copia en la lista. */
  const alGuardar = useCallback((guardada) => {
    setOrquestaciones((previas) => (previas ?? []).map((una) => (una.id === guardada.id ? guardada : una)))
  }, [])

  /** Cambia el nombre. Lanza si el servidor lo rechaza: quien lo pide sabe dónde enseñar el motivo. */
  async function renombrar(nombre) {
    const guardada = await saveOrchestration(abierta.id, { name: nombre })
    setOrquestaciones((previas) => (previas ?? []).map((una) => (una.id === abierta.id ? { ...una, name: guardada.name } : una)))
  }

  if (orquestaciones === null) return <div className="page-hint ci-cargando">Cargando orquestaciones…</div>

  return (
    <div className="ci-orq">
      <aside className="ci-arbol" aria-label="Orquestaciones">
        <div className="ci-arbol-cabeza">
          <span className="filtro-titulo">Orquestaciones</span>
          <div className="ci-arbol-botones">
            <BotonActualizar className="btn btn-ghost btn-sm" etiqueta="" title="Actualizar" onClick={cargar} cargando={cargando} />
            <button type="button" className="btn btn-ghost btn-sm ci-nueva-boton" onClick={crear} title="Nueva orquestación">+</button>
          </div>
        </div>
        <div className="ci-arbol-cuerpo">
          {orquestaciones.length === 0 && (
            <div className="ci-vacio">
              Todavía no hay orquestaciones.<br />
              <button type="button" className="ci-enlace" onClick={crear}>Crea la primera</button>
            </div>
          )}
          {orquestaciones.map((una) => (
            <div key={una.id} className={`ci-orq-item${una.id === elegida ? ' active' : ''}`}>
              <button type="button" className="ci-arbol-fila" onClick={() => setElegida(una.id)}>
                <span className="ci-arbol-nombre">{una.name}</span>
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicar(una.id)} title="Duplicar" aria-label={`Duplicar ${una.name}`}>⧉</button>
              <button type="button" className="btn btn-ghost btn-sm ci-quitar" onClick={() => borrar(una)} title="Eliminar" aria-label={`Eliminar ${una.name}`}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="ci-biblioteca-cuerpo">
        {error && <div className="notice notice-error" role="alert">✕ {error}</div>}
        {abierta ? (
          <EditorDeOrquestacion
            key={abierta.id}
            connection={connection}
            orquestacion={abierta}
            integraciones={integraciones}
            onRenombrar={renombrar}
            onGuardada={alGuardar}
          />
        ) : (
          <div className="ci-sin-seleccion">
            <div>
              <div className="ci-sin-seleccion-icono">⚙</div>
              Selecciona una orquestación o crea una nueva
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
