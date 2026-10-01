// Lo que la pantalla «Dato transaccional» de «Migración» le pide al servidor.
//
// En v8 la pantalla hablaba con SAP a través de un proxy. Aquí cada pieza es una llamada a nuestra API:
// la pantalla orquesta —cuenta, reparte los segmentos, reintenta, confirma— y el servidor lee y
// escribe. El navegador no ve credenciales ni direcciones de SAP.
//
// Todas aceptan `signal`: «Cancelar migración» corta lo que esté en vuelo, como en v8.

import { api } from './api.js'

const RUTA = '/api/ibp/kf-migration'

/** Lo que el servidor exige recibir para escribir de verdad. */
export const CONFIRMACION_DE_COPIA = 'copiar'

/** Cuántas filas hay al nivel elegido para UNA key figure. Solo lee. */
export async function contarCifra(peticion, { signal } = {}) {
  const { total } = await api.post(RUTA, { ...peticion, accion: 'contar' }, { signal })
  return total
}

/** Los periodos con dato, para partir la lectura de un volumen grande. Solo lee. */
export async function periodosDeCifra(peticion, { signal } = {}) {
  const { periodos } = await api.post(RUTA, { ...peticion, accion: 'periodos' }, { signal })
  return periodos ?? []
}

/** Copia UN segmento de una key figure. **Esto escribe en el tenant de destino.** */
export function copiarSegmentoDeCifra(peticion, { signal } = {}) {
  return api.post(RUTA, { ...peticion, accion: 'copiar', confirmacion: CONFIRMACION_DE_COPIA }, { signal })
}

/** Espera a que SAP procese una transacción y trae sus rechazos si no quedó limpia. Solo lee. */
export function confirmarTransaccionDeCifra(peticion, { signal } = {}) {
  return api.post(RUTA, { ...peticion, accion: 'confirmar' }, { signal })
}
