import { describe, it, expect } from 'vitest'

import {
  ROLES_DEL_ARBOL,
  ROLES_DE_RED,
  detectarRoles,
  entidadesDelTenant,
  esTablaDeTraduccion,
  gruposEfectivos,
  mejorEntidadPara,
  prefijoDelTenant,
  rolesEfectivos,
  rolesPorRevisar,
} from './explorer-entities.js'

/** Una entidad tal como llega del catálogo del tenant. */
const ent = (name, fields) => ({ name, fields })

describe('esTablaDeTraduccion', () => {
  // Se parecen a la buena y no lo son.
  it('reconoce las de traducción de SAP', () => {
    expect(esTablaDeTraduccion('AS1PRODUCTTrans')).toBe(true)
    expect(esTablaDeTraduccion('AS1PRODUCTTexts')).toBe(true)
    expect(esTablaDeTraduccion('AS1PRODUCTLang')).toBe(true)
  })

  it('la tabla de verdad no lo es', () => {
    expect(esTablaDeTraduccion('AS1PRODUCT')).toBe(false)
    expect(esTablaDeTraduccion(undefined)).toBe(false)
  })
})

describe('prefijoDelTenant', () => {
  it('toma el prefijo común cuando lo hay', () => {
    expect(prefijoDelTenant(['GIDPRODUCT', 'GIDLOCATION', 'GIDCUSTOMER'])).toBe('GID')
  })

  // Pasa en la versión base, donde se mezclan tablas de varias versiones.
  it('sin prefijo común, gana el más votado por longitud', () => {
    expect(prefijoDelTenant(['AS1PRODUCT', 'AS1SOURCEPRODUCTION', 'PI3PRODUCTIONSOURCEITM'])).toBe('AS1')
  })

  // Un prefijo que sale de un solo nombre no es un prefijo.
  it('los que aparecen una sola vez no cuentan', () => {
    expect(prefijoDelTenant(['AAPRODUCT', 'BBLOCATION'])).toBe('')
  })

  it('sin nombres no hay prefijo', () => {
    expect(prefijoDelTenant([])).toBe('')
    expect(prefijoDelTenant(undefined)).toBe('')
  })

  it('un solo nombre es su propio prefijo', () => {
    expect(prefijoDelTenant(['GIDPRODUCT'])).toBe('GIDPRODUCT')
  })
})

describe('entidadesDelTenant', () => {
  const todas = [ent('GIDPRODUCT', ['PRDID']), ent('AS1PRODUCT', ['PRDID'])]

  it('acota por prefijo', () => {
    expect(entidadesDelTenant(todas, 'GID').map((una) => una.name)).toEqual(['GIDPRODUCT'])
  })

  // Mejor detectar sobre todo que quedarse sin nada porque el prefijo se dedujo mal.
  it('un prefijo que no deja nada se ignora', () => {
    expect(entidadesDelTenant(todas, 'ZZZ')).toHaveLength(2)
  })

  it('sin prefijo devuelve todas', () => {
    expect(entidadesDelTenant(todas, '')).toHaveLength(2)
  })
})

describe('mejorEntidadPara', () => {
  it('elige la que tiene los campos obligatorios', () => {
    const entidades = [ent('OTRA', ['PRDID']), ent('GIDPRODUCTIONSOURCEITM', ['PRDID', 'SOURCEID', 'COMPONENTCOEFFICIENT'])]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.item)).toBe('GIDPRODUCTIONSOURCEITM')
  })

  it('los campos que ayudan desempatan', () => {
    const entidades = [ent('GIDA', ['PRDID']), ent('GIDB', ['PRDID', 'PRDDESCR', 'MATTYPEID'])]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.product)).toBe('GIDB')
  })

  // Sin esto, una tabla de mensajes o de registro gana por llamarse parecido y el análisis entero
  // sale de la tabla equivocada.
  it('encajar por campos SIEMPRE le gana a encajar solo por nombre', () => {
    const entidades = [
      ent('GIDSOURCEPRODUCTIONMessage', []),
      ent('GIDRARO', ['LOCID', 'PRDID', 'SOURCEID']),
    ]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.header)).toBe('GIDRARO')
  })

  it('sin nadie que encaje por campos, decide el nombre', () => {
    const entidades = [ent('GIDSOURCEPRODUCTION', ['ALGO'])]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.header)).toBe('GIDSOURCEPRODUCTION')
  })

  it('sin candidatas devuelve null', () => {
    expect(mejorEntidadPara([], ROLES_DEL_ARBOL.header)).toBeNull()
    expect(mejorEntidadPara(undefined, ROLES_DEL_ARBOL.header)).toBeNull()
  })

  it('la tabla de traducción pierde contra la de verdad', () => {
    const entidades = [
      ent('GIDPRODUCTTrans', ['PRDID', 'PRDDESCR', 'MATTYPEID']),
      ent('GIDPRODUCT', ['PRDID', 'PRDDESCR', 'MATTYPEID']),
    ]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.product)).toBe('GIDPRODUCT')
  })

  // ESTE es el fallo de v7: la exclusión se pasaba a una función que no la recibía, en el grupo del
  // árbol. El maestro de ubicaciones exige solo LOCID, así que la tabla de origen-ubicación —que
  // tiene LOCID y además LOCFR y PRDID— también encajaba.
  it('descarta la entidad más específica que también cumple el filtro', () => {
    const entidades = [
      ent('GIDSOURCELOCATION', ['LOCID', 'LOCFR', 'PRDID', 'SOURCEID', 'LOCDESCR', 'LOCTYPE', 'EXTRA']),
      ent('GIDLOCATION', ['LOCID', 'LOCDESCR', 'LOCTYPE']),
    ]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.locMaster)).toBe('GIDLOCATION')
  })

  it('el maestro de recursos descarta el recurso de receta', () => {
    const entidades = [
      ent('GIDPRODUCTIONRESOURCE', ['RESID', 'SOURCEID', 'RESDESCR', 'MAS', 'CAMPOS']),
      ent('GIDRESOURCE', ['RESID', 'RESDESCR']),
    ]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.resMaster)).toBe('GIDRESOURCE')
  })

  it('el maestro de clientes descarta los arcos hacia clientes', () => {
    const entidades = [
      ent('GIDSOURCECUSTOMER', ['CUSTID', 'LOCID', 'PRDID', 'CUSTDESCR', 'X', 'Y']),
      ent('GIDCUSTOMER', ['CUSTID', 'CUSTDESCR']),
    ]
    expect(mejorEntidadPara(entidades, ROLES_DE_RED.custMaster)).toBe('GIDCUSTOMER')
  })

  // A igualdad de campos decidía el orden en que SAP devolvió los metadatos.
  it('a igualdad de campos, gana la que se llama como el papel', () => {
    const entidades = [
      ent('GIDTRANSPORTATIONRESOURCE', ['RESID', 'LOCID']),
      ent('GIDRESOURCELOCATION', ['RESID', 'LOCID']),
    ]
    expect(mejorEntidadPara(entidades, ROLES_DEL_ARBOL.resLoc)).toBe('GIDRESOURCELOCATION')
  })
})

describe('detectarRoles', () => {
  // Los dos tenants de prueba nombran sus tablas distinto: es el caso que esto existe para resolver.
  const conPrefijo = (prefijo) => [
    ent(`${prefijo}PRODUCT`, ['PRDID', 'PRDDESCR', 'MATTYPEID']),
    ent(`${prefijo}LOCATION`, ['LOCID', 'LOCDESCR', 'LOCTYPE']),
    ent(`${prefijo}CUSTOMER`, ['CUSTID', 'CUSTDESCR']),
    ent(`${prefijo}SOURCEPRODUCTION`, ['LOCID', 'PRDID', 'SOURCEID', 'SOURCETYPE', 'OUTPUTCOEFFICIENT']),
    ent(`${prefijo}PRODUCTIONSOURCEITM`, ['PRDID', 'SOURCEID', 'COMPONENTCOEFFICIENT']),
    ent(`${prefijo}PRODUCTIONRESOURCE`, ['RESID', 'SOURCEID']),
    ent(`${prefijo}RESOURCE`, ['RESID', 'RESDESCR']),
  ]

  it('resuelve los papeles con el nombre que use cada tenant', () => {
    for (const prefijo of ['GID', 'AS1']) {
      const detectado = detectarRoles(conPrefijo(prefijo), ROLES_DEL_ARBOL, prefijo)
      expect(detectado.product.entidad).toBe(`${prefijo}PRODUCT`)
      expect(detectado.header.entidad).toBe(`${prefijo}SOURCEPRODUCTION`)
      expect(detectado.item.entidad).toBe(`${prefijo}PRODUCTIONSOURCEITM`)
      expect(detectado.resMaster.entidad).toBe(`${prefijo}RESOURCE`)
    }
  })

  it('con dos tenants mezclados, el prefijo acota al pedido', () => {
    const mezcladas = [...conPrefijo('GID'), ...conPrefijo('AS1')]
    expect(detectarRoles(mezcladas, ROLES_DEL_ARBOL, 'AS1').product.entidad).toBe('AS1PRODUCT')
    expect(detectarRoles(mezcladas, ROLES_DEL_ARBOL, 'GID').product.entidad).toBe('GIDPRODUCT')
  })

  it('marca como seguro lo decidido por campos', () => {
    const detectado = detectarRoles(conPrefijo('GID'), ROLES_DEL_ARBOL, 'GID')
    expect(detectado.product.seguro).toBe(true)
  })

  // Decidido solo por el nombre es una corazonada: quien mira tiene que poder revisarla.
  it('lo decidido solo por el nombre no se marca seguro', () => {
    const detectado = detectarRoles([ent('GIDSOURCEPRODUCTION', ['ALGO'])], ROLES_DEL_ARBOL, 'GID')
    expect(detectado.header).toMatchObject({ entidad: 'GIDSOURCEPRODUCTION', seguro: false })
  })

  it('un papel sin nada que encaje queda en null', () => {
    const detectado = detectarRoles([ent('GIDNADA', ['ZZZ'])], ROLES_DEL_ARBOL, 'GID')
    expect(detectado.itemSub.entidad).toBeNull()
  })

  // Para poder cambiarla sin buscar entre seiscientas.
  it('ofrece las alternativas que también encajaban', () => {
    const entidades = [
      ent('GIDPRODUCT', ['PRDID', 'PRDDESCR', 'MATTYPEID']),
      ent('GIDPRODUCTOTRO', ['PRDID']),
    ]
    const detectado = detectarRoles(entidades, ROLES_DEL_ARBOL, 'GID')
    expect(detectado.product.entidad).toBe('GIDPRODUCT')
    expect(detectado.product.alternativas).toContain('GIDPRODUCTOTRO')
  })

  it('cada papel trae su etiqueta legible', () => {
    const detectado = detectarRoles(conPrefijo('GID'), ROLES_DEL_ARBOL, 'GID')
    expect(detectado.product.etiqueta).toBeTruthy()
  })
})

describe('rolesEfectivos', () => {
  const detectado = {
    product: { etiqueta: 'Productos', entidad: 'GIDCUSTOMERPRODUCT', seguro: false, alternativas: ['GIDPRODUCT'] },
    header: { etiqueta: 'Cabecera', entidad: 'GIDSOURCEPRODUCTION', seguro: true, alternativas: [] },
  }

  it('sin correcciones devuelve lo detectado', () => {
    const efectivos = rolesEfectivos(detectado, {})
    expect(efectivos.product.entidad).toBe('GIDCUSTOMERPRODUCT')
    expect(efectivos.product.corregido).toBe(false)
  })

  it('una corrección pisa a la detección', () => {
    const efectivos = rolesEfectivos(detectado, { product: 'GIDPRODUCT' })
    expect(efectivos.product).toMatchObject({ entidad: 'GIDPRODUCT', corregido: true })
  })

  // Alguien miró el tenant y decidió: no hay señal más fuerte, y la puntuación de la máquina no
  // tiene por qué ganarle.
  it('lo corregido a mano cuenta como seguro', () => {
    expect(rolesEfectivos(detectado, { product: 'GIDPRODUCT' }).product.seguro).toBe(true)
  })

  // Si la corrección resulta estar mal, se puede volver sin volver a detectar.
  it('lo que había elegido la máquina pasa a ser alternativa', () => {
    const efectivos = rolesEfectivos(detectado, { product: 'GIDPRODUCT' })
    expect(efectivos.product.alternativas).toContain('GIDCUSTOMERPRODUCT')
    expect(efectivos.product.alternativas).not.toContain('GIDPRODUCT')
  })

  it('corregir a lo mismo que se detectó no cuenta como corrección', () => {
    expect(rolesEfectivos(detectado, { header: 'GIDSOURCEPRODUCTION' }).header.corregido).toBe(false)
  })

  it('una corrección de un papel que no existe no inventa uno', () => {
    expect(Object.keys(rolesEfectivos(detectado, { inventado: 'X' }))).toEqual(['product', 'header'])
  })

  it('resuelve un papel que la detección dejó sin nada', () => {
    const sinResolver = { itemSub: { etiqueta: 'Sustitutos', entidad: null, seguro: false, alternativas: [] } }
    expect(rolesEfectivos(sinResolver, { itemSub: 'GIDPSISUB' }).itemSub)
      .toMatchObject({ entidad: 'GIDPSISUB', seguro: true, corregido: true })
  })

  it('sin nada detectado no hay nada efectivo', () => {
    expect(rolesEfectivos(undefined, { product: 'X' })).toEqual({})
  })
})

describe('gruposEfectivos', () => {
  const porGrupo = {
    arbol: { product: { etiqueta: 'P', entidad: 'A', seguro: false, alternativas: [] } },
    red: { product: { etiqueta: 'P', entidad: 'B', seguro: false, alternativas: [] } },
  }

  it('corrige cada grupo por separado', () => {
    const efectivos = gruposEfectivos(porGrupo, { arbol: { product: 'CORREGIDO' } })
    expect(efectivos.arbol.product.entidad).toBe('CORREGIDO')
    expect(efectivos.red.product.entidad).toBe('B')
  })

  it('sin correcciones devuelve los grupos tal cual', () => {
    expect(gruposEfectivos(porGrupo).arbol.product.entidad).toBe('A')
  })
})

describe('rolesPorRevisar', () => {
  it('junta los que faltan y los que salieron por nombre', () => {
    const detectado = {
      a: { etiqueta: 'A', entidad: 'X', seguro: true },
      b: { etiqueta: 'B', entidad: 'Y', seguro: false },
      c: { etiqueta: 'C', entidad: null, seguro: false },
    }
    expect(rolesPorRevisar(detectado).map((uno) => uno.papel)).toEqual(['b', 'c'])
  })

  it('si todo salió por campos no hay nada que revisar', () => {
    expect(rolesPorRevisar({ a: { entidad: 'X', seguro: true } })).toEqual([])
  })
})
