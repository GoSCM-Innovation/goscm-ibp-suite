// Deja fijado contra qué tenant, área y versión se trabaja.
//
// Es el último paso del asistente de conexión (`ConnectDialog.jsx`) y también lo que hace pulsar la
// pestaña de un tenant al que ya se le había elegido área y versión: los dos tienen que hacer
// exactamente lo mismo, o volver a una pestaña dejaría ver lo guardado de otro tenant.
//
// Como `resetAllModules()` de v7: lo guardado de OTRO origen se borra antes de conectar, para que la
// aplicación arranque desde el primer paso y no con el árbol de una sesión ajena. Si no se puede
// limpiar, lanza y NO conecta.

import { conectar } from './conexion-activa.js'
import { reiniciarSiOtroOrigen } from './explorer-db.js'
import { versionParaSap } from './version-elegida.js'

export async function fijarDestino({ connectionId, nombre, baseUrl, planningArea, version, esProduccion }) {
  await reiniciarSiOtroOrigen({
    connectionId,
    planningArea,
    versionId: versionParaSap(version),
  })
  conectar({ connectionId, nombre, baseUrl, planningArea, version, esProduccion })
}
