import { describe, it, expect } from 'vitest'

import { NO_EXISTE } from './explorer-fields.js'
import {
  EXTRACCIONES,
  GRUPOS_DE_EXTRACCION,
  MARCA_DE_INVALIDA,
  clavesDe,
  clavesQueOtrosNecesitan,
  descartarInvalidas,
  gruposQueLoNecesitan,
  planificarExtraccion,
  soloDeClavesVivas,
  versionSinDatos,
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

describe('cuando la versión elegida no tiene nada', () => {
  const paso = (tabla, extra = {}) => ({
    tabla, etiqueta: tabla, esencial: true, sePuede: true, ...extra,
  })
  const hecho = (tabla, bajadas, extra = {}) => ({ tabla, bajadas, guardadas: bajadas, ...extra })

  it('todas las esenciales en cero es una versión vacía', () => {
    const salida = versionSinDatos(
      [paso('bom_psh'), paso('bom_psi')],
      [hecho('bom_psh', 0), hecho('bom_psi', 0)],
    )
    expect(salida.vacia).toBe(true)
    expect(salida.tablas).toEqual(['bom_psh', 'bom_psi'])
  })

  // Que una tabla accesoria venga vacía es normal: hay áreas sin producto por cliente.
  it('una accesoria en cero no dice nada de la versión', () => {
    const salida = versionSinDatos(
      [paso('bom_psh'), paso('sn_cust_prod', { esencial: false })],
      [hecho('bom_psh', 120), hecho('sn_cust_prod', 0)],
    )
    expect(salida.vacia).toBe(false)
  })

  it('con una sola esencial con filas, la versión no está vacía', () => {
    const salida = versionSinDatos(
      [paso('bom_psh'), paso('bom_psi')],
      [hecho('bom_psh', 0), hecho('bom_psi', 3)],
    )
    expect(salida.vacia).toBe(false)
  })

  // Decir «la versión está vacía» cuando en realidad se corto la descarga es peor que callarse: manda
  // al consultor a mirar SAP en vez de a reintentar.
  it('si una esencial fallo o se cancelo, no se concluye nada', () => {
    const conError = versionSinDatos(
      [paso('bom_psh'), paso('bom_psi')],
      [hecho('bom_psh', 0, { error: 'se cayo la red' }), hecho('bom_psi', 0)],
    )
    expect(conError.vacia).toBe(false)

    const cancelada = versionSinDatos(
      [paso('bom_psh'), paso('bom_psi')],
      [hecho('bom_psh', 0, { cancelado: true }), hecho('bom_psi', 0)],
    )
    expect(cancelada.vacia).toBe(false)
  })

  it('una esencial que ni aparece en lo bajado tampoco concluye', () => {
    expect(versionSinDatos([paso('bom_psh')], []).vacia).toBe(false)
  })

  it('una esencial que no se puede bajar no cuenta para el juicio', () => {
    const salida = versionSinDatos(
      [paso('bom_psh'), paso('bom_psi', { sePuede: false })],
      [hecho('bom_psh', 0)],
    )
    expect(salida.vacia).toBe(true)
  })

  it('aguanta que no venga nada', () => {
    expect(versionSinDatos([], []).vacia).toBe(false)
    expect(versionSinDatos(null, null).vacia).toBe(false)
  })
})

// La descarga de la red en v7 traía su propio maestro de productos y de ubicaciones. Aquí viven en el
// grupo del árbol, así que bajar solo «Red de suministro» dejaba la red sin descripciones y sin
// `LOCTYPE`, que es lo único que distingue un proveedor de una planta: media red sin dibujar, y sin
// que nada lo dijera.
describe('los maestros que los dos grupos necesitan', () => {
  const soloRed = () => planificarExtraccion({ efectivo: todoResuelto(), grupos: ['red'] })

  it('bajar solo la red trae el maestro de productos y el de ubicaciones', () => {
    const tablas = soloRed().pasos.map((uno) => uno.tabla)
    expect(tablas).toContain('bom_prd')
    expect(tablas).toContain('bom_loc')
  })

  it('bajar solo el árbol no arrastra las tablas de la red', () => {
    const tablas = planificarExtraccion({ efectivo: todoResuelto(), grupos: ['arbol'] })
      .pasos.map((uno) => uno.tabla)
    expect(tablas).toContain('bom_prd')
    expect(tablas).not.toContain('sn_loc')
  })

  it('con los dos grupos cada tabla aparece UNA vez', () => {
    const tablas = planificarExtraccion({ efectivo: todoResuelto() }).pasos.map((uno) => uno.tabla)
    expect(new Set(tablas).size).toBe(tablas.length)
  })

  it('un maestro compartido dice los dos grupos, y los demás solo el suyo', () => {
    const prd = EXTRACCIONES.find((una) => una.tabla === 'bom_prd')
    const psh = EXTRACCIONES.find((una) => una.tabla === 'bom_psh')
    expect(gruposQueLoNecesitan(prd)).toEqual(['arbol', 'red'])
    expect(gruposQueLoNecesitan(psh)).toEqual(['arbol'])
  })

  // Que la red no pueda enseñar descripciones no es motivo para prohibir bajar la red: el dueño del
  // paso sigue siendo su grupo, y de él depende que un grupo sea imposible.
  it('el maestro de productos sin resolver no vuelve imposible el grupo de la red', () => {
    const sinProducto = todoResuelto()
    delete sinProducto.arbol.product
    expect(planificarExtraccion({ efectivo: sinProducto, grupos: ['red'] }).gruposPosibles)
      .toEqual(['red'])
  })
})

// v7 ataba los componentes, la validez y los recursos al SOURCEID de una cabecera que sobrevivió a
// `PINVALID`. Su propia nota en el paso de la red lo decía: «Solo SOURCEIDs activos en PSH».
describe('las tablas atadas a su cabecera', () => {
  it('las cuatro que v7 filtraba están declaradas, y apuntan a su cabecera', () => {
    const atado = (tabla) => EXTRACCIONES.find((una) => una.tabla === tabla)?.atadoA
    expect(atado('bom_psi')).toEqual({ tabla: 'bom_psh', campo: 'SOURCEID' })
    expect(atado('bom_psi_validity')).toEqual({ tabla: 'bom_psh', campo: 'SOURCEID' })
    expect(atado('bom_psr')).toEqual({ tabla: 'bom_psh', campo: 'SOURCEID' })
    expect(atado('sn_psi')).toEqual({ tabla: 'sn_plant', campo: 'SOURCEID' })
  })

  // El orden de la lista no es decorativo: la cabecera tiene que bajarse antes que lo que cuelga.
  it('cada cabecera va antes que lo que depende de ella', () => {
    const posicion = (tabla) => EXTRACCIONES.findIndex((una) => una.tabla === tabla)
    for (const una of EXTRACCIONES.filter((otra) => otra.atadoA)) {
      expect(posicion(una.atadoA.tabla)).toBeLessThan(posicion(una.tabla))
    }
  })

  it('el plan deduce qué campo tiene que recordar cada cabecera', () => {
    const { pasos } = planificarExtraccion({ efectivo: todoResuelto() })
    const necesarias = clavesQueOtrosNecesitan(pasos)
    expect(necesarias.get('bom_psh')).toBe('SOURCEID')
    expect(necesarias.get('sn_plant')).toBe('SOURCEID')
    expect(necesarias.has('bom_prd')).toBe(false)
  })

  it('soloDeClavesVivas se queda con las que su cabecera avala', () => {
    const filas = [{ SOURCEID: 'S1' }, { SOURCEID: 'S2' }, { SOURCEID: 'S3' }]
    expect(soloDeClavesVivas(filas, 'SOURCEID', new Set(['S1', 'S3'])))
      .toEqual([{ SOURCEID: 'S1' }, { SOURCEID: 'S3' }])
  })

  it('compara sin que estorben los espacios ni el tipo', () => {
    expect(soloDeClavesVivas([{ SOURCEID: ' S1 ' }], 'SOURCEID', new Set(['S1'])).length).toBe(1)
    expect(soloDeClavesVivas([{ SOURCEID: 7 }], 'SOURCEID', new Set(['7'])).length).toBe(1)
  })

  // Sin claves NO es lo mismo que «con un conjunto vacío»: quien llama tiene que haber decidido ya
  // si el paso se salta. Un `undefined` que filtrara todo borraría la tabla en silencio.
  it('sin claves deja pasar todo, y con un conjunto vacío no deja nada', () => {
    const filas = [{ SOURCEID: 'S1' }]
    expect(soloDeClavesVivas(filas, 'SOURCEID', undefined)).toEqual(filas)
    expect(soloDeClavesVivas(filas, null, new Set())).toEqual(filas)
    expect(soloDeClavesVivas(filas, 'SOURCEID', new Set())).toEqual([])
  })

  it('clavesDe junta las que hay y descarta las vacías', () => {
    const salida = clavesDe([{ S: 'A' }, { S: '' }, { S: null }, { S: ' B ' }, { S: 'A' }], 'S')
    expect([...salida].sort()).toEqual(['A', 'B'])
  })
})

describe('planificarExtraccion · campos adicionales (paso ④ de v7)', () => {
  /** Un mapeo mínimo donde el maestro de productos resuelve a una tabla de este tenant. */
  const efectivo = {
    arbol: {
      header: { entidad: 'GIDPSH' },
      item: { entidad: 'GIDPSI' },
      product: { entidad: 'GIDPRODUCT' },
      locMaster: { entidad: 'GIDLOCATION' },
    },
  }

  const pasoDe = (plan, tabla) => plan.pasos.find((uno) => uno.tabla === tabla)

  it('añade al $select los campos pedidos para esa tabla', () => {
    const plan = planificarExtraccion({
      efectivo, grupos: ['arbol'], extras: { bom_prd: ['ZGRUPOCOMPRAS'] },
    })
    expect(pasoDe(plan, 'bom_prd').select).toContain('ZGRUPOCOMPRAS')
    expect(pasoDe(plan, 'bom_prd').extras).toEqual(['ZGRUPOCOMPRAS'])
  })

  it('no toca las tablas para las que no se pidió nada', () => {
    const plan = planificarExtraccion({
      efectivo, grupos: ['arbol'], extras: { bom_prd: ['ZGRUPOCOMPRAS'] },
    })
    expect(pasoDe(plan, 'bom_psh').extras).toEqual([])
  })

  it('no repite un campo que ya estaba en el $select', () => {
    // SAP rechaza la consulta entera si un campo aparece dos veces, y el error no dice cuál.
    const plan = planificarExtraccion({
      efectivo, grupos: ['arbol'], extras: { bom_prd: ['PRDID', 'PRDID', 'ZOTRO'] },
    })
    const select = pasoDe(plan, 'bom_prd').select
    expect(select.filter((uno) => uno === 'PRDID')).toHaveLength(1)
    expect(pasoDe(plan, 'bom_prd').extras).toEqual(['ZOTRO'])
  })

  it('sin extras se comporta igual que antes', () => {
    const con = planificarExtraccion({ efectivo, grupos: ['arbol'], extras: {} })
    const sin = planificarExtraccion({ efectivo, grupos: ['arbol'] })
    expect(con.pasos.map((uno) => uno.select)).toEqual(sin.pasos.map((uno) => uno.select))
  })

  it('un paso que no se puede bajar sale con la lista de extras vacía, no indefinida', () => {
    const plan = planificarExtraccion({ efectivo: {}, grupos: ['arbol'], extras: { bom_prd: ['Z'] } })
    expect(pasoDe(plan, 'bom_prd').extras).toEqual([])
  })
})
