// Copiar al portapapeles.
//
// Portado de v9, con su respaldo incluido: la API moderna solo funciona en un contexto seguro, y
// en desarrollo no siempre lo hay. Sin el respaldo, el botón de copiar no hace nada justo cuando
// se está probando.

/** Copia texto y dice si pudo. Nunca lanza: quien llama solo quiere pintar un tilde o una cruz. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Sin permiso o fuera de contexto seguro: se intenta a la vieja usanza.
  }
  return copiarALaVieja(text)
}

function copiarALaVieja(text) {
  try {
    const campo = document.createElement('textarea')
    campo.value = text
    // Fuera de la vista pero dentro del documento: si no está en el documento no se puede
    // seleccionar, y sin selección no hay copia.
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    const pudo = document.execCommand('copy')
    document.body.removeChild(campo)
    return pudo
  } catch {
    return false
  }
}
