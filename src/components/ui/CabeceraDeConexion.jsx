// La cabecera de la conexión que se está mirando: quién es y cómo llegar a ella.
//
// Portada de la cabecera de `System/SystemView.jsx` de v8: avatar, nombre, y el enlace «Abrir en
// SAP IBP ↗» que lleva al launchpad del tenant.
//
// Por qué vale la pena: la mitad de lo que se hace aquí termina en «y esto en SAP, ¿cómo se ve?». Sin
// el enlace hay que acordarse del host del tenant y escribirlo a mano, y con cuatro tenants abiertos
// es exactamente donde alguien acaba mirando el sistema equivocado.
//
// LO QUE NO SE PORTA, y por qué: v8 tenía además un botón «Cerrar sesión» por conexión, porque allí
// la sesión contra SAP la abría el navegador y había que poder soltarla. Aquí las credenciales viven
// cifradas en el servidor y la sesión la renueva él solo: no hay nada que cerrar desde la pantalla.

import ConnectionAvatar from './ConnectionAvatar.jsx'
import { urlDeSap } from '../../lib/url-de-sap.js'

export default function CabeceraDeConexion({ conexion }) {
  if (!conexion) return null
  const enlace = urlDeSap(conexion.baseUrl)

  return (
    <div className="conn-cabecera">
      <ConnectionAvatar name={conexion.name} size={34} />
      <div className="conn-cabecera-texto">
        <div className="conn-cabecera-nombre">{conexion.name}</div>
        {enlace && (
          <a
            className="conn-cabecera-enlace"
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir en SAP IBP ↗
          </a>
        )}
      </div>
      {conexion.isProduction && <span className="tag tag-accent">Productivo</span>}
    </div>
  )
}
