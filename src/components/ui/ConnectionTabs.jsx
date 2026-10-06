// La tira de pestañas de conexiones, arriba del contenido.
//
// Portada de `ConnectionTabs.jsx` de v9. Es lo que permite saltar entre varios tenants sin perder lo
// que cada uno tenía cargado — comparar dos sistemas es la mitad del trabajo de una migración, y con
// un desplegable de uno solo hay que ir y volver.
//
// Aquí sustituye al desplegable que había en IBP Tools y CI-DS Tools. El menú lateral no puede
// llevarlas como en v8 —el de aquí lista los tres módulos de la suite, no los tenants—, así que las
// pestañas viven arriba del contenido del módulo, que es exactamente donde v9 las ponía.
//
// UNA DIFERENCIA CON v9, decidida por el usuario el 2026-10-05: v9 dibujaba solo las conexiones
// ABIERTAS (se abrían desde el menú lateral) y esta tira las dibujaba igual, con un «+» para abrir el
// resto. Ahora están TODAS siempre a la vista, una pestaña por conexión: pulsarla la activa. Sin
// «abrir» ni «cerrar» no hacen falta ni el «+» ni la ✕, y nadie tiene que ir a buscar una conexión
// que no sabía que estaba escondida. Si no caben en una línea, pasan a la siguiente: con scroll
// horizontal la que no se ve es justo la que alguien busca.
//
// UNA DIFERENCIA CON v9, y por qué: v9 pintaba un punto verde cuando la conexión tenía sesión abierta
// contra SAP, porque allí la sesión la abría el navegador. Aquí la sesión vive en el servidor y se
// renueva sola, así que ese punto estaría siempre verde y no diría nada. En su lugar va la marca de
// PRODUCTIVO, que es el estado que sí cambia lo que uno debe hacer con esa pestaña.
//
// OTRA DIFERENCIA CON v8 Y v9, pedida por el usuario el 2026-10-06: ellas pintaban bajo la tira una
// franja con el nombre, la dirección y (v8) el enlace «Abrir en SAP IBP ↗». Aquí esa información vive
// en la propia tira para que el contenido suba: la pestaña activa se ensancha, lleva el enlace suelto
// (`detalle.enlace`) y un «ⓘ» que abre el resto (`detalle.filas`). Quien no pasa `detalleDe` —Data
// Tools— no lleva ni «ⓘ» ni enlace.

import { useEffect, useState } from 'react'
import ConnectionAvatar from './ConnectionAvatar.jsx'

/** Cómo se lee una conexión. Es el texto del `title` de la pestaña. */
const queEs = (conexion) => (conexion.isProduction ? 'Productivo' : 'Sandbox')

/** Lo que dice el tooltip de cada pestaña: nombre, ambiente y, si se conoce, la dirección. */
const tooltipDe = (conexion) => (
  [`${conexion.name} — ${queEs(conexion)}`, conexion.baseUrl].filter(Boolean).join('\n')
)

/**
 * `inicio`, si viene, es una pestaña fija delante de las conexiones: `{ icono, nombre, activa,
 * onElegir }`. La usa IBP Tools para el «📊 Resumen» global, que en v8 estaba en el menú lateral
 * junto a la lista de conexiones y no dentro de ninguna.
 *
 * `detalleDe(conexion)`, si viene, devuelve el detalle de la conexión para su pestaña activa:
 * `{ titulo, filas: [[etiqueta, valor]], enlace: { url, texto } | null }`.
 */
export default function ConnectionTabs({ conexiones, activa, onElegir, inicio = null, detalleDe = null }) {
  // El cuadro de detalle abierto, por id de conexión. Solo se ve mientras esa conexión es la activa:
  // al elegir otra deja de coincidir y se cierra solo.
  const [abierto, setAbierto] = useState(null)
  const detalleAbierto = abierto !== null && abierto === activa && !inicio?.activa

  useEffect(() => {
    if (!detalleAbierto) return undefined
    const cerrar = () => setAbierto(null)
    const alTeclear = (evento) => { if (evento.key === 'Escape') cerrar() }
    // Un clic fuera lo cierra; los de dentro paran antes de llegar aquí (`stopPropagation` abajo).
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', cerrar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [detalleAbierto])

  if (!conexiones || conexiones.length === 0) return null

  return (
    <div className="conn-tabs-fila">
      <div className="conn-tabs">
        {inicio && (
          <div
            role="button"
            tabIndex={0}
            className={`conn-tab${inicio.activa ? ' active' : ''}`}
            onClick={inicio.onElegir}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); inicio.onElegir() }
            }}
            title={inicio.nombre}
          >
            <span aria-hidden="true">{inicio.icono}</span>
            <span className="conn-tab-nombre">{inicio.nombre}</span>
          </div>
        )}
        {conexiones.map((conexion) => {
          const esActiva = activa === conexion.id && !inicio?.activa
          const detalle = esActiva && detalleDe ? detalleDe(conexion) : null

          return (
            <div
              key={conexion.id}
              role="button"
              tabIndex={0}
              className={`conn-tab${esActiva ? ' active' : ''}`}
              onClick={() => onElegir(conexion.id)}
              onKeyDown={(evento) => {
                // Los controles de dentro (enlace, «ⓘ») tienen su propio teclado.
                if (evento.target !== evento.currentTarget) return
                if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onElegir(conexion.id) }
              }}
              title={tooltipDe(conexion)}
            >
              {/* El avatar sale del nombre de la conexión, no del texto de la pestaña: con «CLARO · Sandbox»
                  las iniciales eran «C·». */}
              <ConnectionAvatar name={conexion.avatar ?? conexion.name} size={20} />
              <span className="conn-tab-nombre">{conexion.name}</span>
              <span
                className={`conn-tab-punto${conexion.isProduction ? ' productivo' : ''}`}
                aria-hidden="true"
              />
              {detalle && (
                <>
                  {detalle.enlace && (
                    <a
                      className="conn-tab-icono"
                      href={detalle.enlace.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={detalle.enlace.texto}
                      aria-label={detalle.enlace.texto}
                      onMouseDown={(evento) => evento.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}
                  <button
                    type="button"
                    className="conn-tab-icono"
                    title="Ver detalle de la conexión"
                    aria-label="Ver detalle de la conexión"
                    aria-expanded={detalleAbierto}
                    onMouseDown={(evento) => evento.stopPropagation()}
                    onClick={(evento) => { evento.stopPropagation(); setAbierto(detalleAbierto ? null : conexion.id) }}
                  >
                    ⓘ
                  </button>
                  {detalleAbierto && (
                    <div
                      className="conn-detalle"
                      role="dialog"
                      aria-label={`Detalle de ${detalle.titulo}`}
                      onMouseDown={(evento) => evento.stopPropagation()}
                      onClick={(evento) => evento.stopPropagation()}
                    >
                      <div className="conn-detalle-titulo">{detalle.titulo}</div>
                      <dl className="conn-detalle-filas">
                        {detalle.filas.map(([etiqueta, valor]) => (
                          <div key={etiqueta}>
                            <dt>{etiqueta}</dt>
                            <dd className="mono">{valor}</dd>
                          </div>
                        ))}
                      </dl>
                      {detalle.enlace && (
                        <a className="conn-detalle-enlace" href={detalle.enlace.url} target="_blank" rel="noopener noreferrer">
                          {detalle.enlace.texto}
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
