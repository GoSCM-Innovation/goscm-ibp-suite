// Cómo se nombra una conexión en un desplegable.
//
// Con un solo tenant el nombre basta. Con varios, no: dos conexiones se llaman «Tenant IBP» y «Tenant
// IBP · my400444» y hay que acordarse de cuál es cuál, en cada pantalla y cada vez. Elegir el tenant
// equivocado no da un error —da un análisis creíble de otro sistema—, así que el desplegable tiene que
// bastar por sí solo.
//
// Se añade el HOST, que es lo que identifica sin ambigüedad y lo que el consultor reconoce: los
// tenants de IBP se llaman `my400444-api.scmibp.ondemand.com`, y ese número es el nombre que usa SAP.
//
// No reemplaza poder renombrarlas —para eso está el botón en Administración—: es lo que hace que un
// nombre mal puesto no impida trabajar mientras nadie lo arregla.

/** El host de una dirección, sin el resto. Si no se puede leer, se devuelve tal cual. */
export function hostDe(baseUrl) {
  const crudo = String(baseUrl ?? '').trim()
  if (!crudo) return ''
  try {
    return new URL(crudo).host
  } catch {
    return crudo.replace(/^[a-z]+:\/\//i, '').split('/')[0]
  }
}

/**
 * La etiqueta de una conexión: su nombre y, si aporta algo, su host.
 *
 * El host se omite cuando el nombre ya lo contiene —«Tenant IBP · my400444» no necesita repetirlo— para
 * no convertir el desplegable en una lista de direcciones largas.
 */
export function etiquetaDeConexion(conexion) {
  const nombre = String(conexion?.name ?? '').trim()
  const host = hostDe(conexion?.baseUrl)
  if (!host) return nombre
  if (!nombre) return host

  // ¿El nombre ya identifica el tenant? Se compara contra la primera parte del host, que es lo que lo
  // distingue: `my400444-api.scmibp.ondemand.com` → `my400444`.
  const tenant = host.split('.')[0].replace(/-api$/, '')
  if (tenant && nombre.toLowerCase().includes(tenant.toLowerCase())) return nombre

  return `${nombre} — ${host}`
}

/**
 * El nombre como lo escribía v8: con el ambiente entre paréntesis al final, «CLARO CO (Producción)».
 *
 * v8 pedía el nombre y el ambiente por separado y los juntaba al guardar. Aquí el ambiente es la
 * marca de productivo de la conexión, así que se junta al mostrar. Si el nombre ya trae su
 * paréntesis, se respeta: no se adivina qué quiso decir quien lo escribió.
 */
export function nombreConAmbiente(conexion) {
  const nombre = String(conexion?.name ?? '').trim()
  if (/\([^)]*\)\s*$/.test(nombre)) return nombre
  return `${nombre} (${conexion?.isProduction ? 'Producción' : 'Calidad'})`
}
