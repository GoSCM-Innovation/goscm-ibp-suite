// Bajar el dato maestro del tenant a la base local, viendo qué pasa.
//
// Portada de las dos pantallas de descarga de v7 —la del árbol y la de la red—, que eran la misma
// cosa duplicada con distintas etiquetas.
//
// Lo que la pantalla dice antes de empezar es la mitad del valor: qué tablas se van a bajar, cuáles no
// se van a poder y por qué. Enterarse a los seis minutos de que falta la tabla principal, después de
// bajar tres que no sirven sin ella, es la diferencia entre una herramienta y un castigo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  GRUPOS_DE_EXTRACCION,
  planificarExtraccion,
  versionSinDatos,
} from '../../../core/ibp/explorer-extract-plan.js'
import { fetchExplorerMap } from '../../lib/ibp-explorer.js'
import { contar } from '../../lib/explorer-db.js'
import { extraer } from '../../lib/explorer-extract.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

export default function ExplorerExtract({ destino }) {
  const [mapa, setMapa] = useState(null)
  const [error, setError] = useState('')
  const [grupos, setGrupos] = useState(['arbol', 'red'])

  const [bajando, setBajando] = useState(false)
  const [avance, setAvance] = useState(null)
  const [salida, setSalida] = useState(null)
  const [guardadasAntes, setGuardadasAntes] = useState(null)

  // Una ref y no estado: el bucle de descarga la consulta en cada página, y con estado leería el
  // valor que tenía cuando arrancó.
  const cancelar = useRef(false)

  // Diferido para no encadenar renders: pedir y marcar «cargando» en el cuerpo del efecto hace que
  // React vuelva a dibujar antes de terminar el que está haciendo.
  useEffect(() => {
    let abandonado = false

    const id = setTimeout(() => {
      setMapa(null)
      fetchExplorerMap(destino)
        .then((leido) => { if (!abandonado) { setMapa(leido); setError('') } })
        .catch((fallo) => { if (!abandonado) { setError(fallo.message); setMapa(false) } })
    }, 0)

    return () => { abandonado = true; clearTimeout(id) }
  }, [destino])

  const plan = useMemo(
    () => (mapa ? planificarExtraccion({ efectivo: mapa.efectivo, mapa: mapa.guardado.fields, grupos }) : null),
    [mapa, grupos],
  )

  /** Cuántas filas hay ya guardadas de cada tabla, para saber si vale la pena volver a bajar. */
  const contarLoGuardado = useCallback(async () => {
    if (!plan) return
    const cuentas = {}
    for (const paso of plan.pasos) {
      try {
        cuentas[paso.tabla] = await contar(paso.tabla)
      } catch {
        cuentas[paso.tabla] = 0
      }
    }
    setGuardadasAntes(cuentas)
  }, [plan])

  useEffect(() => {
    const id = setTimeout(contarLoGuardado, 0)
    return () => clearTimeout(id)
  }, [contarLoGuardado])

  async function bajar() {
    cancelar.current = false
    setBajando(true)
    setSalida(null)
    setAvance(null)

    try {
      const hecho = await extraer({
        conexionId: destino.connectionId,
        destino,
        plan,
        mapa: mapa.guardado.fields,
        onProgreso: setAvance,
        cancelado: () => cancelar.current,
      })
      setSalida(hecho)
      contarLoGuardado()
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setBajando(false)
      setAvance(null)
    }
  }

  if (mapa === null) return <div className="page-hint">Leyendo el catálogo del tenant… tarda unos segundos.</div>
  if (mapa === false) return <div className="notice notice-error">✕ {error}</div>

  const hayAlgo = Object.values(guardadasAntes ?? {}).some((cuantas) => cuantas > 0)

  return (
    <div className="module-body">
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="monitor-bar">
        <div className="seg">
          {GRUPOS_DE_EXTRACCION.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`seg-btn${grupos.includes(id) ? ' active' : ''}`}
              onClick={() => setGrupos((previos) => (previos.includes(id)
                ? previos.filter((otro) => otro !== id)
                : [...previos, id]))}
              aria-pressed={grupos.includes(id)}
              disabled={bajando}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={bajar}
          disabled={bajando || plan.gruposPosibles.length === 0}
        >
          {bajando ? 'Bajando…' : hayAlgo ? 'Volver a bajar' : 'Bajar los datos'}
        </button>

        {bajando && (
          <button type="button" className="btn btn-sm" onClick={() => { cancelar.current = true }}>
            Cancelar
          </button>
        )}

        <span className="page-hint">
          {avance
            ? `${avance.etiqueta}: ${numero(avance.bajadas)} filas`
            : bajando
              ? 'Preparando…'
              : `${plan.pasos.filter((uno) => uno.sePuede).length} tablas por bajar`}
        </span>
      </div>

      {/* Lo que NO se va a poder, antes de empezar. */}
      {plan.avisos.map((aviso) => (
        <div className="notice notice-info" key={aviso}>{aviso}</div>
      ))}

      {plan.gruposPosibles.length === 0 && (
        <div className="notice notice-error">
          ✕ No se puede bajar nada: a los grupos elegidos les falta alguna tabla imprescindible.
          Revisá «Origen de los datos» — quizá haya que decirle a mano qué tabla usar.
        </div>
      )}

      {/* «0 filas» a secas es cierto y no sirve: no dice que el problema es la versión elegida. */}
      {salida && versionSinDatos(plan.pasos, salida.hechos).vacia && (
        <div className="notice notice-error">
          ✕ <b>Esta versión no tiene datos.</b> Ninguna de las tablas imprescindibles trajo una sola
          fila, así que no hay nada que analizar. Casi siempre es que la versión elegida está vacía en
          SAP: probá con la <b>versión base</b>, que es donde vive el dato maestro del área.
        </div>
      )}

      {salida && (
        <div className={`notice notice-${salida.ok ? 'ok' : 'info'}`}>
          {salida.ok ? '✓ ' : ''}
          Se guardaron {numero(salida.guardadas)} filas
          {salida.descartadas > 0 && `, y se descartaron ${numero(salida.descartadas)} que SAP marca como inválidas`}
          {salida.conError > 0 && ` · ${salida.conError} ${salida.conError === 1 ? 'tabla falló' : 'tablas fallaron'}`}
          {salida.seVacio && ' · se borró lo que había de otro tenant, área o versión'}.
        </div>
      )}

      <div className="card">
        <div className="card-label">Qué se baja</div>
        <div className="table-scroll">
          <table className="table-dense">
            <thead>
              <tr>
                <th>Para qué</th><th>Tabla del tenant</th><th>Guardadas</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {plan.pasos.map((paso) => {
                const suyo = salida?.hechos.find((uno) => uno.tabla === paso.tabla)
                const antes = guardadasAntes?.[paso.tabla]
                // Lo que va trayendo AHORA esta tabla, si es la que está en curso.
                const enCurso = avance?.tabla === paso.tabla ? avance : null

                return (
                  <tr key={paso.tabla}>
                    <td>
                      {paso.etiqueta}
                      <div className="exp-sub">
                        {GRUPOS_DE_EXTRACCION.find((uno) => uno.id === paso.grupo)?.label}
                        {!paso.esencial && ' · accesoria'}
                      </div>
                    </td>
                    <td>
                      {paso.entidad ?? <span className="exp-sub">ninguna</span>}
                      {paso.omitidos.length > 0 && (
                        <div className="exp-sub" style={{ color: 'var(--accent)' }}>
                          sin {paso.omitidos.join(', ')}
                        </div>
                      )}
                    </td>
                    {/* El número tiene que decir DE CUÁNDO es. Mientras la descarga corre, acá se
                        veía el conteo de la corrida ANTERIOR bajo un encabezado que dice «Guardadas»:
                        una tabla llena de ceros mientras la línea de progreso decía que esa misma
                        tabla traía 47.919 filas. Un dato viejo sin fecha se lee como el de ahora. */}
                    <td>
                      {suyo && numero(suyo.guardadas)}
                      {!suyo && enCurso && numero(enCurso.guardadas)}
                      {!suyo && !enCurso && (antes === undefined || antes === 0
                        ? '—'
                        : <span className="exp-sub">{numero(antes)} de antes</span>)}

                      {suyo && suyo.bajadas > suyo.guardadas && (
                        <div className="exp-sub">de {numero(suyo.bajadas)} bajadas</div>
                      )}
                    </td>
                    <td>
                      {!paso.sePuede && <span style={{ color: 'var(--text3)' }}>No se puede</span>}
                      {paso.sePuede && suyo?.error && <span style={{ color: 'var(--red)' }}>✕ {suyo.error}</span>}
                      {paso.sePuede && suyo?.cancelado && <span style={{ color: 'var(--accent)' }}>Cancelada</span>}
                      {paso.sePuede && suyo && !suyo.error && !suyo.cancelado && (
                        <span style={{ color: 'var(--green)' }}>✓ Lista</span>
                      )}
                      {paso.sePuede && !suyo && avance?.tabla === paso.tabla && <span>Bajando…</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
