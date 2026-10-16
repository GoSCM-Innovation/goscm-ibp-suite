// Una tarjeta de la secuencia: un paso (una integración) o un grupo paralelo con las suyas. Es la tarjeta del orquestador de
// IBP (`StepCard`): el asa ⠿ para arrastrar, el número, «Si falla…», ↑ ↓ ✕ y el grupo morado plegable con
// «+ Agregar integración al grupo».
//
// Cada integración lleva su «⚙ Ajustes» (plegado): lo que esta orquestación cambia de ESA integración (versión, comando, origen, destino,
// fechas y valores del filtro). La línea de debajo del nombre dice lo que se enviaría CON los ajustes, y se marca si cambia algo.
//
// No sabe guardar nada: cada cambio sube por una función y quien la recibe arma la lista nueva.

import { useState } from 'react'
import { resolverAjustes, textosDeCambios } from '../../../core/ci/ajustes.js'
import { detalleDeIntegracion } from '../../lib/ci.js'
import { integracionConAjustes } from '../../lib/ci-ajustes.js'
import { ESPERA_MAXIMA_S, ESPERA_MINIMA_S, ESPERA_POR_OMISION_S, REINTENTOS_MAXIMOS, esGrupo } from '../../lib/ci-pasos.js'
import { useIsMobile } from '../../lib/useIsMobile.js'
import AjustesDePaso from './AjustesDePaso.jsx'

const SI_FALLA = [
  { valor: 'stop', texto: 'Detener si falla' },
  { valor: 'continue', texto: 'Continuar si falla' },
  { valor: 'retry', texto: 'Reintentar si falla' },
]

/** Un grupo no se reintenta (lo hace cada integración), así que solo ofrece las dos primeras. */
const SI_FALLA_DE_GRUPO = SI_FALLA.filter((una) => una.valor !== 'retry')

/**
 * Un número que se puede escribir de a poco: mientras se teclea se acepta lo que está en rango, y al salir del campo se
 * lleva al rango. Si se corrigiera en cada pulsación, no se podría escribir «30» con un mínimo de 10 (el «3» ya sería 10).
 */
function CampoNumerico({ valor, min, max, ariaLabel, onCambiar }) {
  const [borrador, setBorrador] = useState(String(valor))

  return (
    <input
      className="input input-sm"
      type="number"
      min={min}
      max={max}
      aria-label={ariaLabel}
      value={borrador}
      onChange={(evento) => {
        setBorrador(evento.target.value)
        const numero = Number(evento.target.value)
        if (Number.isInteger(numero) && numero >= min && numero <= max) onCambiar(numero)
      }}
      onBlur={() => {
        const numero = Math.min(max, Math.max(min, parseInt(borrador, 10) || min))
        setBorrador(String(numero))
        onCambiar(numero)
      }}
    />
  )
}

/** Qué hacer si falla, y con «reintentar», cuántas veces y cuánto esperar. */
function SiFalla({ paso, nombre, onCambiar }) {
  const deGrupo = esGrupo(paso)
  const estrategia = paso.errorStrategy ?? 'stop'

  return (
    <div className="ci-orq-estrategia">
      {/* select-fijo: lista cerrada y corta, no crece con los datos */}
      <select
        className="select"
        aria-label={`Si falla: ${nombre}`}
        title={deGrupo ? 'Qué pasa con la orquestación si alguna integración del grupo falla' : undefined}
        value={estrategia}
        onChange={(evento) => {
          const valor = evento.target.value
          onCambiar({ errorStrategy: valor, ...(valor === 'retry' && Number(paso.maxRetries ?? 0) < 1 ? { maxRetries: 1 } : {}) })
        }}
      >
        {(deGrupo ? SI_FALLA_DE_GRUPO : SI_FALLA).map((una) => <option key={una.valor} value={una.valor}>{una.texto}</option>)}
      </select>

      {estrategia === 'retry' && !deGrupo && (
        <>
          <label className="ci-orq-numero-campo">
            <span className="card-hint">Reintentos:</span>
            <CampoNumerico
              valor={paso.maxRetries || 1}
              min={1}
              max={REINTENTOS_MAXIMOS}
              ariaLabel={`Reintentos: ${nombre}`}
              onCambiar={(maxRetries) => onCambiar({ maxRetries })}
            />
          </label>
          <label className="ci-orq-numero-campo">
            <span className="card-hint">Espera (s):</span>
            <CampoNumerico
              valor={paso.retryDelaySeconds || ESPERA_POR_OMISION_S}
              min={ESPERA_MINIMA_S}
              max={ESPERA_MAXIMA_S}
              ariaLabel={`Espera: ${nombre}`}
              onCambiar={(retryDelaySeconds) => onCambiar({ retryDelaySeconds })}
            />
          </label>
          <p className="card-hint ci-orq-nota">Reintentar repite la carga completa. Una carga que quede sin confirmar nunca se reintenta sola.</p>
        </>
      )}
    </div>
  )
}

/** Lo que los ajustes (los del lote y los del paso) cambian de una integración, o `null` si el body no se puede leer. */
const resolverDelPaso = (paso, integracion, ajustesDelLote) => (
  integracion?.resumen?.valido ? resolverAjustes(integracion.resumen, { general: ajustesDelLote, paso: paso.ajustes }) : null
)

/**
 * Qué integración es: su nombre y, debajo, a qué carga. Con ajustes, la línea dice lo que se enviaría con ellos y se marca de ámbar (con
 * lo que cambia al pasar el cursor). Con la integración borrada, lo dice.
 */
function DatosDeIntegracion({ paso, integracion, ajustesDelLote, pequeno = false }) {
  const nombre = integracion ? integracion.name : paso.label
  const variables = integracion?.resumen?.variables ?? []
  const { efectiva, cambios } = integracionConAjustes(integracion, paso, ajustesDelLote)
  const cambia = cambios.length > 0
  return (
    <>
      <div className={`ci-orq-nombre-paso${pequeno ? ' pequeno' : ''}`} title={nombre}>{nombre}</div>
      {integracion ? (
        <div
          className={`ci-orq-sub${cambia ? ' ajustada' : ''}`}
          title={cambia ? `Con los ajustes:\n${textosDeCambios(cambios).join('\n')}` : detalleDeIntegracion(integracion)}
        >
          {integracion.folder && `${integracion.folder} · `}
          {detalleDeIntegracion(efectiva)}
          {variables.length > 0 && ` · pide ${variables.map((variable) => `{{${variable}}}`).join(', ')}`}
        </div>
      ) : (
        <div className="ci-aviso-fila">La integración ya no existe en esta conexión.</div>
      )}
    </>
  )
}

/**
 * El «⚙ Ajustes» de una integración y su panel. El botón dice cuántos ajustes tiene este paso (ámbar) y, si solo vienen de la
 * orquestación, que los hereda. Con la integración borrada o con el body roto no hay nada que ajustar.
 */
function AjustesDeLaIntegracion({ paso, integracion, ajustesDelLote, opciones, abierto, onAlternar, onCambiar }) {
  const resuelto = resolverDelPaso(paso, integracion, ajustesDelLote)
  if (!resuelto) return null

  const delPaso = resuelto.cambios.filter((cambio) => cambio.fuente === 'paso').length
  const delLote = resuelto.cambios.filter((cambio) => cambio.fuente === 'orquestacion').length
  const estado = delPaso > 0 ? ' con-cambios' : delLote > 0 ? ' heredado' : ''
  const resumen = delPaso > 0 ? ` · ${delPaso}` : delLote > 0 ? ' · heredados' : ''

  return (
    <div className="ci-orq-ajustes-caja">
      <button
        type="button"
        className={`ci-orq-ajustes-boton${estado}`}
        aria-expanded={abierto}
        aria-label={`Ajustes de ${integracion.name}`}
        title={resuelto.cambios.length > 0 ? textosDeCambios(resuelto.cambios).join('\n') : 'Cambiar versión, comando, origen, destino o filtro solo en esta orquestación'}
        onClick={onAlternar}
      >
        ⚙ Ajustes{resumen}
      </button>
      {abierto && (
        <AjustesDePaso paso={paso} integracion={integracion} ajustesDelLote={ajustesDelLote} opciones={opciones} onCambiar={(ajustes) => onCambiar({ ajustes })} />
      )}
    </div>
  )
}

export default function TarjetaDePaso({
  paso, indice, total, porId,
  ajustesDelLote, opcionesDeAjustes,
  esGrupoActivo,
  onQuitar, onSubir, onBajar, onCambiar,
  onAgregarAlGrupo, onQuitarHijo, onCambiarHijo, onSubirHijo, onBajarHijo,
  alSoltarSobre, posicionDeSoltado,
  onArrastrar, onPasarPor, onSalirDe, onSoltar,
}) {
  const [grupoAbierto, setGrupoAbierto] = useState(true)
  const [arrastrando, setArrastrando] = useState(false)
  // Los paneles de ajustes abiertos (por identificador de integración). Con uno abierto la tarjeta no se arrastra: dentro hay campos de
  // texto, y arrastrar a la vez que se selecciona lo escrito sería un fastidio.
  const [conAjustesAbiertos, setConAjustesAbiertos] = useState(() => new Set())
  const alternarAjustes = (id) => setConAjustesAbiertos((previos) => {
    const siguientes = new Set(previos)
    if (!siguientes.delete(id)) siguientes.add(id)
    return siguientes
  })
  const movil = useIsMobile()

  const deGrupo = esGrupo(paso)
  const hijos = paso.children ?? []
  const nombre = deGrupo ? (paso.label || `grupo ${indice + 1}`) : (porId.get(paso.integrationId)?.name ?? paso.label)

  const clases = [
    'ci-orq-tarjeta',
    deGrupo ? 'grupo' : '',
    esGrupoActivo ? 'pendiente' : '',
    arrastrando ? 'arrastrando' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={clases}
      draggable={!movil && conAjustesAbiertos.size === 0}
      onDragStart={(evento) => { if (movil) return; setArrastrando(true); onArrastrar(evento, paso.id) }}
      onDragEnd={() => setArrastrando(false)}
      onDragOver={(evento) => { evento.preventDefault(); onPasarPor(evento, paso.id) }}
      onDragLeave={onSalirDe}
      onDrop={(evento) => { evento.preventDefault(); onSoltar(evento, paso.id) }}
    >
      {alSoltarSobre && <div className={`ci-orq-linea ${posicionDeSoltado}`} />}

      <div className="ci-orq-tarjeta-cabeza">
        {!movil && <div className="ci-orq-asa" title="Arrastrar para reordenar">⠿</div>}

        <div className="ci-orq-numero">{deGrupo ? '⊞' : indice + 1}</div>

        <div className="ci-orq-tarjeta-cuerpo">
          {deGrupo ? (
            <>
              <div className="ci-orq-grupo-titulo">
                <span className="ci-orq-grupo-nombre">Grupo paralelo</span>
                <span className="card-hint">{hijos.length === 1 ? '1 integración' : `${hijos.length} integraciones`}</span>
                <button
                  type="button"
                  className="ci-orq-plegar"
                  aria-label={grupoAbierto ? `Plegar ${nombre}` : `Desplegar ${nombre}`}
                  aria-expanded={grupoAbierto}
                  onClick={() => setGrupoAbierto((abierto) => !abierto)}
                >
                  {grupoAbierto ? '▲' : '▼'}
                </button>
              </div>
              <input
                className="input input-sm ci-orq-descripcion"
                value={paso.label ?? ''}
                placeholder="Descripción opcional…"
                aria-label={`Descripción del grupo ${indice + 1}`}
                onChange={(evento) => onCambiar({ label: evento.target.value })}
              />
              <SiFalla paso={paso} nombre={nombre} onCambiar={onCambiar} />
            </>
          ) : (
            <>
              <DatosDeIntegracion paso={paso} integracion={porId.get(paso.integrationId)} ajustesDelLote={ajustesDelLote} />
              <SiFalla paso={paso} nombre={nombre} onCambiar={onCambiar} />
              <AjustesDeLaIntegracion
                paso={paso}
                integracion={porId.get(paso.integrationId)}
                ajustesDelLote={ajustesDelLote}
                opciones={opcionesDeAjustes}
                abierto={conAjustesAbiertos.has(paso.id)}
                onAlternar={() => alternarAjustes(paso.id)}
                onCambiar={onCambiar}
              />
            </>
          )}
        </div>

        <div className="ci-orq-botones">
          <button type="button" className="ci-orq-mini" disabled={indice === 0} onClick={onSubir} title="Mover arriba" aria-label={`Subir ${nombre}`}>↑</button>
          <button type="button" className="ci-orq-mini" disabled={indice === total - 1} onClick={onBajar} title="Mover abajo" aria-label={`Bajar ${nombre}`}>↓</button>
          <button type="button" className="ci-orq-mini peligro" onClick={onQuitar} title="Eliminar paso" aria-label={`Quitar ${nombre}`}>✕</button>
        </div>
      </div>

      {deGrupo && grupoAbierto && (
        <div className="ci-orq-hijos">
          {hijos.length === 0 && (
            <div className="ci-orq-hijos-vacio">Sin integraciones en el grupo. Agrega desde el panel de integraciones.</div>
          )}
          {hijos.map((hijo, i) => {
            const integracion = porId.get(hijo.integrationId)
            const nombreDelHijo = integracion ? integracion.name : hijo.label
            return (
              <div key={hijo.id} className="ci-orq-hijo">
                <div className="ci-orq-paralelo" title="Corre a la vez que las demás del grupo">∥</div>
                <div className="ci-orq-tarjeta-cuerpo">
                  <DatosDeIntegracion paso={hijo} integracion={integracion} ajustesDelLote={ajustesDelLote} pequeno />
                  <SiFalla paso={hijo} nombre={nombreDelHijo} onCambiar={(cambios) => onCambiarHijo(hijo.id, cambios)} />
                  <AjustesDeLaIntegracion
                    paso={hijo}
                    integracion={integracion}
                    ajustesDelLote={ajustesDelLote}
                    opciones={opcionesDeAjustes}
                    abierto={conAjustesAbiertos.has(hijo.id)}
                    onAlternar={() => alternarAjustes(hijo.id)}
                    onCambiar={(cambios) => onCambiarHijo(hijo.id, cambios)}
                  />
                </div>
                <div className="ci-orq-botones">
                  <button type="button" className="ci-orq-mini" disabled={i === 0} onClick={() => onSubirHijo(hijo.id)} title="Mover arriba" aria-label={`Subir ${nombreDelHijo} dentro del grupo`}>↑</button>
                  <button type="button" className="ci-orq-mini" disabled={i === hijos.length - 1} onClick={() => onBajarHijo(hijo.id)} title="Mover abajo" aria-label={`Bajar ${nombreDelHijo} dentro del grupo`}>↓</button>
                  <button type="button" className="ci-orq-mini peligro" onClick={() => onQuitarHijo(hijo.id)} title="Quitar del grupo" aria-label={`Quitar ${nombreDelHijo} del grupo`}>✕</button>
                </div>
              </div>
            )
          })}

          <button type="button" className="ci-orq-agregar-hijo" onClick={onAgregarAlGrupo}>+ Agregar integración al grupo</button>
        </div>
      )}
    </div>
  )
}
