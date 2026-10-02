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

import { NINGUNA, gruposEfectivos } from '../../../core/ibp/explorer-entities.js'
import { fetchExplorerMap, resetExplorerMap, saveExplorerMap } from '../../lib/ibp-explorer.js'
import { verAsistente } from '../../lib/conexion-activa.js'
import { MAPEO_V7 } from '../../lib/mapeo-v7.js'

/**
 * El desplegable con buscador de v7 (`initSearchSelect`): se escribe para filtrar, «(ninguna)» va
 * siempre primero y cada opción dice cuántos campos tiene. Cerrar sin elegir deja lo que había.
 */
function BuscadorDeEntidad({ valor, entidades, campos, onElegir }) {
  // `null` = no se está escribiendo: se ve la etiqueta de lo elegido.
  const [filtro, setFiltro] = useState(null)
  const [abierta, setAbierta] = useState(false)

  const etiqueta = (nombre) => (nombre ? `${nombre} (${(campos?.[nombre] ?? []).length} campos)` : '')
  const f = (filtro ?? '').toLowerCase()
  const coincidencias = entidades.filter((una) => !f || una.toLowerCase().includes(f))

  function elegir(nombre) {
    onElegir(nombre)
    setFiltro(null)
    setAbierta(false)
  }

  return (
    <div className="ss-wrap">
      <input
        type="text"
        className="ss-input-vis"
        placeholder="Buscar entidad..."
        autoComplete="off"
        value={filtro ?? etiqueta(valor)}
        onFocus={(evento) => { evento.target.select(); setAbierta(true) }}
        onChange={(evento) => { setFiltro(evento.target.value); setAbierta(true) }}
        onBlur={() => { setFiltro(null); setAbierta(false) }}
        onKeyDown={(evento) => { if (evento.key === 'Escape') evento.target.blur() }}
      />
      <div className={`ss-list${abierta ? ' open' : ''}`}>
        {/* `onMouseDown` y no `onClick`: el campo pierde el foco antes del clic y cierra la lista. */}
        <div
          className={`ss-opt${!valor ? ' active' : ''}`}
          onMouseDown={(evento) => { evento.preventDefault(); elegir('') }}
        >
          (ninguna)
        </div>
        {coincidencias.map((una) => (
          <div
            key={una}
            className={`ss-opt${valor === una ? ' active' : ''}`}
            onMouseDown={(evento) => { evento.preventDefault(); elegir(una) }}
          >
            {etiqueta(una)}
          </div>
        ))}
        {f && coincidencias.length === 0 && <div className="ss-none">Sin resultados para "{filtro}"</div>}
      </div>
    </div>
  )
}

/** Una tarjeta del mapeo: el nombre de v7, el buscador y, debajo, los campos de la tabla elegida. */
function Tarjeta({ tarjeta, uno, entidades, campos, onCambiar }) {
  const suyos = campos?.[uno.entidad] ?? null
  return (
    <div className="mdt-card">
      <div className="mdt-label">
        {tarjeta.etiqueta}
        {tarjeta.maestro && <span style={{ fontSize: 10, color: 'var(--text3)' }}> (maestro)</span>}
      </div>
      <BuscadorDeEntidad
        valor={uno.entidad ?? ''}
        entidades={entidades}
        campos={campos}
        onElegir={(nombre) => onCambiar(tarjeta.grupo, tarjeta.papel, nombre)}
      />
      <div className="mdt-fields">{suyos ? suyos.join(', ') : '—'}</div>
    </div>
  )
}

export default function PanelMapeo({
  variante,
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

  const { pista, tarjetas } = MAPEO_V7[variante]

  const hayCambios = mapa && JSON.stringify(correcciones) !== JSON.stringify(mapa.guardado.roles ?? {})

  function cambiar(grupo, papel, entidad) {
    setCorrecciones((previas) => {
      const suyas = { ...(previas[grupo] ?? {}) }
      const detectada = mapa.detectado?.[grupo]?.[papel]?.entidad ?? null

      // Volver a lo que la máquina había deducido NO se guarda como corrección.
      if (entidad === (detectada ?? '')) delete suyas[papel]
      // «(ninguna)» sobre algo detectado SÍ es una decisión, y se guarda con su propio valor.
      else if (!entidad) suyas[papel] = NINGUNA
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
        <span>MAPEO DE ENTIDADES</span>
        <span style={{ fontSize: 11 }}>{abierto ? '▼' : '▶'}</span>
      </div>

      {abierto && (
        <>
          {error && <div className="notice notice-error">✕ {error}</div>}

          {mapa === null && (
            <p className="panel-desc">Leyendo el catálogo del tenant…</p>
          )}

          {mapa && (
            <>
              <p className="panel-desc">{pista}</p>

              <div className="mdt-grid">
                {tarjetas.map((tarjeta) => (
                  <Tarjeta
                    key={`${tarjeta.grupo}/${tarjeta.papel}`}
                    tarjeta={tarjeta}
                    uno={efectivo[tarjeta.grupo]?.[tarjeta.papel] ?? {}}
                    entidades={mapa.entidades}
                    campos={mapa.campos}
                    onCambiar={cambiar}
                  />
                ))}
              </div>

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
