// El catálogo del SAP IBP de destino de una conexión de Cloud Integration, para sugerir al armar un body.
//
// Dos piezas:
//   - `useCatalogoIbp(conexión)` lee el resumen (áreas, versiones y tablas) al abrir y ofrece `leer` para lo demás
//     (campos de una tabla, cifras de un área, valores de un campo) y `actualizar` para volver a pedirlo todo.
//   - `useLecturaIbp(catalogo, acción, parámetros)` lee una de esas cosas cuando hace falta y dice si está lista.
//
// Lo leído vive SOLO en memoria, mientras la pantalla está abierta: es información del tenant de un cliente y no se
// guarda en el navegador (ver «Nada guardado en el navegador se comparte entre tenants» en `CLAUDE.md`). El
// servidor ya guarda 30 minutos lo que es caro de leer; aquí solo se evita pedir lo mismo dos veces seguidas.
//
// Si IBP no contesta, o la conexión no tiene IBP de destino, `fase` lo dice y nada más cambia: el formulario se
// llena a mano como siempre.

import { useCallback, useEffect, useRef, useState } from 'react'
import { esFaltaDeVinculo, pedirCatalogoIbp } from '../../lib/ci-ibp.js'

const SIN_CATALOGO = { ibp: null, areas: [], avisos: [], error: '' }

/**
 * @returns {{
 *   fase: 'sin-vinculo' | 'cargando' | 'listo' | 'error',
 *   ibp: { id: string, nombre: string } | null,
 *   areas: Array, avisos: string[], error: string,
 *   actualizar: () => void,
 *   leer: (accion: string, parametros?: object) => Promise<any>,
 * }}
 */
export function useCatalogoIbp(conexion) {
  const connectionId = conexion?.id
  const vinculado = Boolean(conexion?.ibpConnectionId)

  const [estado, setEstado] = useState(() => ({ fase: vinculado ? 'cargando' : 'sin-vinculo', ...SIN_CATALOGO }))
  const [intento, setIntento] = useState(0)

  // Lo ya pedido, por clave. Una lectura que falló se saca: la próxima vez se vuelve a intentar.
  const memoria = useRef(new Map())
  // Sube con cada «Actualizar»: desde entonces, lo que se pida por primera vez también se salta el caché del servidor.
  const generacion = useRef(0)

  useEffect(() => {
    if (!vinculado) return undefined
    let vivo = true
    pedirCatalogoIbp(connectionId, 'resumen', {}, { actualizar: generacion.current > 0 })
      .then((respuesta) => {
        if (vivo) setEstado({ fase: 'listo', ibp: respuesta.ibp, areas: respuesta.areas ?? [], avisos: respuesta.avisos ?? [], error: '' })
      })
      .catch((fallo) => {
        if (vivo) setEstado({ fase: esFaltaDeVinculo(fallo) ? 'sin-vinculo' : 'error', ...SIN_CATALOGO, error: fallo.message })
      })
    return () => { vivo = false }
  }, [connectionId, vinculado, intento])

  const actualizar = useCallback(() => {
    memoria.current.clear()
    generacion.current += 1
    setEstado((previo) => ({ ...previo, fase: 'cargando' }))
    setIntento((n) => n + 1)
  }, [])

  const leer = useCallback((accion, parametros = {}) => {
    // Los valores de un campo son datos del cliente: se piden al momento y no se recuerdan ni en memoria.
    const recordar = accion !== 'valores'
    const clave = JSON.stringify([accion, parametros])
    const previa = recordar ? memoria.current.get(clave) : null
    if (previa && previa.generacion === generacion.current) return previa.promesa

    const promesa = pedirCatalogoIbp(connectionId, accion, parametros, { actualizar: generacion.current > 0 && recordar })
    if (recordar) {
      memoria.current.set(clave, { generacion: generacion.current, promesa })
      promesa.catch(() => { if (memoria.current.get(clave)?.promesa === promesa) memoria.current.delete(clave) })
    }
    return promesa
  }, [connectionId])

  return { ...estado, actualizar, leer }
}

/**
 * Lee del catálogo cuando hace falta y dice cómo va: `{ datos, error, cargando }`.
 *
 * `parametros` en `null` (o el catálogo sin estar listo) no lee nada. Lo leído solo vale para los parámetros con que
 * se pidió: si cambian, `datos` vuelve a `null` hasta que llegue lo nuevo, y no se enseña lo de la tabla anterior.
 */
export function useLecturaIbp(catalogo, accion, parametros) {
  const listo = catalogo?.fase === 'listo'
  const leer = catalogo?.leer
  const clave = parametros ? JSON.stringify(parametros) : ''
  const [lectura, setLectura] = useState({ clave: '', datos: null, error: '' })

  useEffect(() => {
    if (!listo || !clave) return undefined
    let vivo = true
    leer(accion, JSON.parse(clave))
      .then((datos) => { if (vivo) setLectura({ clave, datos, error: '' }) })
      .catch((fallo) => { if (vivo) setLectura({ clave, datos: null, error: fallo.message }) })
    return () => { vivo = false }
  }, [listo, leer, accion, clave])

  const vigente = lectura.clave === clave
  return {
    datos: vigente ? lectura.datos : null,
    error: vigente ? lectura.error : '',
    cargando: listo && clave !== '' && !vigente,
  }
}
