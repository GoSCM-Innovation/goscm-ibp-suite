// Lo que la pantalla de migración de dato maestro le pide a nuestro servidor.
//
// El navegador no habla con SAP ni ve credenciales: dice qué conexión es el origen y cuál el destino,
// y el servidor hace cada lectura y cada escritura. Lo que sí hace el navegador es ENCADENAR los
// pasos —como v8, que corría la carga entera aquí—, y por eso todo admite `signal`: «⊘ Cancelar» y
// salir de la pantalla cortan lo que esté en vuelo.

import { api } from './api.js'

/** Lo que el servidor exige recibir para escribir de verdad. */
export const CONFIRMACION_DE_CARGA = 'copiar'

/** El análisis de campos de UNA tabla: cuenta del origen y columnas de los dos lados. Solo lee. */
export function analyzeMigrationTable({ origen, destino, entidad, entidadDestino, condiciones }, { signal } = {}) {
  return api.post('/api/ibp/migration', { origen, destino, entidad, entidadDestino, condiciones }, { signal })
}

/**
 * Un paso de la carga: `preparar`, `cargar`, `borrar`, `confirmar`, `estado` o `mensajes`.
 *
 * `cargar`, `borrar` y `confirmar` **escriben en el tenant de destino**; la confirmación la pone esta
 * función porque la persona ya confirmó en el diálogo de «Confirmar migración».
 */
export function migrationStep(accion, peticion, { signal } = {}) {
  return api.post('/api/ibp/migration-run', { ...peticion, accion, confirmacion: CONFIRMACION_DE_CARGA }, { signal })
}
