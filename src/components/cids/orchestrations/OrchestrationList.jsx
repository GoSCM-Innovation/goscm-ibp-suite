// La lista de orquestaciones de un destino: elegir, crear, duplicar y borrar.
//
// Portada de `OrchList.jsx` de v9 con sus mismos controles y textos, incluidos los favoritos, que son
// lo que la hace usable cuando hay veinte y siempre se trabaja con dos. Se recuerdan por destino,
// igual que los proyectos fijados de la paleta: los de un repositorio no son los de otro.
//
// Crear y borrar NO se resuelven aquí: la lista solo avisa («+», «×») y quien la monta decide cómo
// pedir el nombre y cómo confirmar. Allí es donde se sabe si hay cambios sin guardar.

import { useState } from 'react'
import './lista.css'

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
  // En pantalla angosta la lista ocupa la pantalla entera y no se contrae: no hay a dónde.
  angosta = false,
  onElegir,
  onCrear,
  onDuplicar,
  onBorrar,
  onExportar,
  onImportar,
}) {
  const [favoritas, setFavoritas] = useState(() => leerFavoritas(destino.id))
  const [contraida, setContraida] = useState(false)

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

  // Las favoritas primero y, dentro de cada grupo, el orden en que las entrega el servidor. Es lo que
  // hacía v9: solo separaba las favoritas. `sort` es estable, así que no desordena el resto.
  const ordenadas = [...orquestaciones].sort((a, b) => (
    (favoritas.has(a.id) ? 0 : 1) - (favoritas.has(b.id) ? 0 : 1)
  ))

  if (contraida && !angosta) {
    return (
      <button
        type="button"
        className="orq-contraida"
        onClick={() => setContraida(false)}
        title="Expandir panel de orquestaciones"
      >
        <span className="orq-contraida-texto">Orquestaciones</span>
        <span className="orq-contraida-flecha">›</span>
      </button>
    )
  }

  return (
    <div className={`orq-lista${angosta ? ' orq-lista-movil' : ''}`}>
      <div className="orq-lista-cabeza">
        <span className="filtro-titulo">Orquestaciones</span>
        <div className="orq-cabeza-botones">
          {/* El campo de archivo va escondido detrás del botón: el que trae el navegador no se puede
              estilar y desentonaría con todo lo demás. */}
          <label className="btn btn-ghost btn-sm" title="Importar orquestaciones desde archivo">
            ↑
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              aria-label="Importar orquestaciones desde archivo"
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
            title={orquestaciones.length === 0 ? 'No hay orquestaciones para exportar' : 'Exportar todas a archivo'}
          >
            ↓
          </button>
          <button type="button" className="btn btn-ghost btn-sm orq-nueva-boton" onClick={() => onCrear()} title="Nueva orquestación">
            +
          </button>
          {!angosta && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContraida(true)} title="Contraer panel">
              ‹
            </button>
          )}
        </div>
      </div>

      <div className="orq-lista-cuerpo">
        {cargando ? (
          <div className="page-hint" style={{ padding: 12 }}>Cargando…</div>
        ) : ordenadas.length === 0 ? (
          <div className="orq-sin">
            Sin orquestaciones.<br />
            <button type="button" className="orq-enlace" onClick={() => onCrear()}>Crear una</button>
          </div>
        ) : ordenadas.map((orquestacion) => {
          const esFavorita = favoritas.has(orquestacion.id)
          return (
            <div
              key={orquestacion.id}
              className={`orq-item${elegida === orquestacion.id ? ' active' : ''}${esFavorita ? ' fav' : ''}`}
              onClick={() => onElegir(orquestacion.id)}
              onKeyDown={(evento) => {
                // Solo si la tecla es del propio elemento: Enter sobre un botón de dentro (favorita,
                // duplicar, borrar) ya hace su cosa y no debe además abrir la orquestación.
                if (evento.target !== evento.currentTarget) return
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
                className={`orq-fav${esFavorita ? ' on' : ''}`}
                onClick={(evento) => alternarFavorita(evento, orquestacion.id)}
                title={esFavorita ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                aria-pressed={esFavorita}
              >
                ★
              </button>

              <span className="orq-item-nombre" title={orquestacion.name}>{orquestacion.name}</span>

              <button
                type="button"
                className="orq-accion orq-duplicar"
                onClick={(evento) => { evento.stopPropagation(); onDuplicar(orquestacion.id) }}
                title="Duplicar orquestación"
              >
                ⎘
              </button>
              <button
                type="button"
                className="orq-accion orq-borrar"
                onClick={(evento) => { evento.stopPropagation(); onBorrar(orquestacion) }}
                title="Eliminar"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
