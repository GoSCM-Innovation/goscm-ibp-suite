import { describe, it, expect } from 'vitest'

import { NO_EXISTE } from './explorer-fields.js'
import {
  EXTRACCIONES,
  GRUPOS_DE_EXTRACCION,
  MARCA_DE_INVALIDA,
  descartarInvalidas,
  planificarExtraccion,
} from './explorer-extract-plan.js'

/** Un papel resuelto, como lo devuelve `rolesEfectivos`. */
const rol = (entidad) => ({ etiqueta: 'X', entidad, seguro: true, alternativas: [], corregido: false })

/** Los dos grupos con todos sus papeles resueltos, con el prefijo que se le pase. */
const todoResuelto = (prefijo = 'GID') => Object.fromEntries(
  GRUPOS_DE_EXTRACCION.map(({ id }) => [
    id,
    Object.fromEntries(EXTRACCIONES.filter((una) => una.grupo === id)
      .map((una) => [una.papel, rol(`${prefijo}${una.papel.toUpperCase()}`)])),
  ]),
)

describe('descartarInvalidas', () => {
  const filas = [{ LOCID: '1', TINVALID: '' }, { LOCID: '2', TINVALID: MARCA_DE_INVALIDA }, { LOCID: '3' }]

  it('deja fuera las filas marcadas', () => {
    expect(descartarInvalidas(filas, 'TINVALID').map((una) => una.LOCID)).toEqual(['1', '3'])
  })

  // Lo normal es que una fila válida tenga la marca VACÍA, no en ''. Filtrar en SAP se llevaría casi
  // todo, porque allí un predicado sobre un campo descarta también las filas donde está vacío.
  it('una fila sin la marca se conserva', () => {
    expect(descartarInvalidas([{ LOCID: '3' }], 'TINVALID')).toHaveLength(1)
  })

  it('sin campo de invalidez no descarta nada', () => {
    expect(descartarInvalidas(filas, null)).toHaveLength(3)
  })

  it('sin filas no revienta', () => {
    expect(descartarInvalidas(undefined, 'TINVALID')).toEqual([])
  })
})

describe('planificarExtraccion', () => {
  it('resuelve la tabla y los campos de cada paso', () => {
    const { pasos } = planificarExtraccion({ efectivo: todoResuelto() })
    const cabecera = pasos.find((uno) => uno.tabla === 'bom_psh')

    expect(cabecera).toMatchObject({ entidad: 'GIDHEADER', sePuede: true })
    expect(cabecera.select).toContain('PRDID')
    expect(cabecera.select).toContain('OUTPUTCOEFFICIENT')
  })

  it('con todo resuelto, los dos grupos se pueden correr', () => {
    expect(planificarExtraccion({ efectivo: todoResuelto() }).gruposPosibles).toEqual(['arbol', 'red'])
  })

  it('se puede pedir un grupo solo', () => {
    const { pasos } = planificarExtraccion({ efectivo: todoResuelto(), grupos: ['arbol'] })
    expect(pasos.every((uno) => uno.grupo === 'arbol')).toBe(true)
  })

  // Enterarse a los seis minutos de que falta la tabla principal, después de bajar tres que no
  // sirven sin ella, es la diferencia entre una herramienta y un castigo.
  it('un papel sin resolver se dice antes de empezar', () => {
    const efectivo = todoResuelto()
    efectivo.arbol.header = rol(null)

    const { pasos, avisos } = planificarExtraccion({ efectivo })
    expect(pasos.find((uno) => uno.tabla === 'bom_psh')).toMatchObject({ sePuede: false })
    expect(avisos.join(' ')).toMatch(/Cabecera de receta/)
  })

  // Sin la cabecera no hay árbol; sin la validez de los componentes el árbol se dibuja igual.
  it('lo esencial que falta apaga su grupo; lo accesorio no', () => {
    const sinEsencial = todoResuelto()
    sinEsencial.arbol.header = rol(null)
    expect(planificarExtraccion({ efectivo: sinEsencial }).gruposPosibles).toEqual(['red'])

    const sinAccesorio = todoResuelto()
    sinAccesorio.arbol.itemValidity = rol(null)
    expect(planificarExtraccion({ efectivo: sinAccesorio }).gruposPosibles).toEqual(['arbol', 'red'])
  })

  it('el aviso distingue lo que impide de lo que solo empobrece', () => {
    const efectivo = todoResuelto()
    efectivo.arbol.header = rol(null)
    efectivo.arbol.itemValidity = rol(null)

    const { avisos } = planificarExtraccion({ efectivo })
    expect(avisos.find((uno) => uno.startsWith('Cabecera'))).toMatch(/no funciona/)
    expect(avisos.find((uno) => uno.startsWith('Validez'))).toMatch(/Se puede seguir/)
  })

  it('aplica el mapa de campos a los nombres de este tenant', () => {
    const mapa = { GIDCUSTOMER: { CLEADTIME: 'LEADTIME' } }
    const { pasos } = planificarExtraccion({ efectivo: todoResuelto(), mapa })

    const arcos = pasos.find((uno) => uno.tabla === 'sn_cust')
    expect(arcos.select).toContain('LEADTIME')
    expect(arcos.select).not.toContain('CLEADTIME')
  })

  it('un campo que el tenant no tiene se omite y se avisa', () => {
    const mapa = { GIDITEM: { ISALTITEM: NO_EXISTE } }
    const { pasos, avisos } = planificarExtraccion({ efectivo: todoResuelto(), mapa })

    const componentes = pasos.find((uno) => uno.tabla === 'bom_psi')
    expect(componentes.select).not.toContain('ISALTITEM')
    expect(componentes.omitidos).toEqual(['ISALTITEM'])
    expect(avisos.join(' ')).toMatch(/no tiene ISALTITEM/)
  })

  // Si el campo de invalidez no existe, no hay nada que descartar y quedarse con todo es lo correcto.
  it('sin el campo de invalidez no se descarta nada', () => {
    const mapa = { GIDLOCATION: { TINVALID: NO_EXISTE } }
    const { pasos } = planificarExtraccion({ efectivo: todoResuelto(), mapa })
    expect(pasos.find((uno) => uno.tabla === 'sn_loc').descartarSi).toBeNull()
  })

  it('la marca de invalidez se traduce si el tenant la llama distinto', () => {
    const mapa = { GIDLOCATION: { TINVALID: 'INVALIDO' } }
    const { pasos } = planificarExtraccion({ efectivo: todoResuelto(), mapa })
    expect(pasos.find((uno) => uno.tabla === 'sn_loc').descartarSi).toBe('INVALIDO')
  })

  it('sin nada resuelto no se puede correr ningún grupo', () => {
    const { gruposPosibles, avisos } = planificarExtraccion({ efectivo: {} })
    expect(gruposPosibles).toEqual([])
    expect(avisos.length).toBeGreaterThan(0)
  })

  it('sin argumentos no revienta', () => {
    expect(planificarExtraccion().pasos.every((uno) => !uno.sePuede)).toBe(true)
  })

  // Cada paso escribe en su tabla local y no en la de otro.
  it('no hay dos pasos que escriban en la misma tabla', () => {
    const tablas = EXTRACCIONES.map((una) => una.tabla)
    expect(new Set(tablas).size).toBe(tablas.length)
  })
})
