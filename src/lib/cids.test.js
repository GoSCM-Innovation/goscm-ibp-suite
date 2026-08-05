import { describe, it, expect } from 'vitest'
import { cidsTargets, isTaskPromoted, promotedForTarget } from './cids.js'

const CONEXION = { id: 'conn-1', name: 'Grupo Consenso' }

describe('cidsTargets', () => {
  // Es el punto de todo el modelo: una conexión de CI-DS da acceso a los DOS repositorios, y el
  // logon decide a cuál. No hay dos conexiones que dar de alta.
  it('cada conexión rinde dos destinos: pruebas y productivo', () => {
    const destinos = cidsTargets([CONEXION])

    expect(destinos).toHaveLength(2)
    expect(destinos.map((uno) => uno.production)).toEqual([false, true])
    expect(destinos.map((uno) => uno.connectionId)).toEqual(['conn-1', 'conn-1'])
  })

  it('el de pruebas va primero: es donde se trabaja', () => {
    expect(cidsTargets([CONEXION])[0].production).toBe(false)
  })

  it('los identificadores son distintos entre repositorios de la misma conexión', () => {
    const [pruebas, productivo] = cidsTargets([CONEXION])
    expect(pruebas.id).not.toBe(productivo.id)
  })

  it('la etiqueta dice de qué repositorio se trata', () => {
    const [pruebas, productivo] = cidsTargets([CONEXION])
    expect(pruebas.label).toBe('Grupo Consenso · Pruebas')
    expect(productivo.label).toBe('Grupo Consenso · Productivo')
  })

  it('con varias conexiones sale el doble de destinos', () => {
    expect(cidsTargets([CONEXION, { id: 'conn-2', name: 'Otra' }])).toHaveLength(4)
  })

  it('sin conexiones no inventa destinos', () => {
    expect(cidsTargets([])).toEqual([])
  })
})

describe('promotedForTarget', () => {
  const [pruebas, productivo] = cidsTargets([CONEXION])
  const nombres = new Set(['CARGA_DIARIA'])

  it('aplica la marca cuando es del destino que se está mirando', () => {
    expect(promotedForTarget({ destinoId: pruebas.id, nombres }, pruebas)).toBe(nombres)
  })

  // Al cambiar de repositorio la guardada todavía es del anterior: mostrarla diría que una tarea
  // está transportada cuando no se sabe.
  it('no aplica la marca de otro destino', () => {
    expect(promotedForTarget({ destinoId: pruebas.id, nombres }, productivo)).toBeNull()
  })

  // El caso que reventaba la pantalla: en el primer pintado no hay ni destino ni marca, y comparar
  // identificadores inexistentes daba `undefined === undefined`.
  it('sin destino ni marca devuelve null en vez de reventar', () => {
    expect(promotedForTarget(null, null)).toBeNull()
  })

  it('sin destino no aplica nada, aunque haya marca guardada', () => {
    expect(promotedForTarget({ destinoId: pruebas.id, nombres }, null)).toBeNull()
  })

  it('sin marca guardada no aplica nada, aunque haya destino', () => {
    expect(promotedForTarget(null, pruebas)).toBeNull()
  })

  // El resultado nulo de la consulta —"esto ya es el productivo"— se guarda igual, y también
  // significa "no mostrar nada".
  it('una marca guardada en nulo sigue siendo nada que mostrar', () => {
    expect(promotedForTarget({ destinoId: productivo.id, nombres: null }, productivo)).toBeNull()
  })
})

describe('isTaskPromoted', () => {
  const nombres = new Set(['CARGA_DIARIA'])

  it('compara sin espacios y sin distinguir mayúsculas', () => {
    expect(isTaskPromoted(nombres, '  carga_diaria ')).toBe(true)
  })

  it('una tarea que no está no se marca', () => {
    expect(isTaskPromoted(nombres, 'OTRA')).toBe(false)
  })

  it('sin marca no se marca nada, y no revienta', () => {
    expect(isTaskPromoted(null, 'CARGA_DIARIA')).toBe(false)
    expect(isTaskPromoted(undefined, 'CARGA_DIARIA')).toBe(false)
  })

  it('una tarea sin nombre no se marca', () => {
    expect(isTaskPromoted(nombres, null)).toBe(false)
    expect(isTaskPromoted(nombres, '')).toBe(false)
  })
})
