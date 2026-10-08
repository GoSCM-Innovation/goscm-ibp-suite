// POST /api/ibp/migration-run — los pasos de una migración de dato maestro, uno por llamada.
//
//   { accion: 'preparar', … }  — contar el destino y medir una fila del origen. Solo lee.
//   { accion: 'cargar', … }    — leer UN segmento del origen y mandarlo a staging. **ESCRIBE.**
//   { accion: 'borrar', … }    — mandar a staging un trozo de claves a borrar. **ESCRIBE.**
//   { accion: 'confirmar', … } — confirmar una transacción. **ESCRIBE.**
//   { accion: 'estado', … }    — preguntar una vez si SAP ya la procesó. Solo lee.
//   { accion: 'mensajes', … }  — una página de las filas rechazadas. Solo lee.
//
// Es la carga de `runMigration` de v8 partida en pasos, porque v8 la corría entera en el navegador y
// aquí cada llamada a SAP la hace el servidor. La pantalla encadena: segmentos de veinte mil filas,
// seis a la vez, y repite un segmento ENTERO —en una transacción nueva— cuando falla de forma
// pasajera. Ninguna llamada de aquí reintenta un envío: ver `core/ibp/migration-run.js`.
//
// Cargar y confirmar van separados para que «⊘ Cancelar» cumpla lo que dice: el segmento en vuelo no
// se confirma. Y la confirmación explícita (`confirmacion`) no es decorativa: sin ella, una petición
// repetida por cualquier capa intermedia escribiría en un tenant que puede ser productivo.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { esNombreSeguro } from '../../core/ibp/nombre-seguro.js'
import {
  cargarBorrado,
  cargarSegmento,
  confirmarTransaccion,
  estadoDeTransaccion,
  filtroDeCondiciones,
  leerMensajes,
  prepararTabla,
} from '../../core/ibp/index.js'
import { FILAS_POR_SEGMENTO, PAGINAS_A_LA_VEZ } from '../../core/ibp/migration-plan.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Lo que hay que mandar para que una escritura se ejecute. */
const CONFIRMACION = 'copiar'

/** Las acciones que escriben en el tenant de destino. */
const ESCRIBEN = new Set(['cargar', 'borrar', 'confirmar'])

/** v8 limitaba el nombre de transacción a 40 caracteres. */
const MAX_NOMBRE = 40

/** El tamaño de página que aceptan las lecturas, como en v8: entre 250 y 5.000 filas. */
const paginaValida = (valor) => Math.max(250, Math.min(5000, Number(valor) || 2000))

async function tenantDe(clientId, connectionId, cual) {
  if (!connectionId) throw new Error(`Falta la conexión de ${cual}.`)

  const conexion = await getConnectionTarget(clientId, connectionId)
  if (conexion.kind !== 'ibp') throw new Error(`La conexión de ${cual} no es de IBP.`)

  return {
    baseUrl: conexion.baseUrl,
    credentials: await getAnyCredentials(clientId, connectionId, ACUERDOS),
  }
}

/** El contexto de área y versión de un lado. La versión base es la versión vacía. */
const ladoDe = (tenant, lado) => ({ ...tenant, planningArea: lado.planningArea || '', versionId: lado.versionId || '' })

/** Mismo tenant, área y versión: copiar ahí sobrescribiría el origen con el origen. */
const esElMismo = (origen, destino) => origen.connectionId === destino.connectionId
  && (origen.planningArea || '') === (destino.planningArea || '')
  && (origen.versionId || '') === (destino.versionId || '')

/**
 * Si un fallo de SAP merece que la pantalla repita el paso: los mismos criterios de v8 —sin estado,
 * 403 o 5xx—. Solo los fallos de SAP: un «falta la conexión» no se arregla repitiendo.
 */
function esTransitorio(error) {
  if (!error || !('retryable' in error)) return false
  return Boolean(error.retryable) || !error.status || error.status === 403 || error.status >= 500
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const {
    accion, origen = {}, destino = {}, entidad, entidadDestino, columnas = [], campos, claves = [],
    desde = 0, cuantas = FILAS_POR_SEGMENTO, porPagina, paralelo = PAGINAS_A_LA_VEZ, condiciones = [],
    filas = [], nombre, transactionId, skip = 0, conExpand = true, confirmacion,
  } = req.body ?? {}

  if (ESCRIBEN.has(accion) && confirmacion !== CONFIRMACION) {
    return res.status(400).json({ error: 'Falta la confirmación de que se quiere escribir en el tenant de destino.' })
  }
  if ((accion === 'cargar' || accion === 'borrar') && esElMismo(origen, destino)) {
    return res.status(400).json({ error: 'El origen y el destino son el mismo tenant, área y versión.' })
  }
  // Las tablas de origen y de destino se pegan en la ruta: un nombre con `/` o `..` llamaría a otro servicio.
  for (const tabla of [entidad, entidadDestino]) {
    if (tabla !== undefined && tabla !== null && tabla !== '' && !esNombreSeguro(tabla)) {
      return res.status(400).json({ error: 'El nombre de la tabla no es válido.' })
    }
  }
  if (!Array.isArray(columnas) || !Array.isArray(claves) || !Array.isArray(filas)) {
    return res.status(400).json({ error: 'Las columnas, las claves y las filas tienen que ser listas.' })
  }

  const nombreLimpio = String(nombre ?? '').trim().slice(0, MAX_NOMBRE) || undefined
  const quien = session.userId ?? session.clientId

  try {
    const necesitaOrigen = accion === 'preparar' || accion === 'cargar'
    const [deOrigen, deDestino] = await Promise.all([
      necesitaOrigen ? tenantDe(session.clientId, origen.connectionId, 'origen') : null,
      tenantDe(session.clientId, destino.connectionId, 'destino'),
    ])
    const ladoDestino = ladoDe(deDestino, destino)
    const ladoOrigen = deOrigen ? ladoDe(deOrigen, origen) : null

    switch (accion) {
      case 'preparar': {
        if (!entidad || !entidadDestino) return res.status(400).json({ error: 'Falta la tabla de origen o la de destino.' })
        return res.status(200).json(await prepararTabla({
          origen: ladoOrigen,
          destino: ladoDestino,
          entidad,
          entidadDestino,
          columnas,
          campos: Number(campos) || undefined,
          extraFilter: filtroDeCondiciones(condiciones),
        }))
      }

      case 'cargar': {
        if (!entidad || !entidadDestino) return res.status(400).json({ error: 'Falta la tabla de origen o la de destino.' })
        const segmento = await cargarSegmento({
          origen: ladoOrigen,
          destino: ladoDestino,
          entidad,
          entidadDestino,
          // Vacía = esquema sin verificar: se leen y se mandan todas las columnas del origen (v8).
          columnas,
          claves,
          desde: Math.max(0, Number(desde) || 0),
          // Una llamada no carga más de un segmento de v8, pase lo que pase.
          cuantas: Math.max(1, Math.min(Number(cuantas) || FILAS_POR_SEGMENTO, FILAS_POR_SEGMENTO)),
          porPagina: paginaValida(porPagina),
          // Sin claves no hay orden estable, y entonces se lee de una página en una.
          paralelo: claves.length ? Math.max(1, Math.min(Number(paralelo) || 1, PAGINAS_A_LA_VEZ)) : 1,
          extraFilter: filtroDeCondiciones(condiciones),
          nombre: nombreLimpio,
        })
        console.log(`[ibp/migration-run] ${quien} · cargar ${entidad} → ${entidadDestino}`
          + ` · ${segmento.filas} filas desde ${desde} · ${segmento.transactionId ?? 'sin transacción'}`)
        return res.status(200).json(segmento)
      }

      case 'borrar': {
        if (!entidadDestino) return res.status(400).json({ error: 'Falta la tabla de destino.' })
        if (filas.length > FILAS_POR_SEGMENTO) {
          return res.status(400).json({ error: `Como máximo ${FILAS_POR_SEGMENTO} claves por llamada.` })
        }
        const borrado = await cargarBorrado({ destino: ladoDestino, entidadDestino, claves: filas, nombre: nombreLimpio })
        console.log(`[ibp/migration-run] ${quien} · borrar ${entidadDestino} · ${borrado.filas} claves`
          + ` · ${borrado.transactionId ?? 'sin transacción'}`)
        return res.status(200).json(borrado)
      }

      case 'confirmar': {
        if (!transactionId) return res.status(400).json({ error: 'Falta la transacción.' })
        const hecho = await confirmarTransaccion({ destino: ladoDestino, transactionId })
        console.log(`[ibp/migration-run] ${quien} · confirmar ${transactionId}`)
        return res.status(200).json(hecho)
      }

      case 'estado': {
        if (!transactionId) return res.status(400).json({ error: 'Falta la transacción.' })
        return res.status(200).json({ estado: await estadoDeTransaccion({ destino: ladoDestino, transactionId }) })
      }

      case 'mensajes': {
        if (!transactionId || !entidadDestino) return res.status(400).json({ error: 'Falta la transacción o la tabla.' })
        return res.status(200).json(await leerMensajes({
          destino: ladoDestino,
          entidad: entidadDestino,
          transactionId,
          skip: Math.max(0, Number(skip) || 0),
          conExpand: conExpand !== false,
        }))
      }

      default:
        return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
    }
  } catch (error) {
    console.error(`[ibp/migration-run] ${accion} · ${error.stack || error.message}`)
    // 503 cuando repetir el paso tiene sentido; la pantalla repite el segmento entero.
    // El detalle de SAP va en el mismo texto: es lo que v8 enseñaba («[400] …») y lo único que dice
    // QUÉ campo o qué valor no le gustó.
    const transitorio = esTransitorio(error)
    const detalle = error.detail ?? ''
    return res.status(transitorio ? 503 : 400).json({
      error: `${explicarFallo(error, ACUERDOS)}${detalle ? ` — ${detalle}` : ''}`, detalle, transitorio,
    })
  }
}
