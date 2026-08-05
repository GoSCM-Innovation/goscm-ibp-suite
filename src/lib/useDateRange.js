// El rango de fechas y la zona horaria de una pantalla que consulta a SAP.
//
// En v9 esto estaba escrito tres veces —el monitor, el resumen y el resumen global— con los mismos
// campos, la misma conversión de zona y los mismos errores. Aquí está una vez, con las tres reglas
// que hacen falta para no maltratar al tenant:
//
//   1. El rango se exige COMPLETO. Un campo de fecha va emitiendo lo que se escribe, incluido el
//      instante en que queda vacío, y una consulta sin rango hace que CI-DS devuelva el histórico
//      entero del tenant. v9 tenía este agujero en las tres copias.
//   2. Se aplica cuando dejás de escribir. Si no, escribir una fecha a mano son tres o cuatro
//      consultas de varios segundos cada una.
//   3. Hay un tope de días, que lo pone quien llama porque es una regla del servicio, no de aquí.

import { useEffect, useMemo, useState } from 'react'
import { daysBetween, fromInputValue, readStoredTzMode, storeTzMode, toInputValue } from './dates.js'

const DIA_MS = 86_400_000

/** Cuánto se espera sin tocar las fechas antes de consultar con el rango nuevo. */
const APLICAR_MS = 500

const rangoInicial = (zona, dias) => ({
  desde: toInputValue(new Date(Date.now() - dias * DIA_MS), zona),
  hasta: toInputValue(new Date(), zona),
})

export function useDateRange({ maxDays, diasIniciales = 7 } = {}) {
  const [zona, setZona] = useState(readStoredTzMode)
  // Lo que se escribe en los campos.
  const [rango, setRango] = useState(() => rangoInicial(readStoredTzMode(), diasIniciales))
  // Lo que se está consultando. No es lo mismo: ver la regla 2.
  const [rangoActivo, setRangoActivo] = useState(rango)

  const dias = daysBetween(rango.desde, rango.hasta, zona)
  const rangoIncompleto = dias === null
  const rangoExcedido = maxDays !== undefined && dias !== null && dias > maxDays
  const rangoValido = !rangoIncompleto && !rangoExcedido

  // Al cambiar de zona los campos tienen que seguir apuntando al mismo instante: lo que se mueve es
  // cómo se escribe, no qué se pidió. Por eso cambiar de zona no vuelve a consultar.
  function cambiarZona(nueva) {
    const desde = fromInputValue(rango.desde, zona)
    const hasta = fromInputValue(rango.hasta, zona)
    const escrito = {
      desde: desde ? toInputValue(desde, nueva) : rango.desde,
      hasta: hasta ? toInputValue(hasta, nueva) : rango.hasta,
    }
    setRango(escrito)
    setRangoActivo(escrito)
    setZona(nueva)
    storeTzMode(nueva)
  }

  // Al mover una punta más allá del tope se arrastra la otra, en vez de dejar un rango inválido y un
  // mensaje de error. Es lo que hacía el monitor de v9.
  function cambiarRango(punta, valor) {
    setRango((actual) => {
      const escrito = { ...actual, [punta]: valor }
      if (maxDays === undefined) return escrito
      const nuevoDias = daysBetween(escrito.desde, escrito.hasta, zona)
      if (nuevoDias === null || nuevoDias <= maxDays) return escrito

      const movida = fromInputValue(valor, zona)
      return punta === 'desde'
        ? { desde: valor, hasta: toInputValue(new Date(movida.getTime() + maxDays * DIA_MS), zona) }
        : { desde: toInputValue(new Date(movida.getTime() - maxDays * DIA_MS), zona), hasta: valor }
    })
  }

  // En el montaje el valor es el mismo objeto, así que React no repinta y la primera carga sale en
  // el acto: el retardo es solo para los cambios.
  useEffect(() => {
    if (!rangoValido) return undefined
    const espera = setTimeout(() => setRangoActivo(rango), APLICAR_MS)
    return () => clearTimeout(espera)
  }, [rango, rangoValido])

  // Las dos puntas ya en UTC, que es lo que entiende SAP. Salen como textos sueltos para que la
  // carga de quien llama dependa de ellos y no del objeto: así cambiar de zona, que no cambia el
  // instante, no vuelve a consultar.
  const { startDateFrom, startDateTo } = useMemo(() => {
    const desde = fromInputValue(rangoActivo.desde, zona)
    const hasta = fromInputValue(rangoActivo.hasta, zona)
    if (!desde || !hasta) return {}
    // El extremo se estira al final del minuto elegido: si no, una ejecución que arrancó a las
    // 12:30:40 queda fuera de un rango que termina a las 12:30.
    hasta.setSeconds(59, 999)
    return { startDateFrom: desde.toISOString(), startDateTo: hasta.toISOString() }
  }, [rangoActivo, zona])

  return {
    zona,
    rango,
    dias,
    rangoIncompleto,
    rangoExcedido,
    rangoValido,
    startDateFrom,
    startDateTo,
    cambiarZona,
    cambiarRango,
  }
}
