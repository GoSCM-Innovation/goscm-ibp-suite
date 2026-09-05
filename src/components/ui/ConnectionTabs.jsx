// La tira de pestañas de conexiones abiertas, arriba del contenido.
//
// Portada de `ConnectionTabs.jsx` de v9. Es lo que permite tener VARIOS tenants abiertos a la vez y
// saltar entre ellos sin perder lo que cada uno tenía cargado — comparar dos sistemas es la mitad del
// trabajo de una migración, y con un desplegable de uno solo hay que ir y volver.
//
// Aquí sustituye al desplegable que había en IBP Tools y CI-DS Tools. El menú lateral no puede
// llevarlas como en v8 —el de aquí lista los tres módulos de la suite, no los tenants—, así que las
// pestañas viven arriba del contenido del módulo, que es exactamente donde v9 las ponía.
//
// EL «+» ES LA PIEZA QUE FALTABA, y su falta dejaba el módulo encerrado. En v9 una conexión se abría
// pulsándola EN EL MENÚ LATERAL, que listaba los tenants; su tira solo dibujaba las ya abiertas. Aquí
// el menú lateral lista módulos, así que nadie se quedó con ese trabajo: la función de abrir existía
// y no había ningún control que la llamara. Con una sola pestaña no había forma de cambiar de tenant.
//
// UNA DIFERENCIA CON v9, y por qué: v9 pintaba un punto verde cuando la conexión tenía sesión abierta
// contra SAP, porque allí la sesión la abría el navegador. Aquí la sesión vive en el servidor y se
// renueva sola, así que ese punto estaría siempre verde y no diría nada. En su lugar va la marca de
// PRODUCTIVO, que es el estado que sí cambia lo que uno debe hacer con esa pestaña.

import { useEffect, useRef, useState } from 'react'

import ConnectionAvatar from './ConnectionAvatar.jsx'

/** Cómo se lee una conexión en el desplegable. Es el mismo texto que el `title` de la pestaña. */
const queEs = (conexion) => (conexion.isProduction ? 'Productivo' : 'Sandbox')

export default function ConnectionTabs({ conexiones, abiertas, activa, onElegir, onCerrar }) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const caja = useRef(null)

  // Se cierra al pulsar fuera o con Escape. Un desplegable que solo se cierra volviendo a pulsar el
  // botón que lo abrió tapa el contenido de debajo y hay que ir a buscarlo.
  useEffect(() => {
    if (!menuAbierto) return undefined

    const fuera = (evento) => {
      if (!caja.current?.contains(evento.target)) setMenuAbierto(false)
    }
    const escape = (evento) => { if (evento.key === 'Escape') setMenuAbierto(false) }

    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [menuAbierto])

  if (!conexiones || conexiones.length === 0) return null

  const puestas = new Set(abiertas ?? [])
  // Solo vale ofrecer el «+» si hay algo que abrir que no esté ya abierto.
  const hayMasQueAbrir = conexiones.some((una) => !puestas.has(una.id))

  return (
    // El «+» va FUERA de la tira, no dentro. La tira hace scroll horizontal —lo necesita: con seis
    // tenants abiertos no caben— y `overflow-x: auto` RECORTA todo lo que se salga, así que un
    // desplegable colgado ahí dentro no se vería. Además así el «+» sigue a la vista cuando la tira
    // está desplazada, que es justo cuando hace falta.
    <div className="conn-tabs-fila">
      <div className="conn-tabs">
        {(abiertas ?? []).map((id) => {
          const conexion = conexiones.find((una) => una.id === id)
          if (!conexion) return null
          const esActiva = activa === id

          return (
            <div
              key={id}
              role="button"
              tabIndex={0}
              className={`conn-tab${esActiva ? ' active' : ''}`}
              onClick={() => onElegir(id)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); onElegir(id) }
              }}
              title={`${conexion.name} — ${queEs(conexion)}`}
            >
              <ConnectionAvatar name={conexion.name} size={20} />
              <span className="conn-tab-nombre">{conexion.name}</span>
              <span
                className={`conn-tab-punto${conexion.isProduction ? ' productivo' : ''}`}
                aria-hidden="true"
              />
              {(abiertas ?? []).length > 1 && (
                <button
                  type="button"
                  className="conn-tab-cerrar"
                  onClick={(evento) => { evento.stopPropagation(); onCerrar(id) }}
                  title="Cerrar pestaña"
                  aria-label={`Cerrar ${conexion.name}`}
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </div>

      {hayMasQueAbrir && (
        <div className="conn-tabs-mas" ref={caja}>
          <button
            type="button"
            className="conn-tabs-mas-btn"
            onClick={() => setMenuAbierto((previo) => !previo)}
            title="Abrir otra conexión"
            aria-label="Abrir otra conexión"
            aria-expanded={menuAbierto}
            aria-haspopup="menu"
          >
            +
          </button>

          {menuAbierto && (
            <div className="conn-tabs-menu" role="menu">
              <div className="conn-tabs-menu-titulo">Abrir otra conexión</div>
              {conexiones.map((una) => {
                const yaEsta = puestas.has(una.id)
                return (
                  <button
                    key={una.id}
                    type="button"
                    role="menuitem"
                    className="conn-tabs-opcion"
                    disabled={yaEsta}
                    onClick={() => { setMenuAbierto(false); onElegir(una.id) }}
                  >
                    <ConnectionAvatar name={una.name} size={18} />
                    <span className="conn-tabs-opcion-nombre">{una.name}</span>
                    {/* Productivo o sandbox va SIEMPRE a la vista, y no solo en un `title`: es lo
                        que cambia lo que uno debe hacer ahí, y se elige antes de entrar. */}
                    <span className={`exp-sub${una.isProduction ? ' conn-tabs-productivo' : ''}`}>
                      {yaEsta ? 'ya abierta' : queEs(una)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
