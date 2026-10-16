// Las fechas de CI Tools: el formato en que van en el body (`AAAAMMDD`, como `20261005`).
//
// Pura, sin dependencias: la usan el servidor (para validar los ajustes de una orquestación) y la pantalla (`src/lib/fechas.js`, que la
// vuelve a exportar junto a lo que traduce al calendario del navegador).

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
