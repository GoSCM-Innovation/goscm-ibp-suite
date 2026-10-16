// Lo que CI Tools sabe de una orquestación: qué integraciones lleva, qué variables piden y si se puede lanzar.
//
// El motor (`core/orchestrations`) no sabe de integraciones: sabe de pasos. Cada paso de una orquestación de
// CI guarda en `data.integrationId` cuál integración ejecuta. Aquí se resuelve eso, para dos cosas:
//
//   - la pantalla, que antes de lanzar tiene que pedir los valores de las variables y decir qué se va a ejecutar;
//   - la validación de arranque, que impide lanzar una orquestación a medias: un paso que apunta a una
//     integración borrada, o una variable sin valor, se descubre ANTES del primer paso y no en el quinto, con
//     las cuatro primeras cargas ya hechas.

import { aplicarAjustes, ajustesDelLote, vistaDeBloque } from './ajustes.js'
import { getIntegrations } from './integrations.js'
import { esNombreDeVariable, leerBody, motivoDeValorInvalido, variablesDeBody, variablesDeFechaDeBloque } from './body.js'

/** Los pasos de una orquestación que ejecutan algo (no los grupos), en el orden en que se dibujaron. */
export const pasosDeIntegracion = (orquestacion) => (orquestacion?.nodes ?? []).filter((nodo) => nodo.type !== 'group')

/**
 * Qué lleva una orquestación: sus pasos con la integración de cada uno, las variables que piden entre todos
 * y qué pasos apuntan a una integración que no existe.
 *
 * `{ pasos: [{ nodeId, label, integrationId, integracion|null, variables, variablesDeFecha, cambios, avisos, errorDeAjustes,
 *    efectivo }], variables: [...], variablesDeFecha: [...], rotos: [nodeId] }`. `variablesDeFecha` son las variables que en TODOS los
 * pasos donde aparecen son una fecha (condición sobre `KEYFIGUREDATE`): se piden con un calendario.
 *
 * Todo sale del body CON LOS AJUSTES aplicados (los de la orquestación y los del paso), que es lo que se enviaría: una variable que un
 * ajuste reemplaza por una fecha fija deja de pedirse, y una que un ajuste agrega, se pide. `cambios` es lo que los ajustes cambian en
 * ese paso, `avisos` lo que ya no tiene a qué aplicarse, `errorDeAjustes` el motivo si unos ajustes no valen (y entonces no se puede
 * lanzar), y `efectivo` lo que el paso quedaría diciendo (área, versión, comando, origen y destino).
 */
export async function infoDeOrquestacion(clientId, orquestacion) {
  const nodos = pasosDeIntegracion(orquestacion)
  const integraciones = await getIntegrations(clientId, nodos.map((nodo) => nodo.data?.integrationId))
  const porId = new Map(integraciones.map((una) => [una.id, una]))

  const pasos = nodos.map((nodo) => {
    const integracion = porId.get(nodo.data?.integrationId) ?? null
    // Una integración de OTRA conexión tampoco vale: el paso correría contra un tenant que no es el de la orquestación.
    const valida = integracion && integracion.connectionId === orquestacion.connectionId

    let aplicado = null
    let errorDeAjustes = null
    if (valida) {
      try {
        aplicado = aplicarAjustes(integracion.body, { general: orquestacion.ajustes, paso: nodo.data?.ajustes })
      } catch (fallo) {
        errorDeAjustes = fallo.message
      }
    }
    // Con unos ajustes que no valen se lee el body original: igual no se podrá lanzar (`validarInicio`).
    const cuerpo = valida ? (aplicado?.texto ?? integracion.body) : ''
    const leido = valida ? leerBody(cuerpo) : { ok: false }
    const vista = leido.ok ? vistaDeBloque(leido.bloque) : null

    return {
      nodeId: nodo.id,
      label: nodo.data?.label ?? '',
      integrationId: nodo.data?.integrationId ?? null,
      integracion: valida ? integracion : null,
      variables: valida ? variablesDeBody(cuerpo) : [],
      variablesDeFecha: valida ? variablesDeFechaDeBloque(leido.bloque) : [],
      cambios: aplicado?.cambios ?? [],
      avisos: aplicado?.avisos ?? [],
      errorDeAjustes,
      efectivo: vista && {
        areaDePlanificacion: vista.areaDePlanificacion,
        version: vista.version,
        comando: vista.comando,
        sistemaOrigen: vista.sistemaOrigen,
        sistemaDestino: vista.sistemaDestino,
      },
    }
  })

  const variables = [...new Set(pasos.flatMap((paso) => paso.variables))].sort()

  return {
    pasos,
    variables,
    variablesDeFecha: variables.filter((nombre) => pasos.every((paso) => !paso.variables.includes(nombre) || paso.variablesDeFecha.includes(nombre))),
    rotos: pasos.filter((paso) => paso.integracion === null).map((paso) => paso.nodeId),
  }
}

/**
 * Lo que viaja con una ejecución, ya limpio: las variables que valen, quién la lanzó y los ajustes de la orquestación.
 *
 * `quien` sale de la sesión del servidor, no del cuerpo de la petición: el historial dice quién ejecutó, y eso
 * no lo puede decidir quien ejecuta. Los ajustes del lote tampoco vienen de la petición: salen de la orquestación guardada y se
 * fijan al lanzar, para que una ejecución (y su «Retomar») use siempre los mismos.
 */
export function defaultsDeCi(defaults, quien, ajustes = {}) {
  const crudas = defaults?.variables && typeof defaults.variables === 'object' && !Array.isArray(defaults.variables)
    ? defaults.variables
    : {}
  const variables = {}
  for (const [nombre, valor] of Object.entries(crudas)) {
    if (esNombreDeVariable(nombre) && typeof valor === 'string') variables[nombre] = valor
  }
  return { variables, startedBy: { id: quien?.id ?? null, email: quien?.email ?? null }, ajustes: ajustesDelLote(ajustes) }
}

/**
 * Comprueba que se pueda lanzar. Lanza con un mensaje que se pueda mostrar si no:
 *
 *   - la orquestación tiene que tener pasos, y cada uno tiene que apuntar a una integración que exista en
 *     esta conexión;
 *   - cada variable que piden las integraciones tiene que traer un valor que valga.
 */
export async function validarInicio(clientId, orquestacion, defaults) {
  const info = await infoDeOrquestacion(clientId, orquestacion)

  if (info.pasos.length === 0) throw new Error('La orquestación no tiene ninguna integración.')

  if (info.rotos.length > 0) {
    const nombres = info.pasos.filter((paso) => info.rotos.includes(paso.nodeId))
      .map((paso) => `«${paso.label || paso.nodeId}»`)
    throw new Error(
      `No se puede lanzar: ${nombres.join(', ')} ${nombres.length === 1 ? 'apunta' : 'apuntan'} a una integración `
      + 'que ya no existe en esta conexión. Cámbialo o quítalo.',
    )
  }

  // Unos ajustes que no valen no se descubren en el quinto paso: se dicen aquí, antes de enviar nada.
  const malos = info.pasos.filter((paso) => paso.errorDeAjustes)
  if (malos.length > 0) {
    const detalle = malos.map((paso) => `«${paso.label || paso.nodeId}»: ${paso.errorDeAjustes}`).join(' ')
    throw new Error(`No se puede lanzar: los ajustes no valen. ${detalle}`)
  }

  const valores = defaults?.variables ?? {}
  const sinValor = []
  const malas = []
  for (const nombre of info.variables) {
    const valor = Object.hasOwn(valores, nombre) ? valores[nombre] : undefined
    if (valor === undefined || valor === null || valor === '') sinValor.push(nombre)
    else {
      const motivo = motivoDeValorInvalido(valor)
      if (motivo) malas.push(`«${nombre}» ${motivo}`)
    }
  }
  if (sinValor.length > 0) throw new Error(`Falta el valor de ${sinValor.map((nombre) => `{{${nombre}}}`).join(', ')}.`)
  if (malas.length > 0) throw new Error(`Valor no válido: ${malas.join('; ')}.`)

  return info
}
