// La cabecera del sistema de CI-DS Tools.
//
// Portada de la de `System/SystemView.jsx` de v9: avatar, nombre y, debajo en letra mono,
// `dirección · organización · Producción|Sandbox`. Se puede contraer con ▴ y queda un botón con el
// avatar y ▾ para volver a abrirla.
//
// Lo que NO se porta: el banner de «Sesión SAP expirada» con su «Reconectar». La sesión contra SAP
// vive en el servidor y se renueva sola, así que no hay nada que reconectar desde la pantalla.

import { useState } from 'react'
import ConnectionAvatar from '../ui/ConnectionAvatar.jsx'

export default function CabeceraDeCids({ destino }) {
  const [contraida, setContraida] = useState(false)
  if (!destino) return null

  const partes = [destino.baseUrl, destino.organization, destino.production ? 'Producción' : 'Sandbox']
    .filter(Boolean)

  if (contraida) {
    return (
      <div className="cids-cabecera contraida">
        <button
          type="button"
          className="cids-cabecera-abrir"
          onClick={() => setContraida(false)}
          title={`${destino.name} — expandir cabecera`}
        >
          <ConnectionAvatar name={destino.name} size={20} />
          <span className="mono">▾</span>
        </button>
      </div>
    )
  }

  return (
    <div className="cids-cabecera">
      <ConnectionAvatar name={destino.name} size={34} />
      <div className="cids-cabecera-texto">
        <div className="cids-cabecera-nombre">{destino.name}</div>
        <div className="cids-cabecera-detalle mono">{partes.join(' · ')}</div>
      </div>
      <button
        type="button"
        className="cids-cabecera-cerrar"
        onClick={() => setContraida(true)}
        title="Contraer cabecera"
        aria-label="Contraer cabecera"
      >
        ▴
      </button>
    </div>
  )
}
