// Cómo se agrupan las listas de Administración: conexiones por tipo, personas por permiso y clientes por estado.
//
// Una lista larga se vuelve un puñado de filas que se abren de una en una (ver `ui/SeccionPlegable.jsx`). Aquí está solo
// la parte que decide en qué grupo cae cada cosa, sin pantalla, para que se pueda probar.

export const GRUPOS_DE_CONEXION = Object.freeze([
  { id: 'ibp', titulo: 'SAP IBP' },
  { id: 'cids', titulo: 'CI-DS' },
  { id: 'ci', titulo: 'Cloud Integration' },
])

export const GRUPOS_DE_PERSONA = Object.freeze([
  { id: 'plataforma', titulo: 'Plataforma' },
  { id: 'admin', titulo: 'Admin' },
  { id: 'usuario', titulo: 'Usuario' },
  { id: 'baja', titulo: 'De baja' },
])

export const GRUPOS_DE_CLIENTE = Object.freeze([
  { id: 'activos', titulo: 'Activos' },
  { id: 'suspendidos', titulo: 'Suspendidos' },
])

/**
 * El grupo de una persona: el permiso más alto que tiene (plataforma, admin, usuario). Quien está de baja va aparte,
 * tenga el permiso que tenga: lo que se busca en ese grupo es a quién ya no entra.
 */
export function grupoDePersona(persona) {
  if (persona.status !== 'active') return 'baja'
  if (persona.isPlatformAdmin) return 'plataforma'
  if (persona.isAdmin) return 'admin'
  return 'usuario'
}

export const grupoDeCliente = (cliente) => (cliente.status === 'active' ? 'activos' : 'suspendidos')

/**
 * Reparte `elementos` en los `grupos`, en el orden de los grupos y conservando el orden de cada uno. Todos los grupos
 * salen, también los vacíos. Lo que no cae en ninguno (un tipo nuevo que esta lista no conoce) va a un grupo «Otros»
 * al final, que solo existe si hace falta: nada queda invisible.
 */
export function agrupar(elementos, grupos, grupoDe) {
  const conocidos = new Set(grupos.map((uno) => uno.id))
  const resultado = grupos.map((grupo) => ({ ...grupo, elementos: elementos.filter((uno) => grupoDe(uno) === grupo.id) }))
  const sueltos = elementos.filter((uno) => !conocidos.has(grupoDe(uno)))
  if (sueltos.length > 0) resultado.push({ id: 'otros', titulo: 'Otros', elementos: sueltos })
  return resultado
}

/** Los primeros nombres, para que un grupo cerrado diga qué tiene: «a, b, c +2». Sin nombres, nada. */
export function resumenDeNombres(nombres, maximo = 3) {
  if (nombres.length === 0) return ''
  const primeros = nombres.slice(0, maximo).join(', ')
  return nombres.length > maximo ? `${primeros} +${nombres.length - maximo}` : primeros
}
