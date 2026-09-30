// La cabecera de la conexión que se está mirando en IBP Tools.
//
// Portada tal cual de la cabecera de `System/SystemView.jsx` de v8: una franja de lado a lado con el
// avatar cuadrado de v8 —con su punto de ambiente—, el nombre con el ambiente entre paréntesis, y
// el enlace «Abrir en SAP IBP ↗» que lleva al launchpad del tenant.
//
// El nombre: v8 guardaba la conexión como «CLARO CO (Producción)», porque su formulario pedía el
// nombre y el ambiente por separado y los juntaba. Aquí el ambiente es la marca de productivo de la
// conexión, así que se junta al mostrar. Si el nombre ya trae su paréntesis, se respeta.
//
// LO QUE NO SE PORTA, y por qué: el botón «Cerrar sesión» de v8. Allí la sesión contra SAP la abría
// el navegador y había que poder soltarla. Aquí las credenciales viven cifradas en el servidor y la
// sesión la renueva él solo: no hay nada que cerrar desde la pantalla.

import { nombreConAmbiente } from '../../lib/nombre-de-conexion.js'
import { urlDeSap } from '../../lib/url-de-sap.js'
import { useIsMobile } from '../../lib/useIsMobile.js'

const COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#EF4444', '#06B6D4', '#F97316',
]

function colorFor(name = '') {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return COLORS[Math.abs(hash) % COLORS.length]
}

function initials(name = '') {
  const base = name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim()
  const words = base.split(/\s+/).filter(Boolean)
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')
}

function envDotColor(name = '') {
  const match = name.trim().match(/\(([^)]+)\)\s*$/)
  if (!match) return null
  const env = match[1].trim()
  if (/calidad/i.test(env)) return '#F59E0B'
  if (/producci[oó]n/i.test(env)) return '#3B82F6'
  if (/desarrollo/i.test(env)) return '#8B5CF6'
  return '#6B7280'
}

/** El avatar de v8: cuadrado redondeado, color por nombre y el punto del ambiente abajo a la derecha. */
export function AvatarV8({ name, size = 36 }) {
  const dotColor = envDotColor(name)
  const dotSize = Math.max(8, Math.round(size * 0.28))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: 8, background: colorFor(name),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.36, color: '#fff',
        userSelect: 'none',
      }}>
        {initials(name)}
      </div>
      {dotColor && (
        <span style={{
          position: 'absolute', bottom: -2, right: -2,
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: dotColor, border: '2px solid var(--bg2)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  )
}

export default function CabeceraDeConexion({ conexion }) {
  const isMobile = useIsMobile()
  if (!conexion) return null
  const nombre = nombreConAmbiente(conexion)
  const enlace = urlDeSap(conexion.baseUrl)

  return (
    <div style={{
      background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
      padding: isMobile ? '10px 12px' : '12px 24px',
      display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
    }}>
      <AvatarV8 name={nombre} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{nombre}</div>
        {enlace && (
          <a
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2, display: 'inline-block', textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
            onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
          >
            Abrir en SAP IBP ↗
          </a>
        )}
      </div>
    </div>
  )
}
