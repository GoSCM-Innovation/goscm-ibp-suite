import { describe, expect, it, vi } from 'vitest'

import {
  CLAVE_DE_RECARGA,
  VENTANA_DE_RECARGA_MS,
  alFallarLaCarga,
  debeRecargar,
} from './recarga-por-version.js'

/** Un `sessionStorage` de mentira. */
const almacenDe = (inicial = {}) => {
  const datos = { ...inicial }
  return {
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = String(v) },
    datos,
  }
}

const evento = () => ({ preventDefault: vi.fn() })

describe('debeRecargar', () => {
  it('sin recarga previa, recarga', () => {
    expect(debeRecargar(1000, null)).toBe(true)
    expect(debeRecargar(1000, 0)).toBe(true)
    expect(debeRecargar(1000, 'basura')).toBe(true)
  })

  it('si acaba de recargar, no vuelve a hacerlo: es otro problema', () => {
    expect(debeRecargar(100000, 100000 - (VENTANA_DE_RECARGA_MS - 1))).toBe(false)
  })

  // El fallo de antes: la marca no caducaba, así que el segundo despliegue de la sesión no recargaba.
  it('pasada la ventana, un despliegue nuevo vuelve a recargar', () => {
    expect(debeRecargar(100000, 100000 - VENTANA_DE_RECARGA_MS)).toBe(true)
  })

  it('una marca del formato anterior (un «1») cuenta como vieja', () => {
    expect(debeRecargar(Date.now(), '1')).toBe(true)
  })
})

describe('alFallarLaCarga', () => {
  it('recarga, lo anota y tapa el error para que no se muestre antes de recargar', () => {
    const ev = evento()
    const recargar = vi.fn()
    const almacen = almacenDe()
    expect(alFallarLaCarga(ev, { almacen, recargar, ahora: 50000 })).toBe(true)
    expect(recargar).toHaveBeenCalledTimes(1)
    expect(ev.preventDefault).toHaveBeenCalled()
    expect(almacen.datos[CLAVE_DE_RECARGA]).toBe('50000')
  })

  // Tapar el error sin recargar dejaba el módulo en `undefined` y la pantalla fallaba con «reading 'default'».
  it('si no recarga, NO tapa el error: se verá el motivo real', () => {
    const ev = evento()
    const recargar = vi.fn()
    const almacen = almacenDe({ [CLAVE_DE_RECARGA]: '49000' })
    expect(alFallarLaCarga(ev, { almacen, recargar, ahora: 50000 })).toBe(false)
    expect(recargar).not.toHaveBeenCalled()
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('sin almacenamiento recarga igual', () => {
    const ev = evento()
    const recargar = vi.fn()
    expect(alFallarLaCarga(ev, { almacen: null, recargar, ahora: 50000 })).toBe(true)
    expect(recargar).toHaveBeenCalledTimes(1)
  })
})
