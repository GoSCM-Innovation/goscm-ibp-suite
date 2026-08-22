// Qué decirle a alguien cuando SAP contesta que no.
//
// El transporte devuelve `SAP devolvió 403` y eso es cierto, pero deja al consultor sin nada que
// hacer: no dice qué mirar ni dónde. Y en esta aplicación un 401 o un 403 casi nunca es un misterio,
// porque cada llamada sale por UN acuerdo de comunicación conocido, y esos dos códigos solo pueden
// significar dos cosas.
//
// Se vio en la pantalla de recursos: decía «✕ SAP devolvió 403» y a su lado la de consumo decía «la
// conexión no tiene configurado el acuerdo SAP_COM_0924». La segunda se entiende y la primera no, y
// las dos son el mismo tipo de problema. La diferencia era solo que en un caso el acuerdo ni estaba
// registrado —y ese mensaje ya existía— y en el otro sí estaba, pero su usuario no alcanza.
//
// No se inventa el diagnóstico: se dice qué acuerdo se usó y qué significan esos códigos en SAP, que
// es información que el servidor tiene y la pantalla no.

/** Los códigos que hablan de permisos, no de datos. */
const DE_PERMISOS = new Set([401, 403])

/**
 * El mensaje para un fallo de SAP, sabiendo por qué acuerdo salió la llamada.
 *
 * `acuerdos` puede ser uno o varios: varios significa que la llamada se hizo con el primero que
 * estuviera registrado, así que hay que nombrarlos todos —el consultor no sabe cuál se usó, y
 * nombrar solo el primero lo mandaría a revisar el que no falló—.
 *
 * Lo que no es de permisos se devuelve tal cual: un 404 o un `TSV_TNEW_PAGE_ALLOC_FAILED` ya dicen lo
 * suyo, y añadirles una explicación inventada los haría peores.
 */
export function explicarFallo(error, acuerdos) {
  const mensaje = String(error?.message ?? error ?? 'Falló la llamada a SAP.')
  if (!DE_PERMISOS.has(error?.status)) return mensaje

  const cuales = (Array.isArray(acuerdos) ? acuerdos : [acuerdos]).filter(Boolean)
  if (cuales.length === 0) return mensaje

  const nombrados = cuales.length === 1
    ? `del acuerdo ${cuales[0]}`
    : `de alguno de los acuerdos ${cuales.join(' o ')}`

  const causa = error.status === 401
    ? `el usuario ${nombrados} tiene mal la contraseña, o está bloqueado`
    : `el usuario ${nombrados} no tiene permiso para este servicio`

  return `${mensaje}: ${causa}. `
    + 'En SAP se revisa en el acuerdo de comunicación: que su usuario exista, que el escenario esté '
    + 'activo y que el servicio de este módulo esté habilitado ahí.'
}
