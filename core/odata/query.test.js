import { describe, it, expect } from 'vitest'
import { SERVICES, buildQuery, buildReadUrl } from './query.js'
import {
  DEFAULT_PAGE_SIZE,
  chunkSizeFor,
  pageSizeFor,
  pageSizeForBytes,
} from './page-size.js'

describe('buildQuery', () => {
  it('pide siempre el formato JSON', () => {
    expect(buildQuery({ service: SERVICES.MASTER })).toBe('$format=json')
  })

  it('exige decir de qué servicio se trata', () => {
    expect(() => buildQuery({})).toThrow(/Servicio desconocido/)
  })

  it('acepta $select como lista o como texto', () => {
    expect(buildQuery({ service: SERVICES.PLANNING, select: ['A', 'B'] })).toContain('$select=A%2CB')
    expect(buildQuery({ service: SERVICES.PLANNING, select: 'A,B' })).toContain('$select=A%2CB')
  })

  it('en datos de planificación exige $select, porque sin él SAP agrega a otro nivel', () => {
    expect(() => buildQuery({ service: SERVICES.PLANNING })).toThrow(/agrega a un nivel más alto/)
  })

  it('en dato maestro $select es opcional', () => {
    expect(() => buildQuery({ service: SERVICES.MASTER })).not.toThrow()
  })

  it('prohíbe $top=0 en datos de planificación: tumba el servicio', () => {
    expect(() => buildQuery({ service: SERVICES.PLANNING, select: 'A', top: 0 }))
      .toThrow(/tumba el servicio/)
  })

  it('permite $top=0 en dato maestro, donde es seguro para contar', () => {
    expect(buildQuery({ service: SERVICES.MASTER, top: 0 })).toContain('$top=0')
  })

  it('rechaza un filtro que SAP ignoraría en silencio', () => {
    expect(() => buildQuery({ service: SERVICES.MASTER, filter: 'KF ne 0' })).toThrow(/nonZero/)
  })

  it('codifica el filtro para que viaje en la URL', () => {
    // La comilla simple no se escapa: es un carácter válido en una URL y SAP la espera así.
    const query = buildQuery({ service: SERVICES.MASTER, filter: "PRDID eq 'A B'" })
    expect(query).toContain("$filter=PRDID%20eq%20'A%20B'")
  })

  it('omite $skip cuando es cero, que es el valor por defecto de SAP', () => {
    expect(buildQuery({ service: SERVICES.MASTER, skip: 0 })).not.toContain('$skip')
    expect(buildQuery({ service: SERVICES.MASTER, skip: 100 })).toContain('$skip=100')
  })

  it('añade el conteo cuando se pide', () => {
    expect(buildQuery({ service: SERVICES.MASTER, inlinecount: true })).toContain('$inlinecount=allpages')
  })

  it('acepta el orden como lista', () => {
    expect(buildQuery({ service: SERVICES.MASTER, orderby: ['A', 'B'] })).toContain('$orderby=A%2CB')
  })
})

describe('buildReadUrl', () => {
  it('junta la raíz del servicio con la entidad y la consulta', () => {
    const url = buildReadUrl({
      serviceRoot: 'https://c-api.scmibp.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/',
      entity: 'Producto',
      service: SERVICES.MASTER,
      top: 100,
    })
    expect(url).toBe('https://c-api.scmibp.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/Producto?$format=json&$top=100')
  })

  it('no duplica la barra si la raíz ya la trae', () => {
    const url = buildReadUrl({ serviceRoot: 'https://x/y///', entity: 'E', service: SERVICES.MASTER })
    expect(url).toBe('https://x/y/E?$format=json')
  })

  it('exige raíz y entidad', () => {
    expect(() => buildReadUrl({ entity: 'E', service: SERVICES.MASTER })).toThrow(/raíz/)
    expect(() => buildReadUrl({ serviceRoot: 'https://x', service: SERVICES.MASTER })).toThrow(/entidad/)
  })
})

describe('tamaño de página', () => {
  it('con muchos campos por fila, caben menos filas por página', () => {
    expect(pageSizeFor(100)).toBeLessThan(pageSizeFor(10))
  })

  it('nunca baja de 250 ni sube de 5000 filas', () => {
    expect(pageSizeFor(10_000)).toBe(250)
    expect(pageSizeFor(1)).toBe(5000)
  })

  it('sin saber los campos usa el valor por defecto', () => {
    expect(pageSizeFor(0)).toBe(DEFAULT_PAGE_SIZE)
    expect(pageSizeForBytes(undefined)).toBe(DEFAULT_PAGE_SIZE)
  })

  it('el presupuesto de escritura es mayor que el de lectura, así que caben más filas', () => {
    expect(chunkSizeFor(20)).toBeGreaterThan(pageSizeFor(20))
  })

  it('el trozo de escritura nunca baja de 500 filas', () => {
    expect(chunkSizeFor(10_000)).toBe(500)
  })
})
