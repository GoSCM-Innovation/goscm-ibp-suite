// Los ajustes de TODA la orquestación: la franja plegada arriba del editor.
//
// Por omisión no se cambia nada y la franja está cerrada, con una línea que lo dice («Sin cambios»). Quien quiere otra versión, otro
// comando, otro origen o destino, o otras fechas para todo el lote, la abre y lo elige: se aplica a todos los pasos. Cada paso puede tener
// los suyos (el «⚙ Ajustes» de su tarjeta) y los del paso mandan.
//
// Con fechas elegidas, la franja dice QUÉ PASOS se ven afectados y cómo quedan sus fechas, paso por paso: la fecha es el cambio que más
// se hace y el que más importa comprobar antes de ejecutar.
//
// No guarda nada: cada cambio sube por `onCambiar` con los ajustes nuevos, y quien lo recibe los guarda con el resto.

import { useState } from 'react'
import { CAMPOS_DE_AJUSTE, contarAjustes } from '../../../core/ci/ajustes.js'
import { conCampo, conFecha, efectosDeLosAjustes, rangoCorto, resumenDeLote } from '../../lib/ci-ajustes.js'
import CampoDeAjuste from './CampoDeAjuste.jsx'
import CampoDeFecha from './CampoDeFecha.jsx'

const CAMPOS = ['version', 'comando', 'origen', 'destino']

/** Una fecha del lote: el calendario (o la variable) y, si dice algo, el botón para quitarla. */
function FechaDelLote({ lado, etiqueta, ajustes, onCambiar }) {
  const valor = ajustes.fechas?.[lado] ?? ''
  return (
    <div className={`ci-ajuste${valor ? ' cambiado' : ''}`}>
      <span className="ci-ajuste-etiqueta">{etiqueta}</span>
      <div className="ci-ajuste-control">
        <CampoDeFecha
          id={`ci-lote-fecha-${lado}`}
          valor={valor}
          ariaLabel={`Fecha ${lado} de toda la orquestación`}
          onCambiar={(nuevo) => onCambiar(conFecha(ajustes, lado, nuevo))}
        />
        {valor !== '' && (
          <button type="button" className="ci-ajuste-restablecer" title="Volver a las fechas de cada integración" aria-label={`Restablecer la fecha ${lado}`} onClick={() => onCambiar(conFecha(ajustes, lado, undefined))}>↺</button>
        )}
      </div>
    </div>
  )
}

/** Qué fechas se ven afectadas en cada paso: las de su filtro, antes y después. */
function FechasPorPaso({ efectos }) {
  return (
    <div className="ci-ajustes-fechas-caja">
      <table className="ci-ajustes-fechas">
        <caption className="card-hint">Fechas por paso: así quedan las de cada integración con estos ajustes</caption>
        <thead>
          <tr><th scope="col">Paso</th><th scope="col">Fechas de la integración</th><th scope="col">Con estos ajustes</th></tr>
        </thead>
        <tbody>
          {efectos.map((efecto) => {
            const fechas = efecto.resuelto?.fechas ?? []
            return (
              <tr key={efecto.tarea.id}>
                <td>
                  <span className="card-hint">{efecto.enGrupo ? `${efecto.numero} ∥ ` : `${efecto.numero}. `}</span>
                  {efecto.nombre}
                </td>
                {fechas.length > 0 ? (
                  <>
                    <td className="mono">{fechas.map((f) => rangoCorto(f.original)).join(' · ')}</td>
                    <td className="mono">
                      {fechas.map((f, i) => (
                        <span key={i} className={f.cambia ? 'ci-fecha-cambiada' : undefined}>
                          {i > 0 && ' · '}
                          {rangoCorto(f.efectivo)}
                          {f.cambia && f.fuente === 'paso' && <span className="card-hint"> (fechas propias del paso)</span>}
                        </span>
                      ))}
                    </td>
                  </>
                ) : (
                  <td colSpan={2} className="card-hint">
                    {efecto.resuelto ? 'No filtra por fecha: no se toca' : 'Sin datos de la integración'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AjustesDeLaOrquestacion({ ajustes, onCambiar, tareas, porId, opciones }) {
  const [abierta, setAbierta] = useState(false)
  const cantidad = contarAjustes(ajustes)
  const efectos = efectosDeLosAjustes(tareas, porId, ajustes)

  // El comando que más conviene mirar dos veces: REPLACE. Se avisa cuántos pasos lo llevan por este ajuste y antes no.
  const conReplace = efectos.filter((efecto) => efecto.resuelto?.cambios.some((c) => c.clave === 'comando' && c.a === 'REPLACE' && c.fuente === 'orquestacion'))

  return (
    <section className={`ci-orq-ajustes${cantidad > 0 ? ' con-cambios' : ''}`} aria-label="Ajustes de la orquestación">
      <button type="button" className="ci-orq-ajustes-cabeza" aria-expanded={abierta} onClick={() => setAbierta((valor) => !valor)}>
        <span className="ci-orq-ajustes-titulo">⚙ Ajustes de la orquestación</span>
        <span className="ci-orq-ajustes-resumen">
          {cantidad === 0 ? 'Sin cambios: cada integración usa lo suyo' : resumenDeLote(ajustes)}
        </span>
        {cantidad > 0 && <span className="ci-orq-ajustes-chip">{cantidad === 1 ? '1 ajuste' : `${cantidad} ajustes`}</span>}
        <span className="ci-orq-ajustes-flecha" aria-hidden="true">{abierta ? '▲' : '▼'}</span>
      </button>

      {abierta && (
        <div className="ci-orq-ajustes-cuerpo">
          <p className="card-hint">
            Se aplican a todos los pasos al ejecutar; las integraciones no se modifican. Un paso puede tener los suyos («⚙ Ajustes» en su
            tarjeta) y esos mandan.
          </p>

          <div className="ci-ajustes-rejilla">
            {CAMPOS.map((clave) => (
              <CampoDeAjuste
                key={clave}
                id={`ci-lote-${clave}`}
                etiqueta={CAMPOS_DE_AJUSTE[clave].etiqueta}
                valor={ajustes[clave]}
                opciones={opciones[clave]}
                conBase={clave === 'version'}
                textoSinCambio="Como en cada integración"
                onCambiar={(valor) => onCambiar(conCampo(ajustes, clave, valor))}
              />
            ))}
          </div>

          <div className="ci-ajustes-rejilla">
            <FechaDelLote lado="desde" etiqueta="Fechas: desde" ajustes={ajustes} onCambiar={onCambiar} />
            <FechaDelLote lado="hasta" etiqueta="Fechas: hasta" ajustes={ajustes} onCambiar={onCambiar} />
          </div>
          <p className="card-hint">
            Las fechas cambian los rangos sobre KEYFIGUREDATE (desde y hasta) de las integraciones que filtran por fecha. Puede ser una variable
            ({'{{FECHA_DESDE}}'}): se pide al ejecutar.
          </p>

          {conReplace.length > 0 && (
            <div className="notice notice-aviso" role="status">
              REPLACE puede reemplazar los datos que ya hay. Este ajuste lo pone en {conReplace.length === 1 ? '1 paso' : `${conReplace.length} pasos`} que
              antes cargaban con otro comando.
            </div>
          )}

          {(ajustes.fechas?.desde || ajustes.fechas?.hasta) && <FechasPorPaso efectos={efectos} />}

          {cantidad > 0 && (
            <div className="ci-orq-ajustes-pie">
              <button type="button" className="btn btn-sm" onClick={() => onCambiar({})}>Restablecer todo</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
