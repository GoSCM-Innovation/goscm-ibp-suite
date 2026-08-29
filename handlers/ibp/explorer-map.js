// Las correcciones del explorador para un destino: qué entidad cumple cada papel y cómo se llama
// cada campo en ESTE tenant.
//
// GET    ?connectionId=…&planningArea=…[&versionId=…]  — lo guardado, más la detección automática.
// PUT    { connectionId, planningArea, versionId, roles, fields }  — guardar las correcciones.
// DELETE { connectionId, planningArea, versionId }     — volver a la detección automática.
//
// El GET devuelve TRES cosas: qué detectó la máquina, qué corrigió una persona, y la respuesta ya
// combinada (`efectivo`). Las dos primeras son para que la pantalla pueda mostrar la diferencia; la
// tercera es la que consume todo lo demás.
//
// Se combina aquí y no en cada consumidor a propósito: si la extracción lo hiciera por su cuenta y
// los analizadores por la suya, bastaría que uno se olvidara de mirar las correcciones para que dos
// pantallas del mismo tenant leyeran tablas distintas y nadie entendiera por qué no cuadran.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import {
  ROLES_DEL_ARBOL,
  ROLES_DE_RED,
  catalogoDesdeVsmt,
  detectarRoles,
  gruposEfectivos,
  prefijoDelTenant,
  readCatalog,
  readVsmt,
} from '../../core/ibp/index.js'
import { deleteExplorerMap, getExplorerMap, saveExplorerMap } from '../../core/ibp/explorer-map.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** Los dos grupos de papeles que el explorador necesita resolver. */
const GRUPOS = Object.freeze({ arbol: ROLES_DEL_ARBOL, red: ROLES_DE_RED })

/** El destino, de la consulta o del cuerpo. */
const destinoDe = (req) => {
  const de = req.method === 'GET' ? (req.query ?? {}) : (req.body ?? {})
  return {
    connectionId: de.connectionId,
    planningArea: de.planningArea,
    versionId: de.versionId ?? '',
  }
}

/**
 * Detecta qué entidad cumple cada papel, con los nombres de ESTE tenant.
 *
 * Se piden los campos por entidad —`conCampos`— porque sin ellos la detección cae al nombre y elige
 * mal: comprobado contra un tenant real, el maestro de productos resolvía a la tabla
 * producto-por-cliente, que se llama parecido.
 */
async function detectar({ baseUrl, credentials }, { planningArea, versionId }) {
  const [catalogo, vsmt] = await Promise.all([
    readCatalog({ baseUrl, credentials, services: ['MASTER_DATA_API_SRV'], conCampos: true }),
    readVsmt({ baseUrl, credentials }),
  ])

  const areas = catalogoDesdeVsmt(vsmt)
  const version = areas[planningArea]?.versions.find((una) => una.id === (versionId ?? ''))
    ?? areas[planningArea]?.versions[0]

  const tipos = version?.mdts ?? []
  const entidades = catalogo.entitySets.map((una) => ({
    name: una.name,
    fields: [...(catalogo.entityProps[una.nameUC] ?? [])],
  }))

  // Se detecta sobre las entidades DEL ÁREA. Con las seiscientas del tenant, una tabla de otra área
  // podría ganar el papel.
  const delArea = entidades.filter((una) => tipos.includes(una.name))
  const candidatas = delArea.length > 0 ? delArea : entidades
  const prefijo = prefijoDelTenant(tipos)

  return {
    prefijo,
    version: version?.id ?? null,
    entidades: candidatas.map((una) => una.name).sort(),
    // Los campos de cada tabla del área. Van aquí porque ya se leyeron para detectar los papeles —no
    // cuesta ninguna petición más a SAP— y porque sin ellos el paso ④ de los analizadores, «campos
    // adicionales de datos maestros», no tiene qué ofrecer: v7 los sacaba del `$metadata` que ya
    // tenía en memoria (`ENTITIES`), y ese `$metadata` es exactamente esto.
    campos: Object.fromEntries(candidatas.map((una) => [una.name, una.fields])),
    detectado: Object.fromEntries(
      Object.entries(GRUPOS).map(([grupo, roles]) => [grupo, detectarRoles(candidatas, roles, prefijo)]),
    ),
  }
}

export default async function handler(req, res) {
  const session = await requireModule(req, res, 'explorer')
  if (!session) return

  const destino = destinoDe(req)

  try {
    if (req.method === 'GET') {
      const conexion = await getConnectionTarget(session.clientId, destino.connectionId)
      if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

      const credentials = await getAnyCredentials(session.clientId, destino.connectionId, ACUERDOS)
      const [guardado, deteccion] = await Promise.all([
        getExplorerMap(session.clientId, destino),
        detectar({ baseUrl: conexion.baseUrl, credentials }, destino),
      ])

      return res.status(200).json({
        guardado,
        ...deteccion,
        efectivo: gruposEfectivos(deteccion.detectado, guardado.roles),
      })
    }

    if (req.method === 'PUT') {
      const { roles = {}, fields = {} } = req.body ?? {}
      return res.status(200).json({
        guardado: await saveExplorerMap(session.clientId, destino, { roles, fields, userId: session.userId ?? null }),
      })
    }

    if (req.method === 'DELETE') {
      const borrado = await deleteExplorerMap(session.clientId, destino)
      return res.status(200).json({ borrado })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    console.error(`[ibp/explorer-map] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS), detalle: error.detail ?? '' })
  }
}
