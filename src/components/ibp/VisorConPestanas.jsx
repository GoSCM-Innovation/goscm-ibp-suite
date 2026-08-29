// El envoltorio de pestañas de los visores de datos: varias tablas abiertas a la vez.
//
// Portado de `DataViewer/ViewerTabs.jsx` de v8. Aquí había un solo visor: elegir otra tabla perdía
// la anterior, con sus columnas, su filtro y su página cargada.
//
// PARA QUÉ SIRVE de verdad: revisar dato maestro es cruzar tablas. «Este producto está en Product
// pero, ¿tiene fila en Location Product?» Con un visor hay que ir, mirar, volver y reconstruir el
// filtro. Con pestañas se abren las dos y se salta.
//
// Cuatro decisiones de v8 que se conservan porque son las que lo hacen sostenible:
//
//   - MONTAJE PEREZOSO. Una pestaña restaurada no monta su visor hasta que se abre. Si no, volver
//     con ocho pestañas dispararía ocho lecturas de esquema contra SAP de golpe.
//   - UNA VEZ MONTADA, SE QUEDA. Cambiar de pestaña y volver no vuelve a leer nada.
//   - SOLO LA ACTIVA DIBUJA SU TABLA. Las de atrás no ponen sus filas en el DOM; una tabla de
//     quinientas filas por sesenta columnas escondida cuesta lo mismo que visible.
//   - LO QUE SE GUARDA ES LA DEFINICIÓN, no los datos. Al volver, las pestañas están; sus filas se
//     leen cuando se abren. El tráfico contra SAP es el mismo que con un visor solo.

import { useCallback, useEffect, useRef, useState } from 'react'

import BotonPantallaCompleta from '../ui/BotonPantallaCompleta.jsx'
import { usePantallaCompleta } from '../../lib/usePantallaCompleta.js'
import {
  guardarPestanas, leerPestanas, nombreDePestana, nuevaPestana, TOPE_DE_PESTANAS,
} from '../../lib/pestanas-de-visor.js'

export default function VisorConPestanas({ clase, conexionId, children }) {
  const [pestanas, setPestanas] = useState(() => leerPestanas(clase, conexionId))
  const [activa, setActiva] = useState(() => leerPestanas(clase, conexionId)[0].id)
  const [montadas, setMontadas] = useState(() => ({ [leerPestanas(clase, conexionId)[0].id]: true }))

  const caja = useRef(null)
  const pantalla = usePantallaCompleta(caja)

  useEffect(() => { guardarPestanas(clase, conexionId, pestanas) }, [clase, conexionId, pestanas])

  const elegir = useCallback((id) => {
    setMontadas((previas) => (previas[id] ? previas : { ...previas, [id]: true }))
    setActiva(id)
  }, [])

  /** `def` viene puesta al duplicar: la pestaña nueva arranca donde estaba la de al lado. */
  function agregar(def = null) {
    if (pestanas.length >= TOPE_DE_PESTANAS) return
    const una = nuevaPestana(def)
    setPestanas((previas) => [...previas, una])
    setMontadas((previas) => ({ ...previas, [una.id]: true }))
    setActiva(una.id)
  }

  function cerrar(id) {
    if (pestanas.length <= 1) return
    const donde = pestanas.findIndex((una) => una.id === id)
    const quedan = pestanas.filter((una) => una.id !== id)
    setPestanas(quedan)
    if (activa === id) elegir(quedan[Math.max(0, donde - 1)].id)
  }

  /** El visor de una pestaña dice qué está mirando, y con eso la pestaña se pone nombre. */
  const anotar = useCallback((id, def) => {
    setPestanas((previas) => previas.map((una) => (
      una.id === id && nombreDePestana(una.def) !== nombreDePestana(def) ? { ...una, def } : una
    )))
  }, [])

  const laActiva = pestanas.find((una) => una.id === activa) ?? pestanas[0]

  return (
    <div className="module-body a-pantalla-completa" ref={caja}>
      <div className="visor-pestanas">
        <div className="visor-pestanas-tira">
          {pestanas.map((una, indice) => (
            <span key={una.id} className="visor-pestana-caja">
              <button
                type="button"
                className={`bom-tab-btn${activa === una.id ? ' active' : ''}`}
                onClick={() => elegir(una.id)}
                title={nombreDePestana(una.def)}
              >
                {nombreDePestana(una.def) || `Pestaña ${indice + 1}`}
              </button>
              {pestanas.length > 1 && (
                <button
                  type="button"
                  className="bom-tab-close"
                  onClick={() => cerrar(una.id)}
                  title="Cerrar pestaña"
                  aria-label={`Cerrar ${nombreDePestana(una.def) || `pestaña ${indice + 1}`}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}

          <button
            type="button"
            className="bom-tab-btn"
            onClick={() => agregar()}
            disabled={pestanas.length >= TOPE_DE_PESTANAS}
            title={pestanas.length >= TOPE_DE_PESTANAS
              ? `Máximo de ${TOPE_DE_PESTANAS} pestañas abiertas`
              : 'Nueva pestaña'}
            aria-label="Nueva pestaña"
          >
            +
          </button>
          <button
            type="button"
            className="bom-tab-btn"
            onClick={() => agregar(laActiva?.def ?? null)}
            disabled={pestanas.length >= TOPE_DE_PESTANAS || !laActiva?.def}
            title="Duplicar pestaña (misma configuración, independiente)"
            aria-label="Duplicar pestaña"
          >
            ⧉
          </button>
        </div>

        {/* La pantalla completa la lleva el envoltorio y no el visor: así la tira de pestañas queda
            encima y se puede seguir saltando entre tablas con la tabla maximizada. */}
        <BotonPantallaCompleta {...pantalla} que="la tabla" />
      </div>

      {pestanas.filter((una) => montadas[una.id]).map((una) => (
        <div key={una.id} style={{ display: activa === una.id ? 'contents' : 'none' }}>
          {children({
            conexionId,
            inicial: una.def,
            activa: activa === una.id,
            onDefinicion: (def) => anotar(una.id, def),
          })}
        </div>
      ))}
    </div>
  )
}
