// Cómo viajan las filas de telemetría del servidor a la pantalla.
//
// v8 leía los diez conjuntos desde el navegador y hacía las cuentas allí, sobre las filas. Aquí las
// cuentas se siguen haciendo en el navegador —así cambiar de usuario o de área es instantáneo, como
// en v8—, pero las filas las lee el servidor y tienen que caber en una respuesta de Vercel (4,5 MB).
// Treinta días de `MtrgGenericUIActionUsage` son 15.623 filas en un tenant mediano; como objetos de
// JSON serían varios megas. Tres cosas las dejan en unos pocos cientos de kB sin perder nada de lo
// que la pantalla usa:
//
//   1. SOLO LOS CAMPOS QUE LA PANTALLA MIRA. Los pide `core/ibp/metering.js` con `$select`.
//   2. SOLO EL DÍA DE CADA MARCA DE TIEMPO. v8 nunca usó la hora: agrupa por día (`dayKey`) y lo que
//      muestra como «Último» o «Primera actividad» es `slice(0, 10)` de la marca. Se manda el día con
//      la misma cuenta, así que el resultado es el mismo.
//   3. CADA VALOR UNA SOLA VEZ, y cada fila repetida una sola vez con cuántas veces aparece. El nombre
//      de una aplicación se repite miles de veces, y una vez recortada al día, la actividad de una
//      persona en una aplicación ese día es la misma fila repetida.
//
// La fila repetida se vuelve a expandir en la posición de su primera aparición. Lo que v8 calculaba
// dependiendo del orden —el orden de aparición de las áreas de un usuario, el de los empates de los
// rankings— se conserva: una fila que se adelanta hasta su gemela nunca pasa delante de la primera
// aparición de otro valor.
//
// Sin dependencias a propósito: lo usan el servidor, para compactar, y la pantalla, para expandir.

/**
 * El día de una marca de tiempo, tal como lo sacaba v8 (`dayKey` de `Metering.jsx`): de una fecha de
 * OData v2 (`/Date(…)/`) el día UTC; de una ISO, sus diez primeros caracteres.
 */
export function dayKey(iso) {
  if (!iso) return '?'
  if (String(iso).startsWith('/Date(')) {
    const ms = parseInt(String(iso).replace(/\/Date\((\d+)[^)]*\)\//, '$1'), 10)
    return new Date(ms).toISOString().slice(0, 10)
  }
  return String(iso).slice(0, 10)
}

/**
 * Las filas de SAP en su forma compacta: `{ campos, valores, filas }`.
 *
 * `valores[i]` son los valores distintos del campo `campos[i]`; cada fila es la lista de posiciones en
 * esos valores y, al final, cuántas veces aparece. Un campo que la fila no trae viaja como `null`, que
 * es lo que SAP escribe en OData v4 cuando un campo está vacío.
 *
 * `soloElDia` son los campos de fecha que se recortan al día (ver el punto 2 de la cabecera).
 */
export function compactRows(filas, campos, { soloElDia = [] } = {}) {
  const alDia = new Set(soloElDia)
  const valores = campos.map(() => [])
  const posiciones = campos.map(() => new Map())
  const yaVistas = new Map()
  const salida = []

  for (const fila of filas ?? []) {
    const codigos = campos.map((campo, i) => {
      let valor = fila?.[campo] ?? null
      // Una marca vacía se deja vacía: v8 las descartaba con `filter(Boolean)` y el día de una
      // marca vacía sería «?», que no se descarta.
      if (valor && alDia.has(campo)) valor = dayKey(valor)
      let posicion = posiciones[i].get(valor)
      if (posicion === undefined) {
        posicion = valores[i].length
        valores[i].push(valor)
        posiciones[i].set(valor, posicion)
      }
      return posicion
    })

    const firma = codigos.join(',')
    const previa = yaVistas.get(firma)
    if (previa === undefined) {
      yaVistas.set(firma, salida.length)
      salida.push([...codigos, 1])
    } else {
      salida[previa][campos.length] += 1
    }
  }

  return { campos: [...campos], valores, filas: salida }
}

/**
 * De vuelta a filas de objetos, como las veía v8.
 *
 * Solo llevan los campos que se pidieron: uno que el servicio no declara queda `undefined`, igual que
 * en v8 cuando SAP no lo mandaba. Las repeticiones son el MISMO objeto: nadie las modifica y así no se
 * multiplican en memoria.
 */
export function expandRows(compacto) {
  const campos = compacto?.campos ?? []
  const valores = compacto?.valores ?? []
  const salida = []

  for (const fila of compacto?.filas ?? []) {
    const objeto = {}
    campos.forEach((campo, i) => { objeto[campo] = valores[i]?.[fila[i]] ?? null })
    const veces = fila[campos.length] ?? 1
    for (let n = 0; n < veces; n += 1) salida.push(objeto)
  }

  return salida
}
