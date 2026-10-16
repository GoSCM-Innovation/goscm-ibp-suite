// La vista de una ejecución: cómo va cada paso. Es la vista de ejecución del orquestador de IBP (`RunView`): el icono de
// estado, el tiempo en vivo, el error de cada paso, el resumen arriba y «⊘ Cancelar» / «← Volver al editor».
//
// Lo propio de CI Tools, que IBP no tiene:
//   - lo que contestó CPI en cada paso (código HTTP y MPL ID, que es lo que se busca después en el monitor de Cloud Integration);
//   - «Completado con advertencias»: CPI procesó la carga y contestó algo distinto de OK. No es un error y no detiene lo siguiente;
//   - «Sin confirmar»: se envió y no se sabe si la carga entró. Ni éxito ni error: se revisa en Cloud Integration antes de retomar;
//   - «↺ Retomar»: sigue desde donde falló, sin repetir lo que ya cargó.
//
// El estado lo arma el motor del servidor; esta pantalla solo lo enseña.

import { useEffect, useState } from 'react'
import { textosDeCambios } from '../../../core/ci/ajustes.js'
import { duracionMs, escribirDuracion } from '../../../core/orchestrations/run-detail.js'
import { ESTADOS_DE_PASO, detalleDeIntegracion, fechaLegible } from '../../lib/ci.js'
import { integracionConAjustes, integracionConCambios } from '../../lib/ci-ajustes.js'
import { esGrupo } from '../../lib/ci-pasos.js'
import { copyText } from '../../lib/clipboard.js'
import { runProgress } from '../../lib/orchestrations.js'
import BotonCopiar from '../ui/BotonCopiar.jsx'
import { AvisoDeAdvertencia } from './DialogoDeEjecucion.jsx'

/** Un paso que se envió y no se sabe cómo terminó. Para el motor es un error; para quien lo mira, no es lo mismo. */
const SIN_CONFIRMAR = { texto: 'Sin confirmar', icono: '?', clase: 'duda' }

const estadoDe = (estado) => (
  estado?.detalle?.sinConfirmar ? SIN_CONFIRMAR : (ESTADOS_DE_PASO[estado?.status] ?? { texto: estado?.status ?? '—', icono: '○', clase: 'espera' })
)

/** El resumen de toda la ejecución. «Completada con advertencias» si terminó bien pero algún paso las tuvo. */
function resumenDeEjecucion(run) {
  const algunaConAdvertencias = Object.values(run?.nodes ?? {}).some((paso) => (
    paso.status === 'success_with_errors' || Object.values(paso.children ?? {}).some((hijo) => hijo.status === 'success_with_errors')
  ))
  switch (run?.status) {
    case 'running': return { texto: 'En ejecución', icono: '◉', clase: 'en-curso' }
    case 'success': return algunaConAdvertencias
      ? { texto: 'Completada con advertencias', icono: '⚠', clase: 'aviso' }
      : { texto: 'Completada', icono: '✓', clase: 'bien' }
    case 'error': return { texto: 'Terminó con error', icono: '✕', clase: 'mal' }
    case 'cancelled': return { texto: 'Cancelada', icono: '⊘', clase: 'duda' }
    default: return { texto: run?.status ?? '—', icono: '○', clase: 'espera' }
  }
}

/** Cuánto lleva un paso corriendo, contado cada segundo. */
function Transcurrido({ desde }) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(reloj)
  }, [])
  return <span className="ci-orq-tiempo mono">{escribirDuracion(Math.max(0, ahora - Date.parse(desde)))}</span>
}

/**
 * Una fila de la ejecución: una integración con su estado y, si lo hay, lo que contestó CPI.
 *
 * La línea de debajo del nombre dice lo que SE ENVÍA (con los ajustes de la orquestación y los del paso), no lo que dice la integración: de
 * otro modo un paso con REPLACE ajustado se vería como INSERT_UPDATE mientras corre. Los ajustes se ven desde antes de empezar el paso;
 * una vez terminado, vale lo que quedó anotado al enviarlo (no lo que valgan hoy los ajustes de la orquestación).
 */
function FilaDeIntegracion({ estado, etiqueta, integracion, tarea, ajustesDelLote, hijo = false }) {
  if (!estado) return null
  const vista = estadoDe(estado)
  const detalle = estado.detalle ?? {}
  const ms = estado.finishedAt ? duracionMs(estado) : null
  const terminado = Boolean(estado.finishedAt)
  const previstos = integracionConAjustes(integracion, tarea, ajustesDelLote)
  const ajustes = terminado ? (detalle.ajustes ?? []) : previstos.cambios
  const enviada = terminado ? integracionConCambios(integracion, ajustes) : previstos.efectiva

  return (
    <div className={`ci-orq-fila${hijo ? ' hijo' : ''}${estado.status === 'running' ? ' corriendo' : ''}`}>
      <div className={`ci-orq-fila-icono ci-orq-icono-${vista.clase}${estado.status === 'running' ? ' ci-orq-pulso' : ''}`} aria-hidden="true">{vista.icono}</div>

      <div className="ci-orq-fila-cuerpo">
        <div className="ci-orq-fila-titulo">
          <span className="ci-orq-fila-nombre" title={etiqueta}>{etiqueta}</span>
          <span className={`ci-orq-fila-estado ci-orq-texto-${vista.clase}`}>{vista.texto}</span>
          {estado.status === 'running' && estado.startedAt && <Transcurrido desde={estado.startedAt} />}
          {estado.retryCount > 0 && <span className="ci-orq-intento">intento {estado.retryCount + 1}</span>}
        </div>

        {integracion && (
          <div className={`ci-orq-sub mono${ajustes.length > 0 ? ' ajustada' : ''}`}>
            {integracion.folder && `${integracion.folder} · `}{detalleDeIntegracion(enviada)}
          </div>
        )}

        {ajustes.length > 0 && (
          <div className="ci-orq-fila-ajustes" title="Lo que la orquestación cambió de esta integración al enviarla">
            <span className="ci-orq-ajustes-chip">Con ajustes</span>
            {textosDeCambios(ajustes).join(' · ')}
          </div>
        )}

        {(detalle.httpStatus || detalle.mplId) && (
          <div className="ci-orq-fila-cpi">
            {detalle.httpStatus && <span className="mono">HTTP {detalle.httpStatus}</span>}
            {detalle.mplId && (
              <span className="ci-resultado-mpl">
                <code className="mono" title="MPL ID">{detalle.mplId}</code>
                <BotonCopiar titulo="Copiar el MPL ID" onCopiar={() => copyText(detalle.mplId)} />
              </span>
            )}
          </div>
        )}

        {estado.error && <div className="ci-orq-fila-error">{estado.error}</div>}

        {estado.status === 'success_with_errors' && (
          <>
            <AvisoDeAdvertencia httpStatus={detalle.httpStatus} />
            {detalle.mensaje && <pre className="ci-resultado-mensaje mono">{detalle.mensaje}</pre>}
          </>
        )}

        {detalle.sinConfirmar && (
          <div className="notice notice-error" role="alert">
            Sin confirmar: la carga pudo haber entrado. Revísala en Cloud Integration antes de retomar.
          </div>
        )}
      </div>

      {ms !== null && <div className="ci-orq-fila-duracion">{escribirDuracion(ms)}</div>}
    </div>
  )
}

export default function VistaDeEjecucion({
  run, pasos, porId, nombre,
  enMarcha, ocupado, error,
  puedeRetomar, mismaVersion,
  onCancelar, onRetomar, onVolver,
}) {
  if (!run) return null

  const resumen = resumenDeEjecucion(run)
  const progreso = runProgress(run)
  const duracion = run.finishedAt ? escribirDuracion(duracionMs(run)) : null
  const valores = Object.entries(run.defaults?.variables ?? {})
  // Los del lote se fijaron al lanzar: son los de la ejecución, no los que la orquestación tenga guardados ahora.
  const ajustesDelLote = run.defaults?.ajustes ?? {}

  return (
    <div className="ci-orq-ejecucion">
      <div className="ci-orq-ejecucion-cabeza">
        <div className={`ci-orq-icono-grande ci-orq-icono-${resumen.clase}${enMarcha ? ' ci-orq-pulso' : ''}`} aria-hidden="true">{resumen.icono}</div>

        <div className="ci-orq-ejecucion-titulo">
          <div className="ci-orq-ejecucion-nombre">{nombre}</div>
          <div className={`ci-orq-texto-${resumen.clase}`}>
            {resumen.texto}
            <span className="card-hint"> · {progreso.hechos}/{progreso.total} integraciones{duracion && ` · ${duracion}`}</span>
          </div>
          <div className="card-hint">
            Empezó {fechaLegible(run.startedAt)}
            {run.defaults?.startedBy?.email && ` · lanzada por ${run.defaults.startedBy.email}`}
          </div>
          {valores.length > 0 && (
            <div className="card-hint mono">{valores.map(([variable, valor]) => `{{${variable}}} = ${valor}`).join(' · ')}</div>
          )}
          {enMarcha && (
            <div className="card-hint">Avanza mientras esta pantalla esté abierta: no la cierres hasta que termine.</div>
          )}
        </div>

        <div className="ci-orq-ejecucion-acciones">
          {enMarcha && (
            <button type="button" className="ci-orq-cancelar" onClick={onCancelar} disabled={ocupado}>⊘ Cancelar</button>
          )}
          {puedeRetomar && (
            <button type="button" className="ci-orq-boton" onClick={onRetomar} disabled={ocupado}>↺ Retomar</button>
          )}
          {!enMarcha && <button type="button" className="ci-orq-boton" onClick={onVolver}>← Volver al editor</button>}
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">✕ {error}</div>}

      {!enMarcha && !mismaVersion && (
        <p className="ci-orq-aviso">
          La orquestación cambió después de esta ejecución: se muestran solo los pasos que siguen en ella, y ya no se puede retomar.
          Para ver todos sus pasos, ejecútala de nuevo.
        </p>
      )}

      <div className="ci-orq-ejecucion-pasos">
        {pasos.map((paso, i) => {
          const estado = run.nodes?.[paso.id]

          // Una ejecución del editor de etapas no tiene el grupo: sus integraciones están sueltas en el primer nivel. Se enseñan
          // igual, bajo un grupo sin estado propio.
          if (!estado && esGrupo(paso) && (paso.children ?? []).some((hijo) => run.nodes?.[hijo.id])) {
            return (
              <div key={paso.id}>
                <div className="ci-orq-grupo-fila">
                  <div className="ci-orq-fila-icono cuadrado ci-orq-icono-espera" aria-hidden="true">⊞</div>
                  <div><span className="ci-orq-grupo-nombre">{paso.label || `Grupo paralelo · paso ${i + 1}`}</span></div>
                </div>
                {paso.children.map((hijo) => {
                  const integracion = porId.get(hijo.integrationId)
                  return (
                    <FilaDeIntegracion
                      key={hijo.id}
                      estado={run.nodes[hijo.id]}
                      etiqueta={integracion ? integracion.name : hijo.label}
                      integracion={integracion}
                      tarea={hijo}
                      ajustesDelLote={ajustesDelLote}
                      hijo
                    />
                  )
                })}
              </div>
            )
          }
          if (!estado) return null

          if (!esGrupo(paso)) {
            const integracion = porId.get(paso.integrationId)
            return (
              <FilaDeIntegracion
                key={paso.id}
                estado={estado}
                etiqueta={`${i + 1}. ${integracion ? integracion.name : paso.label}`}
                integracion={integracion}
                tarea={paso}
                ajustesDelLote={ajustesDelLote}
              />
            )
          }

          const vista = estadoDe(estado)
          return (
            <div key={paso.id}>
              <div className={`ci-orq-grupo-fila${estado.status === 'running' ? ' corriendo' : ''}`}>
                <div className={`ci-orq-fila-icono cuadrado ci-orq-icono-${vista.clase}${estado.status === 'running' ? ' ci-orq-pulso' : ''}`} aria-hidden="true">{vista.icono}</div>
                <div>
                  <span className="ci-orq-grupo-nombre">{paso.label || `Grupo paralelo · paso ${i + 1}`}</span>
                  <span className={`ci-orq-fila-estado ci-orq-texto-${vista.clase}`}>{vista.texto}</span>
                  {estado.status === 'running' && estado.startedAt && <Transcurrido desde={estado.startedAt} />}
                </div>
              </div>
              {(paso.children ?? []).map((hijo) => {
                const integracion = porId.get(hijo.integrationId)
                return (
                  <FilaDeIntegracion
                    key={hijo.id}
                    estado={estado.children?.[hijo.id]}
                    etiqueta={integracion ? integracion.name : hijo.label}
                    integracion={integracion}
                    tarea={hijo}
                    ajustesDelLote={ajustesDelLote}
                    hijo
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
