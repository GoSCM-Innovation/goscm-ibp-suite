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

import ConnectionAvatar from './ConnectionAvatar.jsx'

/** Cómo se lee una conexión. Es el texto del `title` de la pestaña. */
const queEs = (conexion) => (conexion.isProduction ? 'Productivo' : 'Sandbox')

/**
 * `inicio`, si viene, es una pestaña fija delante de las conexiones: `{ icono, nombre, activa,
 * onElegir }`. La usa IBP Tools para el «📊 Resumen» global, que en v8 estaba en el menú lateral
 * junto a la lista de conexiones y no dentro de ninguna.
 */
export default function ConnectionTabs({ conexiones, activa, onElegir, inicio = null }) {
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

          return (
            <div
              key={conexion.id}
              role="button"
              tabIndex={0}
              className={`conn-tab${esActiva ? ' active' : ''}`}
              onClick={() => onElegir(conexion.id)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onElegir(conexion.id) }
              }}
              title={`${conexion.name} — ${queEs(conexion)}`}
            >
              {/* El avatar sale del nombre de la conexión, no del texto de la pestaña: con «CLARO · Sandbox»
                  las iniciales eran «C·». */}
              <ConnectionAvatar name={conexion.avatar ?? conexion.name} size={20} />
              <span className="conn-tab-nombre">{conexion.name}</span>
              <span
                className={`conn-tab-punto${conexion.isProduction ? ' productivo' : ''}`}
                aria-hidden="true"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
