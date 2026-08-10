// Contra qué tablas de ESTE tenant va a trabajar el explorador, y cómo corregirlo.
//
// Es la pantalla que faltaba debajo de todo lo demás. Portada de los selectores de tipo de dato
// maestro de `main.js` de v7 —`selHeader`, `selItem`, `selProduct`…— y de su panel de corrección de
// campos, que allí eran dos cosas separadas y aquí es una sola: las dos responden la misma pregunta.
//
// Por qué existe: el explorador necesita "el maestro de productos" y "la cabecera de receta", y
// ninguna se llama igual en dos tenants. La máquina lo deduce y acierta casi siempre; "casi" no
// alcanza cuando de esto depende un análisis de calidad de datos que alguien va a llevar a una
// reunión. Así que lo dudoso se marca y se puede cambiar.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { gruposEfectivos } from '../../../core/ibp/explorer-entities.js'
import { fetchExplorerMap, resetExplorerMap, saveExplorerMap } from '../../lib/ibp-explorer.js'

/** Los dos grupos de papeles, con el nombre que ve quien mira. */
const GRUPOS = [
  { id: 'arbol', label: 'Árbol de materiales' },
  { id: 'red', label: 'Red de suministro' },
]

/** Cómo se ve cada estado de un papel. */
function estadoDe(uno) {
  if (!uno.entidad) return { label: 'Sin resolver', color: 'var(--red)' }
  if (uno.corregido) return { label: 'Corregido a mano', color: 'var(--cyan)' }
  if (!uno.seguro) return { label: 'Deducido del nombre', color: 'var(--accent)' }
  return { label: 'Reconocido', color: 'var(--green)' }
}

/** Una fila: el papel, contra qué tabla resuelve, y cómo cambiarla. */
function Papel({ papel, uno, entidades, onCambiar }) {
  const estado = estadoDe(uno)

  // Primero las que encajaban, después el resto del área: cambiar a una que no encaja es raro pero
  // legítimo —el tenant puede tener una tabla con otro nombre de campo ya mapeado—.
  //
  // Sin repetir: la elegida puede estar además entre las alternativas, y dos opciones con el mismo
  // valor rompen el listado.
  const opciones = useMemo(() => {
    const cerca = [...new Set([uno.entidad, ...uno.alternativas].filter(Boolean))]
    const resto = entidades.filter((una) => !cerca.includes(una))
    return { cerca, resto }
  }, [uno.entidad, uno.alternativas, entidades])

  return (
    <tr>
      <td>
        {uno.etiqueta}
        <div className="exp-sub mono">{papel}</div>
      </td>
      <td>
        <select
          className="select input-sm"
          value={uno.entidad ?? ''}
          onChange={(evento) => onCambiar(papel, evento.target.value)}
          aria-label={`Tabla para ${uno.etiqueta}`}
        >
          {/* «Sin resolver» solo aparece cuando ES el estado actual. Ofrecerlo como elección cuando
              ya hay una tabla detectada dejaría un valor vacío que no significa "apagá este papel"
              sino "sin corrección", y las dos cosas se verían igual. */}
          {!uno.entidad && <option value="">— sin resolver —</option>}
          {opciones.cerca.length > 0 && (
            <optgroup label="Encajan por sus campos">
              {opciones.cerca.map((una) => <option key={una} value={una}>{una}</option>)}
            </optgroup>
          )}
          {opciones.resto.length > 0 && (
            <optgroup label={`Otras del área (${opciones.resto.length})`}>
              {opciones.resto.map((una) => <option key={una} value={una}>{una}</option>)}
            </optgroup>
          )}
        </select>
      </td>
      <td>
        <span
          className="badge"
          style={{ background: `${estado.color}26`, borderColor: `${estado.color}4d`, color: estado.color }}
        >
          {estado.label}
        </span>
      </td>
    </tr>
  )
}

export default function ExplorerSetup({ destino }) {
  const [mapa, setMapa] = useState(null)
  const [correcciones, setCorrecciones] = useState({})
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  const cargar = useCallback(() => {
    let abandonado = false
    setMapa(null)

    fetchExplorerMap(destino)
      .then((leido) => {
        if (abandonado) return
        setMapa(leido)
        setCorrecciones(leido.guardado.roles ?? {})
        setError('')
      })
      .catch((fallo) => { if (!abandonado) { setError(fallo.message); setMapa(false) } })

    return () => { abandonado = true }
  }, [destino])

  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  /**
   * Lo que se está viendo: lo detectado con las correcciones encima, incluidas las sin guardar.
   *
   * Se combina con la MISMA función que usa el servidor, y no con una versión propia. Escribirla dos
   * veces fue justamente el primer fallo: la de aquí no quitaba de las alternativas la tabla recién
   * elegida, así que aparecía dos veces en la lista.
   */
  const efectivo = useMemo(
    () => (mapa ? gruposEfectivos(mapa.detectado, correcciones) : {}),
    [mapa, correcciones],
  )

  const porRevisar = useMemo(() => Object.values(efectivo)
    .flatMap((roles) => Object.values(roles))
    .filter((uno) => !uno.entidad || !uno.seguro).length, [efectivo])

  // Comparar contra lo guardado y no contra un booleano: así volver a poner el valor original vuelve
  // a marcar la pantalla como sin cambios, en vez de dejar el botón encendido para siempre.
  const hayCambios = mapa && JSON.stringify(correcciones) !== JSON.stringify(mapa.guardado.roles ?? {})

  function cambiar(grupo, papel, entidad) {
    setGuardado(false)
    setCorrecciones((previas) => {
      const suyas = { ...(previas[grupo] ?? {}) }
      const detectada = mapa.detectado?.[grupo]?.[papel]?.entidad ?? null

      // Volver a lo que la máquina había deducido NO se guarda como corrección: si mañana mejora la
      // detección, una corrección redundante la congelaría.
      if (entidad === detectada || (!entidad && !detectada)) delete suyas[papel]
      else suyas[papel] = entidad

      const salida = { ...previas }
      if (Object.keys(suyas).length === 0) delete salida[grupo]
      else salida[grupo] = suyas
      return salida
    })
  }

  async function guardar() {
    setGuardando(true)
    try {
      await saveExplorerMap({ ...destino, roles: correcciones, fields: mapa.guardado.fields ?? {} })
      setGuardado(true)
      cargar()
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setGuardando(false)
    }
  }

  async function volverAlAutomatico() {
    setGuardando(true)
    try {
      await resetExplorerMap(destino)
      setCorrecciones({})
      setGuardado(false)
      cargar()
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setGuardando(false)
    }
  }

  if (mapa === null) {
    return <div className="page-hint">Leyendo el catálogo del tenant… tarda unos segundos.</div>
  }

  if (mapa === false) return <div className="notice notice-error">✕ {error}</div>

  return (
    <div className="module-body">
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="monitor-bar">
        <span className="page-hint">
          Prefijo de este tenant: <b className="mono">{mapa.prefijo || '—'}</b>
          {' · '}{mapa.entidades.length} tablas en el área
        </span>
        <button type="button" className="btn btn-sm btn-primary" onClick={guardar} disabled={!hayCambios || guardando}>
          {guardando ? 'Guardando…' : 'Guardar las correcciones'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={volverAlAutomatico}
          disabled={guardando || Object.keys(mapa.guardado.roles ?? {}).length === 0}
        >
          Volver a la detección automática
        </button>
        {guardado && !hayCambios && <span className="page-hint" style={{ color: 'var(--green)' }}>✓ Guardado</span>}
      </div>

      {porRevisar > 0
        ? (
          <div className="notice notice-info">
            {porRevisar === 1
              ? 'Hay 1 papel que conviene mirar: '
              : `Hay ${porRevisar} papeles que conviene mirar: `}
            o no se resolvió, o se dedujo por el nombre de la tabla y no por sus campos. Si están
            bien, no hace falta tocar nada — se marcan para que nadie dé por bueno un análisis sin
            haberlos visto.
          </div>
        )
        : (
          <div className="notice notice-ok">
            ✓ Todas las tablas se reconocieron por sus campos, que es la señal fiable.
          </div>
        )}

      {mapa.guardado.updatedAt && (
        <div className="exp-sub">
          Hay correcciones guardadas para este destino, de {new Date(mapa.guardado.updatedAt).toLocaleString('es')}.
          Las ve todo el equipo.
        </div>
      )}

      {GRUPOS.map(({ id, label }) => (
        <div className="card" key={id}>
          <div className="card-label">{label}</div>
          <div className="table-scroll">
            <table className="table-dense">
              <thead>
                <tr><th>Para qué</th><th>Tabla de este tenant</th><th>Cómo se resolvió</th></tr>
              </thead>
              <tbody>
                {Object.entries(efectivo[id] ?? {}).map(([papel, uno]) => (
                  <Papel
                    key={papel}
                    papel={papel}
                    uno={uno}
                    entidades={mapa.entidades}
                    onCambiar={(cual, entidad) => cambiar(id, cual, entidad)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
