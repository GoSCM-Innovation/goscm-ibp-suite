// Tema claro y oscuro.
//
// Portado del comportamiento de v8: el tema se guarda como atributo en la raíz del documento
// y las variables de color hacen el resto. Se recuerda entre visitas, y si nunca se eligió se
// respeta lo que tenga configurado el sistema operativo.

const STORAGE_KEY = 'ibp.theme'

export function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Navegador con el almacenamiento bloqueado: se sigue con el del sistema.
  }
  const prefersLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
  return prefersLight ? 'light' : 'dark'
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Si no se puede recordar, el tema igual se aplica en esta visita.
  }
}
