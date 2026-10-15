// Las fechas de CI Tools: el formato en que van en el body (`AAAAMMDD`, como `20261005`) y el del calendario del navegador
// (`AAAA-MM-DD`). El body usa el primero, tal cual aparece en los bodies reales; el campo de fecha del navegador, el segundo.
//
// Pura, sin dependencias: la usan la pantalla y las pruebas.

/** ¿Es una fecha real escrita como `AAAAMMDD`? `20261301` y `20260230` no lo son. */
export function esFechaAAAAMMDD(valor) {
  const texto = String(valor ?? '')
  if (!/^\d{8}$/.test(texto)) return false
  const anio = Number(texto.slice(0, 4))
  const mes = Number(texto.slice(4, 6))
  const dia = Number(texto.slice(6, 8))
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
}

/** De `AAAAMMDD` a lo que entiende el calendario del navegador. Lo que no es una fecha, vacío. */
export const aFechaDelCalendario = (valor) => (
  esFechaAAAAMMDD(valor) ? `${valor.slice(0, 4)}-${valor.slice(4, 6)}-${valor.slice(6, 8)}` : ''
)

/** Del calendario del navegador a `AAAAMMDD`. Vacío o lo que no es una fecha, vacío. */
export function deFechaDelCalendario(valor) {
  const coincidencia = String(valor ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const texto = coincidencia ? `${coincidencia[1]}${coincidencia[2]}${coincidencia[3]}` : ''
  return esFechaAAAAMMDD(texto) ? texto : ''
}

/** El campo del filtro que lleva fechas. */
export const CAMPO_DE_FECHA = 'KEYFIGUREDATE'

/** ¿Es este el campo de fecha? Sin distinguir mayúsculas. */
export const esCampoDeFecha = (campo) => String(campo ?? '').trim().toUpperCase() === CAMPO_DE_FECHA
