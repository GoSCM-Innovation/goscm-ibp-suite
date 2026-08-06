// Orquestaciones: la lista a la izquierda y el editor a la derecha.
//
// Portada de `Orchestrations.jsx` de v9. El lienzo todavía no está —viene en la sesión siguiente— y
// mientras tanto el panel de la derecha dice qué falta en vez de fingir que no hay nada.

import { useEffect, useState } from 'react'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  listOrchestrations,
} from '../../../lib/orchestrations.js'
import Modal from '../../ui/Modal.jsx'
import OrchestrationList from './OrchestrationList.jsx'

export default function Orchestrations({ destino }) {
  const [orquestaciones, setOrquestaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [elegida, setElegida] = useState(null)
  const [aBorrar, setABorrar] = useState(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let abandonado = false
    listOrchestrations(destino)
      .then((lista) => {
        if (abandonado) return
        setOrquestaciones(lista)
        setError('')
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })
    return () => { abandonado = true }
  }, [destino, recarga])

  const recargar = () => setRecarga((numero) => numero + 1)

  // Las tres acciones comparten el mismo manejo: si algo falla, se dice y la lista no queda a medias.
  const hacer = (accion) => accion().then(recargar).catch((fallo) => setError(fallo.message))

  const crear = (nombre) => hacer(async () => {
    const nueva = await createOrchestration(destino, nombre)
    setElegida(nueva.id)
  })

  const duplicar = (id) => hacer(async () => {
    const copia = await duplicateOrchestration(id)
    setElegida(copia.id)
  })

  const borrar = () => {
    const id = aBorrar.id
    setABorrar(null)
    return hacer(async () => {
      await deleteOrchestration(id)
      // Si se borró la que estaba abierta, el panel de la derecha vuelve a vacío.
      setElegida((actual) => (actual === id ? null : actual))
    })
  }

  const abierta = orquestaciones.find((una) => una.id === elegida) ?? null

  return (
    <div className="orq">
      {error && <div className="notice notice-error orq-error">✕ {error}</div>}

      <div className="orq-cuerpo">
        <OrchestrationList
          destino={destino}
          orquestaciones={orquestaciones}
          elegida={elegida}
          cargando={cargando}
          onElegir={setElegida}
          onCrear={crear}
          onDuplicar={duplicar}
          onBorrar={setABorrar}
        />

        <div className="orq-editor">
          {abierta ? (
            <div className="orq-vacio">
              <div className="orq-vacio-titulo">{abierta.name}</div>
              <p className="page-hint">
                El lienzo para dibujar los pasos todavía no está: es lo que viene ahora. La
                orquestación ya está creada y guardada, así que no vas a perder nada.
              </p>
            </div>
          ) : (
            <div className="orq-vacio">
              <div className="orq-vacio-titulo">Ninguna orquestación abierta</div>
              <p className="page-hint">Elegí una de la lista, o creá una nueva con el <b>+</b>.</p>
            </div>
          )}
        </div>
      </div>

      {aBorrar && (
        <Modal
          title="Borrar la orquestación"
          subtitle={aBorrar.name}
          onClose={() => setABorrar(null)}
          footer={(
            <>
              <div className="modal-foot-info" />
              <button type="button" className="btn btn-sm" onClick={() => setABorrar(null)}>No, dejarla</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={borrar}>Sí, borrarla</button>
            </>
          )}
        >
          <p>
            Se va a borrar <b>{aBorrar.name}</b> y no se puede deshacer.
          </p>
          <p className="page-hint" style={{ marginTop: 10 }}>
            Las tareas de CI-DS no se tocan: lo que se borra es el encadenado, no las tareas.
          </p>
        </Modal>
      )}
    </div>
  )
}
