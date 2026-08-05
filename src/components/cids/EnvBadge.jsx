// PROD o SAND: de qué tipo es el tenant, en dos letras.
//
// Portado de v9. Vale la pena aunque el nombre de la conexión ya lo insinúe: en el tablero global
// hay varias conexiones a la vez, y confundir producción con pruebas al leer una tarea fallida es un
// error caro.

export default function EnvBadge({ isProduction }) {
  return (
    <span className={`env-badge${isProduction ? ' prod' : ''}`}>
      {isProduction ? 'PROD' : 'SAND'}
    </span>
  )
}
