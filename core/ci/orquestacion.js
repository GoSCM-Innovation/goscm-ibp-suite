// Lo que CI Tools sabe de una orquestación: qué integraciones lleva, qué variables piden y si se puede lanzar.
//
// El motor (`core/orchestrations`) no sabe de integraciones: sabe de pasos. Cada paso de una orquestación de
// CI guarda en `data.integrationId` cuál integración ejecuta. Aquí se resuelve eso, para dos cosas:
//
//   - la pantalla, que antes de lanzar tiene que pedir los valores de las variables y decir qué se va a ejecutar;
//   - la validación de arranque, que impide lanzar una orquestación a medias: un paso que apunta a una
//     integración borrada, o una variable sin valor, se descubre ANTES del primer paso y no en el quinto, con
//     las cuatro primeras cargas ya hechas.

import { getIntegrations } from './integrations.js'
import { esNombreDeVariable, leerBody, motivoDeValorInvalido, variablesDeBody, variablesDeFechaDeBloque } from './body.js'

/** Los pasos de una orquestación que ejecutan algo (no los grupos), en el orden en que se dibujaron. */
export const pasosDeIntegracion = (orquestacion) => (orquestacion?.nodes ?? []).filter((nodo) => nodo.type !== 'group')

/**
 * Qué lleva una orquestación: sus pasos con la integración de cada uno, las variables que piden entre todos
 * y qué pasos apuntan a una integración que no existe.
 *
 * `{ pasos: [{ nodeId, label, integrationId, integracion|null, variables, variablesDeFecha }], variables: [...],
 *    variablesDeFecha: [...], rotos: [nodeId] }`. `variablesDeFecha` son las variables que en TODOS los pasos donde aparecen
 * son una fecha (condición sobre `KEYFIGUREDATE`): se piden con un calendario.
 */
export async function infoDeOrquestacion(clientId, orquestacion) {
  const nodos = pasosDeIntegracion(orquestacion)
  const integraciones = await getIntegrations(clientId, nodos.map((nodo) => nodo.data?.integrationId))
  const porId = new Map(integraciones.map((una) => [una.id, una]))

  const pasos = nodos.map((nodo) => {
    const integracion = porId.get(nodo.data?.integrationId) ?? null
    // Una integración de OTRA conexión tampoco vale: el paso correría contra un tenant que no es el de la orquestación.
    const valida = integracion && integracion.connectionId === orquestacion.connectionId
    return {
      nodeId: nodo.id,
      label: nodo.data?.label ?? '',
      integrationId: nodo.data?.integrationId ?? null,
      integracion: valida ? integracion : null,
      variables: valida ? variablesDeBody(integracion.body) : [],
      variablesDeFecha: valida ? variablesDeFechaDeBloque(leerBody(integracion.body).bloque) : [],
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
 * Lo que viaja con una ejecución, ya limpio: las variables que valen y quién la lanzó.
 *
 * `quien` sale de la sesión del servidor, no del cuerpo de la petición: el historial dice quién ejecutó, y eso
 * no lo puede decidir quien ejecuta.
 */
export function defaultsDeCi(defaults, quien) {
  const crudas = defaults?.variables && typeof defaults.variables === 'object' && !Array.isArray(defaults.variables)
    ? defaults.variables
    : {}
  const variables = {}
  for (const [nombre, valor] of Object.entries(crudas)) {
    if (esNombreDeVariable(nombre) && typeof valor === 'string') variables[nombre] = valor
  }
  return { variables, startedBy: { id: quien?.id ?? null, email: quien?.email ?? null } }
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
