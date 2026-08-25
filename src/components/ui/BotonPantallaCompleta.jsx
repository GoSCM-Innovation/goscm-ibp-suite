// El botón de pantalla completa. Uno solo, para que las seis pantallas que lo llevan digan lo mismo.
//
// Se esconde si el navegador no sabe: un botón que no hace nada es peor que no tener botón.

export default function BotonPantallaCompleta({ activa, alternar, disponible, que = 'la vista' }) {
  if (!disponible) return null

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={alternar}
      title={activa ? 'Volver al tamaño normal (Escape)' : `Ver ${que} a pantalla completa`}
    >
      {activa ? '⤡ Salir' : '⤢ Pantalla completa'}
    </button>
  )
}
