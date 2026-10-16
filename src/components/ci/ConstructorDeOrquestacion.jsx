// El editor de una orquestación de CI Tools: la paleta de integraciones a la izquierda y la secuencia de pasos a la derecha.
// Es el constructor del orquestador de IBP (`OrchBuilder`): el nombre editable, «Pantalla completa», «▶ Ejecutar», la paleta
// que se ensancha arrastrando su borde, el arrastre para reordenar con su línea de destino y el modo grupo para llenar un
// grupo paralelo.
//
// Cada cambio se guarda SOLO, 800 ms después del último, como en CI-DS e IBP. Dos cambios seguidos se suman en un guardado,
// y el último no se pierde al cambiar de pantalla.
//
// Mientras una orquestación corre no se edita (el motor lee la orquestación en cada vuelta y cambiarla a mitad de una
// ejecución la dejaría apuntando a pasos que ya no están): por eso, con una ejecución en marcha, quien manda es la vista de
// ejecución y este editor ni se monta.

import { useEffect, useMemo, useRef, useState } from 'react'
import { textosDeCambios } from '../../../core/ci/ajustes.js'
import { etiquetaDeIntegracion, infoDeOrquestacion } from '../../lib/ci.js'
import { opcionesDeAjustes } from '../../lib/ci-ajustes.js'
import {
  agregarAGrupo,
  agregarGrupo,
  agregarPaso,
  cambiarHijo,
  cambiarPaso,
  esGrupo,
  grafoDePasos,
  moverHijo,
  moverPaso,
  pasoDeIntegracion,
  pasosDeGrafo,
  quitarHijo,
  quitarPaso,
  reordenar,
  tareasDeLosPasos,
  totalDeIntegraciones,
} from '../../lib/ci-pasos.js'
import { saveOrchestration } from '../../lib/orchestrations.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import AjustesDeLaOrquestacion from './AjustesDeLaOrquestacion.jsx'
import DialogoDeEjecucion from './DialogoDeEjecucion.jsx'
import PaletaDeIntegraciones from './PaletaDeIntegraciones.jsx'
import TarjetaDePaso from './TarjetaDePaso.jsx'

const ESPERA_DE_GUARDADO_MS = 800

/** El ancho de la paleta: el que trae, el mínimo y el máximo a los que se puede arrastrar, y lo que mueve una flecha. */
const ANCHO_DE_LA_PALETA = 240
const ANCHO_MINIMO = 180
const ANCHO_MAXIMO = 520
const PASO_DEL_TECLADO = 16
const limitarAncho = (ancho) => Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, Math.round(ancho)))

const TEXTO_DE_GUARDADO = {
  guardado: '✓ Guardado',
  pendiente: 'Cambios sin guardar…',
  guardando: 'Guardando…',
  error: '✕ No se pudo guardar',
}

/**
 * Qué se manda al servidor: el nombre si cambió, la lista (como grafo) si se puede mostrar como lista, y los ajustes del lote si
 * cambiaron. Un grafo que no tiene forma de lista NO se guarda hasta que alguien lo convierta: guardarlo así lo cambiaría sin que se
 * pidiera.
 */
function cambiosParaGuardar({ nombre, nombreGuardado, pasos, exacto, ajustes, ajustesCambiaron }) {
  const limpio = nombre.trim()
  return {
    ...(limpio !== '' && limpio !== nombreGuardado ? { name: limpio } : {}),
    ...(exacto ? grafoDePasos(pasos) : {}),
    ...(ajustesCambiaron ? { ajustes } : {}),
  }
}

export default function ConstructorDeOrquestacion({
  connection,
  orquestacion,
  integraciones,
  hayEjecucion,
  onVerEjecucion,
  onArrancar,
  onGuardada,
  pantallaCompleta,
  onAlternarPantallaCompleta,
}) {
  // La lista se lee UNA vez, al abrir. Lo que llega después en `orquestacion` es lo que este mismo editor guardó, y volver a
  // leerlo pisaría lo que se está escribiendo.
  const [inicial] = useState(() => pasosDeGrafo(orquestacion))
  const [pasos, setPasos] = useState(inicial.pasos)
  const [exacto, setExacto] = useState(inicial.exacto)
  const [nombre, setNombre] = useState(orquestacion.name)
  const [estadoDeGuardado, setEstadoDeGuardado] = useState('guardado')
  const [errorAlGuardar, setErrorAlGuardar] = useState('')
  const [errorAlPedir, setErrorAlPedir] = useState('')
  const [aEjecutar, setAEjecutar] = useState(null)
  // Los ajustes de TODA la orquestación (otra versión, otras fechas…). Los de cada paso van dentro del paso.
  const [ajustesDelLote, setAjustesDelLote] = useState(() => orquestacion.ajustes ?? {})
  const [grupoActivo, setGrupoActivo] = useState(null)
  const [paletaAbierta, setPaletaAbierta] = useState(false)
  const [anchoPaleta, setAnchoPaleta] = useState(ANCHO_DE_LA_PALETA)
  const [soltarSobre, setSoltarSobre] = useState(null)
  const movil = useIsMobile()

  // Lo último, para quien necesita «lo de ahora» y no «lo de la última vez que se dibujó»: dos cambios en el mismo instante
  // tienen que sumarse, y el estado de React todavía no habría visto el primero.
  const pasosActuales = useRef(inicial.pasos)
  const exactoActual = useRef(inicial.exacto)
  const nombreActual = useRef(orquestacion.name)
  const nombreGuardado = useRef(orquestacion.name)
  const ajustesActuales = useRef(orquestacion.ajustes ?? {})
  const ajustesCambiaron = useRef(false)
  const hayPendiente = useRef(false)
  const temporizador = useRef(null)
  const arrastrado = useRef(null)
  const arrastreDePaleta = useRef(null)

  const porId = new Map(integraciones.map((una) => [una.id, una]))
  const total = totalDeIntegraciones(pasos)
  const opcionesDelLote = useMemo(() => opcionesDeAjustes(integraciones), [integraciones])

  // ── Guardado automático ──────────────────────────────────────────────────────────────────────────

  async function guardar() {
    clearTimeout(temporizador.current)
    const cambios = cambiosParaGuardar({
      nombre: nombreActual.current,
      nombreGuardado: nombreGuardado.current,
      pasos: pasosActuales.current,
      exacto: exactoActual.current,
      ajustes: ajustesActuales.current,
      ajustesCambiaron: ajustesCambiaron.current,
    })
    // Lo pendiente se da por tomado ANTES de esperar: un cambio que llegue mientras se guarda vuelve a marcarlo.
    const huboAjustes = ajustesCambiaron.current
    ajustesCambiaron.current = false
    hayPendiente.current = false
    if (Object.keys(cambios).length === 0) { setEstadoDeGuardado('guardado'); return }

    setEstadoDeGuardado('guardando')
    setErrorAlGuardar('')
    try {
      const guardada = await saveOrchestration(orquestacion.id, cambios)
      nombreGuardado.current = guardada.name
      // La lista de la izquierda guarda su propia copia: si no se entera, al volver a esta orquestación abriría la de antes.
      onGuardada?.(guardada)
      if (!hayPendiente.current) setEstadoDeGuardado('guardado')
    } catch (fallo) {
      hayPendiente.current = true
      if (huboAjustes) ajustesCambiaron.current = true
      setErrorAlGuardar(fallo.message)
      setEstadoDeGuardado('error')
      throw fallo
    }
  }

  function programar() {
    hayPendiente.current = true
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => { guardar().catch(() => {}) }, ESPERA_DE_GUARDADO_MS)
    setEstadoDeGuardado('pendiente')
  }

  /** Guarda ya lo que esté esperando, para que lo que se ejecuta sea lo que se ve. */
  async function guardarAhora() {
    clearTimeout(temporizador.current)
    if (hayPendiente.current) await guardar()
  }

  // Al desmontar se guarda lo pendiente: cambiar de pantalla a medio debounce no debe perder el último cambio.
  useEffect(() => () => {
    clearTimeout(temporizador.current)
    if (!hayPendiente.current) return
    const cambios = cambiosParaGuardar({
      nombre: nombreActual.current,
      nombreGuardado: nombreGuardado.current,
      pasos: pasosActuales.current,
      exacto: exactoActual.current,
      ajustes: ajustesActuales.current,
      ajustesCambiaron: ajustesCambiaron.current,
    })
    if (Object.keys(cambios).length > 0) {
      saveOrchestration(orquestacion.id, cambios).then((guardada) => onGuardada?.(guardada)).catch(() => {})
    }
  }, [orquestacion.id, onGuardada])

  /** Aplica un cambio a la lista y programa el guardado. */
  function cambiar(hacer) {
    const siguientes = hacer(pasosActuales.current)
    pasosActuales.current = siguientes
    setPasos(siguientes)
    programar()
  }

  /** Cambia los ajustes de TODA la orquestación y programa el guardado. */
  function cambiarAjustesDelLote(ajustes) {
    ajustesActuales.current = ajustes
    ajustesCambiaron.current = true
    setAjustesDelLote(ajustes)
    programar()
  }

  function cambiarNombre(valor) {
    nombreActual.current = valor
    setNombre(valor)
    programar()
  }

  /** Al salir del campo, un nombre vacío vuelve al anterior: una orquestación sin nombre no se puede distinguir de las demás. */
  function terminarNombre() {
    if (nombreActual.current.trim() !== '') return
    nombreActual.current = nombreGuardado.current
    setNombre(nombreGuardado.current)
  }

  // ── La lista ─────────────────────────────────────────────────────────────────────────────────────

  function agregar(integracion) {
    const nuevo = pasoDeIntegracion(integracion)
    if (grupoActivo) {
      cambiar((previos) => agregarAGrupo(previos, grupoActivo, nuevo))
    } else {
      cambiar((previos) => agregarPaso(previos, nuevo))
      setPaletaAbierta(false)
    }
  }

  function agregarUnGrupo() {
    cambiar((previos) => agregarGrupo(previos))
    if (movil) setPaletaAbierta(false)
  }

  function quitar(id) {
    cambiar((previos) => quitarPaso(previos, id))
    if (grupoActivo === id) setGrupoActivo(null)
  }

  function cerrarPaleta() {
    setPaletaAbierta(false)
    setGrupoActivo(null)
  }

  function convertirALista() {
    if (!window.confirm('Las dependencias de esta orquestación no se pueden mostrar como una lista. Se guardará como lista, en el orden '
      + 'en que corren sus pasos, y algunas esperas entre pasos pueden cambiar. ¿Continuar?')) return
    exactoActual.current = true
    setExacto(true)
    programar()
  }

  // ── Arrastrar para reordenar ─────────────────────────────────────────────────────────────────────

  function arrastrar(evento, id) {
    arrastrado.current = id
    if (evento.dataTransfer) {
      evento.dataTransfer.effectAllowed = 'move'
      // Firefox no empieza un arrastre si no se le da algo que llevar.
      evento.dataTransfer.setData?.('text/plain', id)
    }
  }

  /** ¿Se suelta en la mitad de arriba o en la de abajo de la tarjeta? */
  const mitadDe = (evento) => {
    const caja = evento.currentTarget.getBoundingClientRect()
    return evento.clientY - caja.top < caja.height / 2 ? 'top' : 'bottom'
  }

  function pasarPor(evento, idSobre) {
    evento.preventDefault()
    if (!arrastrado.current || arrastrado.current === idSobre) { setSoltarSobre(null); return }
    setSoltarSobre({ id: idSobre, posicion: mitadDe(evento) })
  }

  function soltar(evento, idSobre) {
    evento.preventDefault()
    const desde = arrastrado.current
    arrastrado.current = null
    setSoltarSobre(null)
    if (!desde || desde === idSobre) return
    const posicion = mitadDe(evento)
    cambiar((previos) => reordenar(previos, desde, idSobre, posicion))
  }

  // ── El borde de la paleta, que se arrastra ───────────────────────────────────────────────────────
  // Se agarra con el puntero (queda «capturado», así que seguir el movimiento no depende de que el cursor se quede encima) o
  // se mueve con las flechas; doble clic vuelve al ancho original.

  function empezarArrastreDePaleta(evento) {
    arrastreDePaleta.current = { x: evento.clientX, ancho: anchoPaleta }
    evento.currentTarget.setPointerCapture?.(evento.pointerId)
  }
  function seguirArrastreDePaleta(evento) {
    if (arrastreDePaleta.current) setAnchoPaleta(limitarAncho(arrastreDePaleta.current.ancho + evento.clientX - arrastreDePaleta.current.x))
  }
  const soltarArrastreDePaleta = () => { arrastreDePaleta.current = null }
  function moverPaletaConTeclado(evento) {
    const paso = evento.shiftKey ? PASO_DEL_TECLADO * 3 : PASO_DEL_TECLADO
    if (evento.key === 'ArrowLeft') setAnchoPaleta((ancho) => limitarAncho(ancho - paso))
    else if (evento.key === 'ArrowRight') setAnchoPaleta((ancho) => limitarAncho(ancho + paso))
    else if (evento.key === 'Home') setAnchoPaleta(ANCHO_DE_LA_PALETA)
    else return
    evento.preventDefault()
  }

  // ── Ejecutar ─────────────────────────────────────────────────────────────────────────────────────

  async function pedirEjecucion() {
    setErrorAlPedir('')
    try {
      await guardarAhora()
      const info = await infoDeOrquestacion(orquestacion.id)
      if (info.pasos.length === 0) throw new Error('La orquestación no tiene ninguna integración.')
      if (info.rotos.length > 0) {
        const nombres = info.pasos.filter((paso) => info.rotos.includes(paso.nodeId)).map((paso) => `«${paso.label}»`)
        throw new Error(`${nombres.join(', ')} apunta a una integración que ya no existe en esta conexión. Quítalo o cámbialo.`)
      }

      // En el orden en que se ejecutarán, con el número de paso de cada una: lo que se va a lanzar es lo que se ve.
      const porNodo = new Map(info.pasos.map((paso) => [paso.nodeId, paso]))
      const aLanzar = (tarea, numero, paralelo) => {
        const dato = porNodo.get(tarea.id)
        return {
          nombre: dato?.integracion ? etiquetaDeIntegracion(dato.integracion) : (dato?.label ?? tarea.label),
          // El comando es el que se enviará (con los ajustes), y lo que cambió va debajo.
          comando: dato?.efectivo?.comando ?? dato?.integracion?.resumen?.comando ?? '',
          cambios: textosDeCambios(dato?.cambios ?? []),
          paso: numero,
          paralelo,
        }
      }
      // Lo que cambian los ajustes sale de lo que dice el servidor (es lo que se enviará): REPLACE merece una segunda mirada.
      const conReplace = info.pasos.filter((paso) => (paso.cambios ?? []).some((c) => c.clave === 'comando' && c.a === 'REPLACE')).length
      const advertencias = [
        ...(conReplace > 0
          ? [`REPLACE puede reemplazar los datos que ya hay: los ajustes lo ponen en ${conReplace === 1 ? '1 paso' : `${conReplace} pasos`} que antes cargaban con otro comando.`]
          : []),
        ...info.pasos.flatMap((paso) => (paso.avisos ?? []).map((aviso) => `«${paso.label}»: ${aviso}`)),
      ]
      setAEjecutar({
        advertencias,
        variables: info.variables,
        variablesDeFecha: info.variablesDeFecha ?? [],
        iniciales: info.ultimas,
        integraciones: pasosActuales.current.flatMap((paso, i) => (
          esGrupo(paso) ? (paso.children ?? []).map((hijo) => aLanzar(hijo, i + 1, true)) : [aLanzar(paso, i + 1, false)]
        )),
      })
    } catch (fallo) {
      setErrorAlPedir(fallo.message)
    }
  }

  const paleta = (
    <PaletaDeIntegraciones
      integraciones={integraciones}
      onAgregar={agregar}
      onAgregarGrupo={agregarUnGrupo}
      grupoActivo={grupoActivo}
      onCancelarGrupo={cerrarPaleta}
    />
  )

  const alertas = errorAlGuardar || errorAlPedir

  return (
    <div className="ci-orq-constructor">
      {/* Fondo del cajón del teléfono */}
      {movil && paletaAbierta && <div className="ci-orq-fondo" onClick={cerrarPaleta} />}

      {/* La paleta del escritorio, con el borde para cambiar su ancho */}
      {!movil && (
        <>
          <div className="ci-orq-paleta-caja" style={{ width: anchoPaleta }} inert={!exacto}>{paleta}</div>
          <div
            className="ci-orq-ancho"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar el ancho de la paleta"
            aria-valuenow={anchoPaleta}
            aria-valuemin={ANCHO_MINIMO}
            aria-valuemax={ANCHO_MAXIMO}
            tabIndex={0}
            title="Arrastra para ajustar el ancho. Doble clic para volver al original."
            onPointerDown={empezarArrastreDePaleta}
            onPointerMove={seguirArrastreDePaleta}
            onPointerUp={soltarArrastreDePaleta}
            onPointerCancel={soltarArrastreDePaleta}
            onDoubleClick={() => setAnchoPaleta(ANCHO_DE_LA_PALETA)}
            onKeyDown={moverPaletaConTeclado}
          />
        </>
      )}

      {/* El cajón del teléfono */}
      {movil && paletaAbierta && <div className="ci-orq-cajon">{paleta}</div>}

      <div className="ci-orq-editor">
        <div className="ci-orq-cabeza">
          <input
            className="input ci-orq-nombre"
            value={nombre}
            placeholder="Nombre de la orquestación…"
            aria-label="Nombre de la orquestación"
            onChange={(evento) => cambiarNombre(evento.target.value)}
            onBlur={terminarNombre}
          />
          <span className={`ci-guardado ci-guardado-${estadoDeGuardado}`} role="status">{TEXTO_DE_GUARDADO[estadoDeGuardado]}</span>
          {/* Los botones se mueven juntos: con poco ancho pasan a una segunda fila, a la derecha, y no se parten. */}
          <div className="ci-orq-acciones">
            {hayEjecucion && (
              <button type="button" className="ci-orq-boton" onClick={onVerEjecucion}>Última ejecución</button>
            )}
            {onAlternarPantallaCompleta && (
              <button
                type="button"
                className={`ci-orq-boton${pantallaCompleta ? ' activo' : ''}`}
                onClick={onAlternarPantallaCompleta}
                title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              </button>
            )}
            <button
              type="button"
              className="ci-orq-ejecutar"
              onClick={pedirEjecucion}
              disabled={total === 0 || !exacto || estadoDeGuardado === 'guardando'}
              title={total === 0 ? 'Agrega al menos una integración para ejecutar' : 'Ejecutar orquestación'}
            >
              ▶ Ejecutar
            </button>
          </div>
        </div>

        {alertas && <div className="notice notice-error" role="alert">✕ {alertas}</div>}

        {/* Un grafo que no es una lista: se avisa qué se muestra, y no se edita ni se ejecuta hasta convertirlo. */}
        {!exacto && (
          <div className="ci-orq-aviso" role="alert">
            Las dependencias de esta orquestación no se pueden mostrar como una lista (no se armó en este editor). Se muestra en el
            orden en que corren sus pasos, pero no se puede editar ni ejecutar con seguridad hasta convertirla.
            <div><button type="button" className="btn btn-sm" onClick={convertirALista}>Convertir a lista</button></div>
          </div>
        )}

        {/* `inert`: con un grafo que no es una lista se ve, pero no se toca. */}
        <div className="ci-orq-secuencia" inert={!exacto}>
          <AjustesDeLaOrquestacion
            ajustes={ajustesDelLote}
            onCambiar={cambiarAjustesDelLote}
            tareas={tareasDeLosPasos(pasos)}
            porId={porId}
            opciones={opcionesDelLote}
          />

          {pasos.length === 0 && (
            <div className="ci-orq-sin-pasos">
              <div className="ci-orq-sin-pasos-icono">⊞</div>
              <div>Sin pasos configurados.</div>
              <div className="card-hint">Selecciona una integración desde el panel izquierdo<br />para agregarla a la secuencia.</div>
            </div>
          )}

          {pasos.map((paso, i) => (
            <TarjetaDePaso
              key={paso.id}
              paso={paso}
              indice={i}
              total={pasos.length}
              porId={porId}
              ajustesDelLote={ajustesDelLote}
              opcionesDeAjustes={opcionesDelLote}
              esGrupoActivo={grupoActivo === paso.id}
              onQuitar={() => quitar(paso.id)}
              onSubir={() => cambiar((previos) => moverPaso(previos, paso.id, -1))}
              onBajar={() => cambiar((previos) => moverPaso(previos, paso.id, 1))}
              onCambiar={(cambios) => cambiar((previos) => cambiarPaso(previos, paso.id, cambios))}
              onAgregarAlGrupo={() => { setGrupoActivo(paso.id); setPaletaAbierta(true) }}
              onQuitarHijo={(idDeHijo) => cambiar((previos) => quitarHijo(previos, paso.id, idDeHijo))}
              onCambiarHijo={(idDeHijo, cambios) => cambiar((previos) => cambiarHijo(previos, paso.id, idDeHijo, cambios))}
              onSubirHijo={(idDeHijo) => cambiar((previos) => moverHijo(previos, paso.id, idDeHijo, -1))}
              onBajarHijo={(idDeHijo) => cambiar((previos) => moverHijo(previos, paso.id, idDeHijo, 1))}
              alSoltarSobre={soltarSobre?.id === paso.id}
              posicionDeSoltado={soltarSobre?.id === paso.id ? soltarSobre.posicion : null}
              onArrastrar={arrastrar}
              onPasarPor={pasarPor}
              onSalirDe={() => setSoltarSobre(null)}
              onSoltar={soltar}
            />
          ))}
        </div>
      </div>

      {/* Botón flotante del teléfono */}
      {movil && (
        <button type="button" className="ci-orq-fab" aria-label="Agregar una integración" onClick={() => { setGrupoActivo(null); setPaletaAbierta(true) }}>+</button>
      )}

      {aEjecutar && (
        <DialogoDeEjecucion
          titulo={`Ejecutar «${orquestacion.name}»`}
          conexion={connection}
          integraciones={aEjecutar.integraciones}
          variables={aEjecutar.variables}
          variablesDeFecha={aEjecutar.variablesDeFecha}
          iniciales={aEjecutar.iniciales}
          advertencias={aEjecutar.advertencias}
          esOrquestacion
          onEjecutar={onArrancar}
          onCerrar={() => setAEjecutar(null)}
        />
      )}
    </div>
  )
}
