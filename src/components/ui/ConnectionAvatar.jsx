// La marca de una conexión: sus iniciales en un círculo de color.
//
// Portado de v9, sin la parte del logotipo: allí una conexión podía llevar la URL de una imagen y
// aquí el modelo de conexión no tiene ese campo. Se deja para cuando exista, si alguna vez hace
// falta; las iniciales ya cumplen la función, que es distinguir de un vistazo entre tenants en el
// tablero global.
//
// El color sale del nombre, así que la misma conexión siempre se ve igual sin guardar nada.

/** Doce tonos bien separados en el círculo cromático, para que dos vecinas no se confundan. */
const TONOS = 12

function tonoDe(nombre) {
  let acumulado = 0
  for (let i = 0; i < nombre.length; i += 1) {
    acumulado = (acumulado + nombre.charCodeAt(i) * (i + 1)) % (TONOS * 97)
  }
  return (acumulado % TONOS) * (360 / TONOS)
}

/** Las iniciales de las dos primeras palabras, o las dos primeras letras si es una sola. */
function inicialesDe(nombre) {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return '?'
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return (palabras[0][0] + palabras[1][0]).toUpperCase()
}

export default function ConnectionAvatar({ name, size = 24 }) {
  const nombre = String(name ?? '')
  const tono = tonoDe(nombre)

  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        background: `hsl(${tono} 55% 32%)`,
        color: `hsl(${tono} 70% 88%)`,
        fontSize: Math.max(8, Math.round(size * 0.4)),
        height: size,
        width: size,
      }}
    >
      {inicialesDe(nombre)}
    </span>
  )
}
