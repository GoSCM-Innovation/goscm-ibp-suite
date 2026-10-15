// La biblioteca de integraciones de una conexión: el árbol de carpetas a la izquierda y el editor a la derecha.
//
// Es lo que reemplaza a la colección de Postman: las mismas carpetas, las mismas peticiones (una por
// integración), pero guardadas en el servidor, compartidas por todo el equipo y ejecutables desde aquí.
//
// Una integración se ejecuta con lo GUARDADO, y antes de pedir confirmación se leen los valores con que se
// ejecutó la última vez, para proponerlos en el diálogo.
//
// El árbol se puede ordenar de dos maneras: por carpeta (como una colección de Postman) o por destino, es decir, por la
// tabla de dato maestro o la cifra clave a la que carga cada integración.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plantillaDeBody, BLOQUE_POR_TIPO } from '../../../core/ci/campos.js'
import { resumenDeBody } from '../../../core/ci/body.js'
import {
  arbolDeCarpetas,
  arbolPorDestino,
  borrarIntegracion,
  carpetasExistentes,
  crearIntegracion,
  duplicarIntegracion,
  ejecutarIntegracion,
  getIntegracion,
  guardarIntegracion,
  listIntegraciones,
  opcionesDeCarpeta,
  renombrarCarpeta,
  TEXTOS_DE_CARPETA,
  ultimasVariablesDeIntegracion,
} from '../../lib/ci.js'
import BotonActualizar from '../ui/BotonActualizar.jsx'
import Modal from '../ui/Modal.jsx'
import CampoConLista from './CampoConLista.jsx'
import DialogoDeEjecucion from './DialogoDeEjecucion.jsx'
import EditorDeIntegracion from './EditorDeIntegracion.jsx'
import { useCatalogoIbp } from './useCatalogoIbp.js'

const PREGUNTA_DESCARTAR = 'Hay cambios sin guardar. ¿Descartarlos?'

/** El ancho del árbol: el que trae, el mínimo y el máximo a los que se puede arrastrar, y lo que mueve una flecha. */
const ANCHO_DEL_ARBOL = 360
const ANCHO_MINIMO = 220
const ANCHO_MAXIMO = 560
const PASO_DEL_TECLADO = 16
const limitarAncho = (ancho) => Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, Math.round(ancho)))

/**
 * Una integración en el árbol. LO IMPORTANTE ES EL NOMBRE: ocupa todo el ancho de la fila y no se lo comen ni el comando ni
 * la carpeta (los nombres de las integraciones son largos y se parecen). Lo secundario, solo donde hace falta: en la vista por
 * destino, una segunda línea pequeña con la carpeta (ya no es lo que agrupa) y el comando. En la vista por carpeta, nada más
 * que el nombre; el comando está en el cuadro que sale al pasar el cursor y en el editor.
 */
function FilaDeIntegracion({ una, nivel, elegida, onElegir, conCarpeta = false }) {
  const comando = una.resumen?.valido ? una.resumen.comando : ''
  const secundario = conCarpeta ? [una.folder, comando].filter(Boolean).join(' · ') : ''
  return (
    <button
      type="button"
      className={`ci-arbol-fila ci-arbol-integracion${elegida === una.id ? ' active' : ''}`}
      style={{ paddingLeft: 18 + nivel * 10 }}
      onClick={() => onElegir(una.id)}
      // El nombre completo, porque en la lista puede cortarse; y debajo qué es.
      title={`${una.name}\n${una.resumen?.valido ? `${una.resumen.tipo} · ${una.resumen.comando}` : una.resumen?.error}`}
    >
      <span className="ci-arbol-texto">
        <span className="ci-arbol-nombre">{una.name}</span>
        {secundario && <span className="ci-arbol-sub">{secundario}</span>}
      </span>
      {!una.resumen?.valido && <span className="ci-arbol-alerta" title={una.resumen?.error}>!</span>}
    </button>
  )
}

/**
 * El árbol por destino: un grupo de tablas de dato maestro, uno de cifras clave y, si hace falta, uno sin destino. Cada
 * tabla o cifra es un nodo que se abre para ver las integraciones que cargan a ella.
 */
function ArbolPorDestino({ arbol, abiertos, alternar, elegida, onElegir, forzarAbierto }) {
  return (
    <>
      {arbol.grupos.map((grupo) => (
        <div key={grupo.id}>
          <div className="ci-arbol-grupo">{grupo.titulo}</div>
          {/* Sin destino no hay nodos: las integraciones cuelgan directamente del grupo. */}
          {grupo.id === 'sin'
            ? grupo.destinos.flatMap((uno) => uno.integraciones).map((una) => (
              <FilaDeIntegracion key={una.id} una={una} nivel={0} elegida={elegida} onElegir={onElegir} conCarpeta />
            ))
            : grupo.destinos.map((uno) => {
              const clave = `${grupo.id}:${uno.destino}`
              const abierto = forzarAbierto || abiertos.has(clave)
              return (
                <div key={clave}>
                  <div className="ci-arbol-carpeta" style={{ paddingLeft: 8 }}>
                    <button type="button" className="ci-arbol-fila" onClick={() => alternar(clave)} aria-expanded={abierto}>
                      <span className="ci-arbol-flecha" aria-hidden="true">{abierto ? '▾' : '▸'}</span>
                      <span className="ci-arbol-nombre">{uno.destino}</span>
                      <span className="ci-arbol-cuenta">{uno.integraciones.length}</span>
                    </button>
                  </div>
                  {abierto && uno.integraciones.map((una) => (
                    <FilaDeIntegracion key={una.id} una={una} nivel={1} elegida={elegida} onElegir={onElegir} conCarpeta />
                  ))}
                </div>
              )
            })}
        </div>
      ))}
    </>
  )
}

/** Una carpeta del árbol y todo lo que cuelga de ella. */
function Carpeta({ nodo, nivel, abiertas, alternar, elegida, onElegir, onRenombrar, forzarAbierta }) {
  const abierta = forzarAbierta || abiertas.has(nodo.ruta)
  return (
    <div>
      <div className="ci-arbol-carpeta" style={{ paddingLeft: 8 + nivel * 14 }}>
        <button type="button" className="ci-arbol-fila" onClick={() => alternar(nodo.ruta)} aria-expanded={abierta}>
          <span className="ci-arbol-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
          <span aria-hidden="true">📁</span>
          <span className="ci-arbol-nombre">{nodo.nombre}</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm ci-arbol-renombrar"
          onClick={() => onRenombrar(nodo.ruta)}
          title="Renombrar la carpeta"
          aria-label={`Renombrar la carpeta ${nodo.nombre}`}
        >
          ✎
        </button>
      </div>
      {abierta && <Contenido nodo={nodo} nivel={nivel + 1} abiertas={abiertas} alternar={alternar} elegida={elegida} onElegir={onElegir} onRenombrar={onRenombrar} forzarAbierta={forzarAbierta} />}
    </div>
  )
}

function Contenido({ nodo, nivel, abiertas, alternar, elegida, onElegir, onRenombrar, forzarAbierta }) {
  return (
    <>
      {nodo.carpetas.map((hija) => (
        <Carpeta
          key={hija.ruta}
          nodo={hija}
          nivel={nivel}
          abiertas={abiertas}
          alternar={alternar}
          elegida={elegida}
          onElegir={onElegir}
          onRenombrar={onRenombrar}
          forzarAbierta={forzarAbierta}
        />
      ))}
      {nodo.integraciones.map((una) => (
        <FilaDeIntegracion key={una.id} una={una} nivel={nivel} elegida={elegida} onElegir={onElegir} />
      ))}
    </>
  )
}

export default function Integraciones({ connection }) {
  const [lista, setLista] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [abiertas, setAbiertas] = useState(() => new Set())
  // Cómo se ordena el árbol y qué destinos están abiertos. Solo en memoria: al recargar vuelve a «Carpeta».
  const [vista, setVista] = useState('carpeta')
  // El ancho del árbol, que se arrastra desde su borde. Solo en memoria, como la vista.
  const [anchoArbol, setAnchoArbol] = useState(ANCHO_DEL_ARBOL)
  const arrastre = useRef(null)
  const [destinosAbiertos, setDestinosAbiertos] = useState(() => new Set())
  const [elegidaId, setElegidaId] = useState(null)
  const [abierta, setAbierta] = useState(null)
  const [sinGuardar, setSinGuardar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [errorAlGuardar, setErrorAlGuardar] = useState('')
  const [nueva, setNueva] = useState(null)
  const [aEjecutar, setAEjecutar] = useState(null)

  // Lo que IBP dice de su sistema (áreas, versiones, tablas), leído una vez por conexión y compartido por todas las
  // integraciones que se abran, para no pedirlo al cambiar de una a otra.
  const catalogo = useCatalogoIbp(connection)

  // Cada vez que cambia `version` se vuelve a leer la lista. El efecto solo lanza la petición: el estado se toca
  // al volver la respuesta, que es lo que pide la regla de efectos de React.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let vivo = true
    listIntegraciones(connection.id)
      .then((integ) => { if (vivo) { setLista(integ); setError('') } })
      .catch((fallo) => { if (vivo) { setError(fallo.message); setLista((previa) => previa ?? []) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [connection.id, version])

  const recargar = useCallback(() => {
    setCargando(true)
    setVersion((v) => v + 1)
  }, [])

  const integraciones = useMemo(() => lista ?? [], [lista])
  const arbol = useMemo(() => arbolDeCarpetas(integraciones, filtro), [integraciones, filtro])
  const porDestino = useMemo(() => arbolPorDestino(integraciones, filtro), [integraciones, filtro])
  const carpetas = useMemo(() => carpetasExistentes(integraciones), [integraciones])
  // Los niveles de tiempo que ya usan las integraciones de esta conexión: se sugieren al escribir uno nuevo.
  const nivelesDeTiempo = useMemo(
    () => [...new Set(integraciones.map((una) => una.resumen?.nivelDeTiempo).filter(Boolean))].sort(),
    [integraciones],
  )

  const confirmarDescarte = () => !sinGuardar || window.confirm(PREGUNTA_DESCARTAR)

  function alternar(ruta) {
    setAbiertas((previas) => {
      const siguientes = new Set(previas)
      if (siguientes.has(ruta)) siguientes.delete(ruta)
      else siguientes.add(ruta)
      return siguientes
    })
  }

  // El borde del árbol se agarra con el puntero (queda «capturado», así que seguir el movimiento no depende de que el
  // cursor se quede encima) o se mueve con las flechas; doble clic vuelve al ancho original.
  function empezarArrastre(evento) {
    arrastre.current = { x: evento.clientX, ancho: anchoArbol }
    evento.currentTarget.setPointerCapture?.(evento.pointerId)
  }
  function seguirArrastre(evento) {
    if (arrastre.current) setAnchoArbol(limitarAncho(arrastre.current.ancho + evento.clientX - arrastre.current.x))
  }
  function soltarArrastre() { arrastre.current = null }
  function moverConTeclado(evento) {
    const paso = evento.shiftKey ? PASO_DEL_TECLADO * 3 : PASO_DEL_TECLADO
    if (evento.key === 'ArrowLeft') setAnchoArbol((a) => limitarAncho(a - paso))
    else if (evento.key === 'ArrowRight') setAnchoArbol((a) => limitarAncho(a + paso))
    else if (evento.key === 'Home') setAnchoArbol(ANCHO_DEL_ARBOL)
    else return
    evento.preventDefault()
  }

  function alternarDestino(clave) {
    setDestinosAbiertos((previos) => {
      const siguientes = new Set(previos)
      if (siguientes.has(clave)) siguientes.delete(clave)
      else siguientes.add(clave)
      return siguientes
    })
  }

  /** Abre una integración: se vuelve a leer entera (la lista no trae el body). */
  async function elegir(id) {
    if (id === elegidaId) return
    if (!confirmarDescarte()) return
    setSinGuardar(false)
    setErrorAlGuardar('')
    setElegidaId(id)
    setAbierta(null)
    try {
      setAbierta(await getIntegracion(id))
    } catch (fallo) {
      setError(fallo.message)
      setElegidaId(null)
    }
  }

  /** Refleja en la lista lo que cambió en una integración, sin volver a pedirlas todas. */
  const reflejar = (guardada) => setLista((previa) => {
    const resumen = { ...guardada, resumen: resumenDeBody(guardada.body) }
    delete resumen.body
    const resto = (previa ?? []).filter((una) => una.id !== guardada.id)
    return [...resto, resumen]
  })

  async function guardar(cambios) {
    setGuardando(true)
    setErrorAlGuardar('')
    try {
      const guardada = await guardarIntegracion(abierta.id, cambios)
      setAbierta(guardada)
      reflejar(guardada)
    } catch (fallo) {
      setErrorAlGuardar(fallo.message)
    } finally {
      setGuardando(false)
    }
  }

  async function duplicar() {
    try {
      const copia = await duplicarIntegracion(abierta.id)
      reflejar(copia)
      setAbierta(copia)
      setElegidaId(copia.id)
      setSinGuardar(false)
    } catch (fallo) {
      setErrorAlGuardar(fallo.message)
    }
  }

  async function borrar() {
    if (!window.confirm(`¿Eliminar «${abierta.name}»? No se puede deshacer.`)) return
    try {
      await borrarIntegracion(abierta.id)
      setLista((previa) => (previa ?? []).filter((una) => una.id !== abierta.id))
      setAbierta(null)
      setElegidaId(null)
      setSinGuardar(false)
    } catch (fallo) {
      // Lo más probable: una orquestación la usa. El mensaje dice cuál.
      setErrorAlGuardar(fallo.message)
    }
  }

  async function renombrarUnaCarpeta(ruta) {
    const nuevoNombre = window.prompt(`Nuevo nombre de la carpeta «${ruta}» (con «/» para anidarla):`, ruta)?.trim()
    if (!nuevoNombre || nuevoNombre === ruta) return
    if (!confirmarDescarte()) return
    try {
      await renombrarCarpeta(connection.id, ruta, nuevoNombre)
      setSinGuardar(false)
      setAbierta(null)
      setElegidaId(null)
      recargar()
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function crear({ nombre, carpeta, tipo }) {
    const creada = await crearIntegracion({
      connectionId: connection.id, folder: carpeta, name: nombre, body: plantillaDeBody(tipo),
    })
    reflejar(creada)
    setNueva(null)
    setSinGuardar(false)
    setAbierta(creada)
    setElegidaId(creada.id)
    // La carpeta donde cayó se deja abierta para que se vea.
    setAbiertas((previas) => {
      const siguientes = new Set(previas)
      let acumulada = ''
      for (const tramo of creada.folder.split('/').filter(Boolean)) {
        acumulada = acumulada ? `${acumulada}/${tramo}` : tramo
        siguientes.add(acumulada)
      }
      return siguientes
    })
  }

  /** Prepara el diálogo: lee los valores de la última vez y dice qué se va a ejecutar. */
  async function pedirEjecucion(avisosIbp = []) {
    let iniciales = {}
    try {
      iniciales = await ultimasVariablesDeIntegracion(abierta.id)
    } catch {
      // Sin los valores de la vez anterior se escriben de cero: no impide ejecutar.
    }
    const resumen = resumenDeBody(abierta.body)
    setAEjecutar({
      avisos: avisosIbp,
      iniciales,
      variables: resumen.valido ? resumen.variables : [],
      variablesDeFecha: resumen.valido ? resumen.variablesDeFecha : [],
      integraciones: [{ nombre: abierta.name, comando: resumen.valido ? resumen.comando : '' }],
    })
  }

  if (lista === null) return <div className="page-hint ci-cargando">Cargando integraciones…</div>

  return (
    <div className="ci-biblioteca" style={{ '--ancho-arbol': `${anchoArbol}px` }}>
      <aside className="ci-arbol" aria-label="Integraciones">
        <div className="ci-arbol-cabeza">
          <span className="filtro-titulo">Integraciones</span>
          <div className="ci-arbol-botones">
            <BotonActualizar className="btn btn-ghost btn-sm" etiqueta="" title="Actualizar la lista" onClick={recargar} cargando={cargando} />
            <button
              type="button"
              className="btn btn-ghost btn-sm ci-nueva-boton"
              onClick={() => { if (confirmarDescarte()) setNueva({ carpeta: '' }) }}
              title="Nueva integración"
            >
              +
            </button>
          </div>
        </div>
        <div className="ci-arbol-vista" role="group" aria-label="Ordenar las integraciones">
          <span className="card-hint">Ordenar por</span>
          {[['carpeta', 'Carpeta', 'Como una colección de Postman'], ['destino', 'Destino', 'Por la tabla de dato maestro o la cifra clave a la que carga']].map(([id, etiqueta, ayuda]) => (
            <button
              key={id}
              type="button"
              className={`ci-arbol-vista-boton${vista === id ? ' active' : ''}`}
              aria-pressed={vista === id}
              title={ayuda}
              onClick={() => setVista(id)}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <div className="ci-arbol-buscar">
          <input
            className="input input-sm"
            type="search"
            placeholder="Buscar…"
            title="Busca por nombre, carpeta, lote, área o destino"
            value={filtro}
            aria-label="Buscar integraciones"
            onChange={(evento) => setFiltro(evento.target.value)}
          />
        </div>
        <div className="ci-arbol-cuerpo">
          {integraciones.length === 0 && (
            <div className="ci-vacio">
              Todavía no hay integraciones.<br />
              <button type="button" className="ci-enlace" onClick={() => setNueva({ carpeta: '' })}>Crea la primera</button>
            </div>
          )}
          {integraciones.length > 0 && (vista === 'destino' ? porDestino.grupos.length === 0 : arbol.carpetas.length === 0 && arbol.integraciones.length === 0) && (
            <div className="ci-vacio">Ninguna integración coincide con «{filtro}».</div>
          )}
          {vista === 'destino' ? (
            <ArbolPorDestino
              arbol={porDestino}
              abiertos={destinosAbiertos}
              alternar={alternarDestino}
              elegida={elegidaId}
              onElegir={elegir}
              forzarAbierto={filtro.trim() !== ''}
            />
          ) : (
            <Contenido
              nodo={arbol}
              nivel={0}
              abiertas={abiertas}
              alternar={alternar}
              elegida={elegidaId}
              onElegir={elegir}
              onRenombrar={renombrarUnaCarpeta}
              forzarAbierta={filtro.trim() !== ''}
            />
          )}
        </div>
      </aside>

      <div
        className="ci-divisor"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar el ancho de la lista"
        aria-valuenow={anchoArbol}
        aria-valuemin={ANCHO_MINIMO}
        aria-valuemax={ANCHO_MAXIMO}
        tabIndex={0}
        title="Arrastra para ajustar el ancho de la lista. Doble clic para volver al original."
        onPointerDown={empezarArrastre}
        onPointerMove={seguirArrastre}
        onPointerUp={soltarArrastre}
        onPointerCancel={soltarArrastre}
        onDoubleClick={() => setAnchoArbol(ANCHO_DEL_ARBOL)}
        onKeyDown={moverConTeclado}
      />

      <section className="ci-biblioteca-cuerpo">
        {error && <div className="notice notice-error" role="alert">✕ {error}</div>}
        {abierta ? (
          <EditorDeIntegracion
            key={abierta.id}
            integracion={abierta}
            carpetas={carpetas}
            catalogo={catalogo}
            nivelesDeTiempo={nivelesDeTiempo}
            guardando={guardando}
            error={errorAlGuardar}
            onGuardar={guardar}
            onDuplicar={duplicar}
            onBorrar={borrar}
            onEjecutar={pedirEjecucion}
            onSinGuardar={setSinGuardar}
          />
        ) : (
          <div className="ci-sin-seleccion">
            <div>
              <div className="ci-sin-seleccion-icono">🔗</div>
              {elegidaId ? 'Cargando…' : 'Elige una integración o crea una nueva'}
            </div>
          </div>
        )}
      </section>

      {nueva && (
        <NuevaIntegracion
          carpetaInicial={nueva.carpeta}
          carpetas={carpetas}
          onCrear={crear}
          onCerrar={() => setNueva(null)}
        />
      )}

      {aEjecutar && (
        <DialogoDeEjecucion
          titulo={`Ejecutar «${abierta?.name}»`}
          conexion={connection}
          integraciones={aEjecutar.integraciones}
          variables={aEjecutar.variables}
          variablesDeFecha={aEjecutar.variablesDeFecha}
          iniciales={aEjecutar.iniciales}
          avisos={aEjecutar.avisos}
          onEjecutar={(variables) => ejecutarIntegracion({ connectionId: connection.id, integrationId: abierta.id, variables })}
          onCerrar={() => setAEjecutar(null)}
        />
      )}
    </div>
  )
}

/** El diálogo de «Nueva integración»: nombre, carpeta y tipo. El body empieza con lo que se repite en todos. */
function NuevaIntegracion({ carpetaInicial, carpetas, onCrear, onCerrar }) {
  const [nombre, setNombre] = useState('')
  const [carpeta, setCarpeta] = useState(carpetaInicial)
  const [tipo, setTipo] = useState('MASTERDATA')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function enviar(evento) {
    evento.preventDefault()
    setOcupado(true)
    setError('')
    try {
      await onCrear({ nombre, carpeta, tipo })
    } catch (fallo) {
      setError(fallo.message)
      setOcupado(false)
    }
  }

  return (
    <Modal
      title="Nueva integración"
      onClose={onCerrar}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="submit" form="ci-nueva" className="btn btn-primary" disabled={ocupado || nombre.trim() === ''}>
            {ocupado ? 'Creando…' : 'Crear'}
          </button>
        </>
      )}
    >
      <form id="ci-nueva" className="ci-nueva" onSubmit={enviar}>
        <div className="field">
          <label htmlFor="ci-nueva-nombre">Nombre</label>
          <input id="ci-nueva-nombre" className="input" value={nombre} autoFocus onChange={(evento) => setNombre(evento.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ci-nueva-carpeta">Carpeta</label>
          <CampoConLista
            id="ci-nueva-carpeta"
            valor={carpeta}
            opciones={opcionesDeCarpeta(carpetas)}
            textos={TEXTOS_DE_CARPETA}
            titulo="Carpeta"
            onCambiar={setCarpeta}
          />
          <span className="card-hint">Elige una existente, o «Carpeta nueva» para escribirla. Con «/» se anidan: STARBRANDS/Maestros.</span>
        </div>
        <div className="field">
          <span className="ci-etiqueta">Tipo de dato</span>
          <div className="ci-opciones">
            {[['MASTERDATA', 'Dato maestro'], ['KEYFIGURES', 'Cifras clave']].map(([valor, etiqueta]) => (
              <label key={valor} className="ci-opcion">
                <input type="radio" name="ci-tipo-nuevo" checked={tipo === valor} onChange={() => setTipo(valor)} />
                {etiqueta} <span className="card-hint mono">({BLOQUE_POR_TIPO[valor]})</span>
              </label>
            ))}
          </div>
          <span className="card-hint">Empieza con los valores que se repiten en todos los bodies; el resto se llena en el formulario.</span>
        </div>
        {error && <div className="notice notice-error" role="alert">✕ {error}</div>}
      </form>
    </Modal>
  )
}
