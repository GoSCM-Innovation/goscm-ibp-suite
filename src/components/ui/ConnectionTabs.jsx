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
// UNA DIFERENCIA CON v9, y por qué: v9 pintaba un punto verde cuando la conexión tenía sesión abierta
// contra SAP, porque allí la sesión la abría el navegador. Aquí la sesión vive en el servidor y se
// renueva sola, así que ese punto estaría siempre verde y no diría nada. En su lugar va la marca de
// PRODUCTIVO, que es el estado que sí cambia lo que uno debe hacer con esa pestaña.

import ConnectionAvatar from './ConnectionAvatar.jsx'

export default function ConnectionTabs({ conexiones, abiertas, activa, onElegir, onCerrar }) {
  if (!abiertas || abiertas.length === 0) return null

  return (
    <div className="conn-tabs">
      {abiertas.map((id) => {
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
            title={`${conexion.name} — ${conexion.isProduction ? 'Productivo' : 'Sandbox'}`}
          >
            <ConnectionAvatar name={conexion.name} size={20} />
            <span className="conn-tab-nombre">{conexion.name}</span>
            <span
              className={`conn-tab-punto${conexion.isProduction ? ' productivo' : ''}`}
              aria-hidden="true"
            />
            {abiertas.length > 1 && (
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
  )
}
