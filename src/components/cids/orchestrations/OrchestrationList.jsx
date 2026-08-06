// La lista de orquestaciones de un destino: elegir, crear, duplicar y borrar.
//
// Portada de `OrchList.jsx` de v9, incluidos los favoritos, que son lo que la hace usable cuando hay
// veinte y siempre se trabaja con dos. Se recuerdan por destino, igual que los proyectos fijados del
// lanzador: los de un repositorio no son los de otro.

import { useState } from 'react'

const claveFavoritas = (destinoId) => `ibp.cids.orq-favoritas.${destinoId}`

function leerFavoritas(destinoId) {
  try {
    const guardado = JSON.parse(localStorage.getItem(claveFavoritas(destinoId)) || '[]')
    return new Set(Array.isArray(guardado) ? guardado : [])
  } catch {
    return new Set()
  }
}

function guardarFavoritas(destinoId, favoritas) {
  try {
    localStorage.setItem(claveFavoritas(destinoId), JSON.stringify([...favoritas]))
  } catch {
    // Almacenamiento bloqueado: valen para esta visita y no se recuerdan.
  }
}

export default function OrchestrationList({
  destino,
  orquestaciones,
  elegida,
  cargando,
  onElegir,
  onCrear,
  onDuplicar,
  onBorrar,
  onExportar,
  onImportar,
}) {
  const [favoritas, setFavoritas] = useState(() => leerFavoritas(destino.id))
  const [creando, setCreando] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')

  function alternarFavorita(evento, id) {
    evento.stopPropagation()
    setFavoritas((previas) => {
      const siguientes = new Set(previas)
      if (siguientes.has(id)) siguientes.delete(id)
      else siguientes.add(id)
      guardarFavoritas(destino.id, siguientes)
      return siguientes
    })
  }

  // Las favoritas arriba y, dentro de cada grupo, por nombre. Es lo que hacía v9.
  const ordenadas = [...orquestaciones].sort((a, b) => {
    const favA = favoritas.has(a.id) ? 0 : 1
    const favB = favoritas.has(b.id) ? 0 : 1
    if (favA !== favB) return favA - favB
    return a.name.localeCompare(b.name)
  })

  function crear(evento) {
    evento.preventDefault()
    const nombre = nombreNuevo.trim()
    if (!nombre) return
    setNombreNuevo('')
    setCreando(false)
    onCrear(nombre)
  }

  return (
    <div className="orq-lista">
      <div className="orq-lista-cabeza">
        <span className="filtro-titulo">Orquestaciones</span>
        <div style={{ display: 'flex' }}>
          {/* El campo de archivo va escondido detrás del botón: el que trae el navegador no se puede
              estilar y desentonaría con todo lo demás. */}
          <label className="btn btn-ghost btn-sm" title="Importar desde un archivo">
            ↑
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(evento) => {
                const archivo = evento.target.files?.[0]
                // Se limpia para que elegir el MISMO archivo dos veces vuelva a disparar el evento.
                evento.target.value = ''
                if (archivo) onImportar(archivo)
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onExportar}
            disabled={orquestaciones.length === 0}
            title={orquestaciones.length === 0 ? 'No hay nada que exportar' : 'Exportar todas a un archivo'}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setCreando((abierto) => !abierto)}
            title="Nueva orquestación"
          >
            {creando ? '×' : '+'}
          </button>
        </div>
      </div>

      {/* El campo se lleva el foco solo: aparece porque acabás de pedirlo con el "+", así que el
          cursor va directo donde ibas a escribir. */}
      {creando && (
        <form className="orq-nueva" onSubmit={crear}>
          <input
            className="input input-sm"
            placeholder="Nombre de la orquestación"
            value={nombreNuevo}
            onChange={(evento) => setNombreNuevo(evento.target.value)}
            aria-label="Nombre de la orquestación"
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!nombreNuevo.trim()}>
            Crear
          </button>
        </form>
      )}

      <div className="orq-lista-cuerpo">
        {cargando ? (
          <div className="page-hint" style={{ padding: 12 }}>Cargando…</div>
        ) : ordenadas.length === 0 ? (
          <div className="page-hint" style={{ padding: 12 }}>
            Todavía no hay ninguna. Creá la primera con el <b>+</b>.
          </div>
        ) : ordenadas.map((orquestacion) => (
          <div
            key={orquestacion.id}
            className={`orq-item${elegida === orquestacion.id ? ' active' : ''}`}
            onClick={() => onElegir(orquestacion.id)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter' || evento.key === ' ') {
                evento.preventDefault()
                onElegir(orquestacion.id)
              }
            }}
            role="button"
            tabIndex={0}
          >
            <button
              type="button"
              className={`tree-pin${favoritas.has(orquestacion.id) ? ' on' : ''}`}
              onClick={(evento) => alternarFavorita(evento, orquestacion.id)}
              title={favoritas.has(orquestacion.id) ? 'Quitar de favoritas' : 'Marcar como favorita'}
              aria-pressed={favoritas.has(orquestacion.id)}
            >
              {favoritas.has(orquestacion.id) ? '★' : '☆'}
            </button>

            <div className="orq-item-que">
              <div className="orq-item-nombre" title={orquestacion.name}>{orquestacion.name}</div>
              <div className="orq-item-pasos">{contarPasos(orquestacion)}</div>
            </div>

            <div className="orq-item-acciones">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={(evento) => { evento.stopPropagation(); onDuplicar(orquestacion.id) }}
                title="Duplicar"
              >
                ⧉
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={(evento) => { evento.stopPropagation(); onBorrar(orquestacion) }}
                title="Borrar"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Cuántos pasos tiene, contando los que están dentro de un grupo. */
function contarPasos(orquestacion) {
  const tareas = (orquestacion.nodes ?? []).filter((nodo) => nodo.type === 'task').length
  if (tareas === 0) return 'Sin pasos'
  return tareas === 1 ? '1 paso' : `${tareas} pasos`
}
