// El paso ① de las cuatro aplicaciones de datos: contra qué tablas de ESTE tenant se va a trabajar.
//
// Portado del panel «MAPEO DE ENTIDADES» de v7 (`#panelMDT`, `#panelPAMDT`, `#panelVizMDT`,
// `#panelSNMDT` en su `index.html`, y `populateMDTPanel` y hermanas en `main.js`). En v7 había cuatro
// copias del mismo panel con distintos identificadores; aquí es uno, parametrizado por el grupo de
// papeles que cada aplicación necesita —el árbol o la red—.
//
// POR QUÉ ESTE PASO EXISTE, que es lo que hace que no se pueda saltar: ninguna tabla de SAP IBP se
// llama igual en dos tenants. «El maestro de productos» es `GIDPRODUCT` en uno y `AS1PRODUCT` en
// otro. La máquina lo deduce y acierta casi siempre; «casi» no alcanza cuando de esto depende un
// análisis que alguien va a llevar a una reunión. Por eso lo dudoso se marca y se puede cambiar.
//
// Las correcciones se guardan al pulsar «Continuar»: son del destino, no de la sesión, y las ve todo
// el equipo. Volver a poner lo que la máquina había deducido borra la corrección en vez de
// guardarla — si mañana mejora la detección, una corrección redundante la congelaría.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { ROLES_DEL_ARBOL, ROLES_DE_RED, gruposEfectivos } from '../../../core/ibp/explorer-entities.js'
import { fetchExplorerMap, resetExplorerMap, saveExplorerMap } from '../../lib/ibp-explorer.js'
import { verAsistente } from '../../lib/conexion-activa.js'

/** Los papeles de cada grupo, para poder decir qué campos exige cada uno. */
const ROLES = { arbol: ROLES_DEL_ARBOL, red: ROLES_DE_RED }

/** Cómo se ve cada estado de un papel. Los colores son los de v7. */
function estadoDe(uno) {
  if (!uno.entidad) return { label: 'Sin resolver', color: 'var(--red)' }
  if (uno.corregido) return { label: 'Corregido a mano', color: 'var(--cyan)' }
  if (!uno.seguro) return { label: 'Deducido del nombre', color: 'var(--accent)' }
  return { label: 'Reconocido', color: 'var(--green)' }
}

/** Una tarjeta del mapeo: el papel, contra qué tabla resuelve, y cómo cambiarla. */
function Tarjeta({ grupo, papel, uno, entidades, campos, onCambiar }) {
  const estado = estadoDe(uno)

  // Primero las que encajaban, después el resto del área: cambiar a una que no encaja es raro pero
  // legítimo —el tenant puede tener una tabla con otro nombre de campo ya mapeado—.
  //
  // Sin repetir: la elegida puede estar además entre las alternativas, y dos opciones con el mismo
  // valor rompen el listado.
  const opciones = useMemo(() => {
    const cerca = [...new Set([uno.entidad, ...(uno.alternativas ?? [])].filter(Boolean))]
    const resto = entidades.filter((una) => !cerca.includes(una))
    return { cerca, resto }
  }, [uno.entidad, uno.alternativas, entidades])

  // Debajo, los campos de la tabla elegida —como en v7— y los que el papel exige, marcados si están.
  // Es lo que deja ver de un vistazo POR QUÉ esta tabla y no otra, y qué falta cuando falta algo.
  const exige = ROLES[grupo]?.[papel]?.debeTener ?? []
  const suyos = campos?.[uno.entidad] ?? []

  return (
    <div className="mdt-card">
      <div className="mdt-label">{uno.etiqueta}</div>
      <select
        value={uno.entidad ?? ''}
        onChange={(evento) => onCambiar(papel, evento.target.value)}
        aria-label={`Tabla para ${uno.etiqueta}`}
      >
        {/* «Sin resolver» solo aparece cuando ES el estado actual. Ofrecerlo como elección cuando ya
            hay una tabla detectada dejaría un valor vacío que no significa «apaga este papel» sino
            «sin corrección», y las dos cosas se verían igual. */}
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
      <div className="mdt-fields">
        <span style={{ color: estado.color }}>● {estado.label}</span>
        {exige.length > 0 && (
          <div>
            {exige.map((campo) => (
              <span
                key={campo}
                style={{ color: suyos.length === 0 || suyos.includes(campo) ? 'var(--text3)' : 'var(--red)' }}
              >
                {campo}{' '}
              </span>
            ))}
          </div>
        )}
        {suyos.length > 0 && <div>{suyos.length} campos</div>}
      </div>
    </div>
  )
}

export default function PanelMapeo({
  grupo,
  destino,
  abierto,
  onAlternar,
  textoConfirmar = 'Continuar →',
  confirmando = false,
  onConfirmar,
  children = null,
}) {
  const [mapa, setMapa] = useState(null)
  const [correcciones, setCorrecciones] = useState({})
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

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

  // Diferido para no encadenar renders: pedir y marcar «cargando» en el cuerpo del efecto hace que
  // React vuelva a dibujar antes de terminar el que está haciendo.
  useEffect(() => {
    const id = setTimeout(cargar, 0)
    return () => clearTimeout(id)
  }, [cargar])

  /**
   * Lo que se está viendo: lo detectado con las correcciones encima, incluidas las sin guardar.
   *
   * Se combina con la MISMA función que usa el servidor, y no con una versión propia. Escribirla dos
   * veces fue justamente el primer fallo: la de aquí no quitaba de las alternativas la tabla ya
   * elegida, así que aparecía dos veces en la lista.
   */
  const efectivo = useMemo(
    () => (mapa ? gruposEfectivos(mapa.detectado, correcciones) : {}),
    [mapa, correcciones],
  )

  const papeles = useMemo(() => Object.entries(efectivo[grupo] ?? {}), [efectivo, grupo])
  const porRevisar = papeles.filter(([, uno]) => !uno.entidad || !uno.seguro).length

  const hayCambios = mapa && JSON.stringify(correcciones) !== JSON.stringify(mapa.guardado.roles ?? {})

  function cambiar(papel, entidad) {
    setCorrecciones((previas) => {
      const suyas = { ...(previas[grupo] ?? {}) }
      const detectada = mapa.detectado?.[grupo]?.[papel]?.entidad ?? null

      // Volver a lo que la máquina había deducido NO se guarda como corrección.
      if (entidad === detectada || (!entidad && !detectada)) delete suyas[papel]
      else suyas[papel] = entidad

      const salida = { ...previas }
      if (Object.keys(suyas).length === 0) delete salida[grupo]
      else salida[grupo] = suyas
      return salida
    })
  }

  /** «Continuar»: guarda lo corregido —si hay algo— y entrega el mapeo a la aplicación. */
  async function confirmar() {
    if (hayCambios) {
      setGuardando(true)
      try {
        await saveExplorerMap({ ...destino, roles: correcciones, fields: mapa.guardado.fields ?? {} })
      } catch (fallo) {
        setError(fallo.message)
        setGuardando(false)
        return
      }
      setGuardando(false)
    }
    // Se entrega también el mapa entero: el paso ④ de los analizadores necesita saber qué CAMPOS
    // tiene cada tabla de este tenant, y esa lista llegó con la detección.
    onConfirmar?.(efectivo, mapa)
  }

  async function volverAlAutomatico() {
    setGuardando(true)
    try {
      await resetExplorerMap(destino)
      setCorrecciones({})
      cargar()
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="panel">
      <div
        className="panel-title collapsible"
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={onAlternar}
        onKeyDown={(evento) => { if (evento.key === 'Enter' || evento.key === ' ') onAlternar() }}
        role="button"
        tabIndex={0}
        aria-expanded={abierto}
      >
        <span>① Mapeo de entidades</span>
        <span style={{ fontSize: 11 }}>{abierto ? '▼' : '▶'}</span>
      </div>

      {abierto && (
        <>
          {error && <div className="notice notice-error">✕ {error}</div>}

          {mapa === null && (
            <p className="panel-desc">Leyendo el catálogo del tenant… tarda unos segundos.</p>
          )}

          {mapa && (
            <>
              <p className="panel-desc">
                La auto-detección asignó las entidades más probables. Ajusta manualmente si es
                necesario. Prefijo de este tenant: <b className="mono">{mapa.prefijo || '—'}</b>
                {' · '}{mapa.entidades.length} tablas en el área.
              </p>

              {porRevisar > 0
                ? (
                  <div className="mattype-note">
                    {porRevisar === 1
                      ? 'Hay 1 papel que conviene mirar: '
                      : `Hay ${porRevisar} papeles que conviene mirar: `}
                    o no se resolvió, o se dedujo por el nombre de la tabla y no por sus campos. Si
                    están bien, no hace falta tocar nada — se marcan para que nadie dé por bueno un
                    análisis sin haberlos visto.
                  </div>
                )
                : (
                  <div className="mattype-note">
                    ✓ Todas las tablas se reconocieron por sus campos, que es la señal fiable.
                  </div>
                )}

              <div className="mdt-grid">
                {papeles.map(([papel, uno]) => (
                  <Tarjeta
                    key={papel}
                    grupo={grupo}
                    papel={papel}
                    uno={uno}
                    entidades={mapa.entidades}
                    campos={mapa.campos}
                    onCambiar={cambiar}
                  />
                ))}
              </div>

              {mapa.guardado?.updatedAt && (
                <p className="panel-desc" style={{ marginTop: 10, marginBottom: 0 }}>
                  Hay correcciones guardadas para este destino, de{' '}
                  {new Date(mapa.guardado.updatedAt).toLocaleString('es')}. Las ve todo el equipo.
                </p>
              )}

              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmar}
                  disabled={guardando || confirmando}
                >
                  {guardando ? 'Guardando…' : (confirmando ? 'Trabajando…' : textoConfirmar)}
                </button>
                {/* El segundo botón de v7 en los CUATRO paneles ① (`onclick="doConnect()"`). Aquí
                    abre el asistente de conexión, que es su equivalente: reconectar es elegir otra
                    vez contra qué tenant, área y versión se trabaja. */}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => verAsistente(true)}
                  disabled={guardando || confirmando}
                >
                  Reconectar
                </button>
                {/* Este no es de v7 y es deliberado: allí las correcciones vivían en la sesión y se
                    iban al recargar, así que no había nada que deshacer. Aquí se guardan para todo
                    el equipo, y una corrección equivocada sin forma de volver atrás es permanente. */}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={volverAlAutomatico}
                  disabled={guardando || Object.keys(mapa.guardado?.roles ?? {}).length === 0}
                >
                  Volver a la detección automática
                </button>
              </div>

              {children}
            </>
          )}
        </>
      )}
    </div>
  )
}
