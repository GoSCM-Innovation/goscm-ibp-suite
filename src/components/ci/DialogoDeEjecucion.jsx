// El diálogo de «Ejecutar»: confirmar qué se va a cargar, dónde, y con qué valores.
//
// Es el último control antes de una carga a SAP IBP, y por eso dice las tres cosas que importan:
//
//   - CONTRA QUÉ tenant: el nombre y la dirección de la conexión y si es productivo. Elegir el tenant
//     equivocado no da un error, da una carga en otro sistema (regla de la suite: cada pantalla que escribe
//     dice contra cuál).
//   - QUÉ se ejecuta, con el comando tal como está escrito en el body (INSERT_UPDATE, REPLACE…). No se
//     interpreta qué hace: se enseña lo que dice.
//   - CON QUÉ valores: las variables de las integraciones, que se piden aquí y se proponen con los de la
//     última vez.
//
// En producción hay que marcar que se entiende. Ejecutar UNA integración espera a CPI y enseña el resultado
// en el mismo diálogo; lanzar una ORQUESTACIÓN solo la arranca y se cierra (la ejecución se ve en la pantalla).

import { useState } from 'react'
import { motivoDeValorInvalido } from '../../../core/ci/body.js'
import { escribirDuracion } from '../../../core/orchestrations/run-detail.js'
import { ESTADOS_DE_EJECUCION } from '../../lib/ci.js'
import { copyText } from '../../lib/clipboard.js'
import { hostDe } from '../../lib/nombre-de-conexion.js'
import BotonCopiar from '../ui/BotonCopiar.jsx'
import EstadoDeCarga from '../ui/EstadoDeCarga.jsx'
import Modal from '../ui/Modal.jsx'
import CampoDeFecha from './CampoDeFecha.jsx'
import RevisionIbp from './RevisionIbp.jsx'

/**
 * Qué quiere decir «con advertencias». CPI contestó algo distinto de OK pero procesó la carga: puede que IBP haya rechazado
 * algún registro, y eso no es necesariamente un error. Se dice así, y qué mirar, para que nadie lo lea como un fallo.
 */
export function AvisoDeAdvertencia({ httpStatus }) {
  return (
    <div className="notice notice-aviso" role="status">
      CPI respondió {httpStatus ?? 'algo distinto de OK'} y no 200 (OK). La carga se procesó, pero IBP pudo rechazar algún
      registro: no es necesariamente un error. Revisa el detalle con el MPL ID en el monitor de Cloud Integration.
    </div>
  )
}

/** El resultado de una ejecución, como se lee. */
export function ResultadoDeEjecucion({ run }) {
  const estado = ESTADOS_DE_EJECUCION[run.resultado] ?? { texto: run.resultado, clase: 'espera' }
  return (
    <div className="ci-resultado">
      <div className="ci-resultado-cabeza">
        <span className={`ci-estado ci-estado-${estado.clase}`}>{estado.texto}</span>
        {run.httpStatus && <span className="mono">HTTP {run.httpStatus}</span>}
        <span className="card-hint">{escribirDuracion(run.duracionMs)}</span>
      </div>
      {run.mplId && (
        <div className="ci-resultado-mpl">
          <span className="card-hint">MPL ID (para buscarlo en el monitor de Cloud Integration)</span>
          <code className="mono">{run.mplId}</code>
          <BotonCopiar titulo="Copiar el MPL ID" onCopiar={() => copyText(run.mplId)} />
        </div>
      )}
      {run.resultado === 'warning' && <AvisoDeAdvertencia httpStatus={run.httpStatus} />}
      {run.resultado === 'unconfirmed' && (
        <div className="notice notice-error" role="alert">
          No se sabe cómo terminó. La carga pudo haber entrado, entera o a medias: revísala en Cloud Integration
          antes de repetirla.
        </div>
      )}
      {run.mensaje && <pre className="ci-resultado-mensaje mono">{run.mensaje}</pre>}
    </div>
  )
}

export default function DialogoDeEjecucion({
  titulo,
  conexion,
  integraciones,
  variables = [],
  variablesDeFecha = [],
  iniciales = {},
  avisos = [],
  esOrquestacion = false,
  onEjecutar,
  onCerrar,
}) {
  const [valores, setValores] = useState(() => Object.fromEntries(variables.map((nombre) => [nombre, iniciales[nombre] ?? ''])))
  const [entiendo, setEntiendo] = useState(false)
  const [fase, setFase] = useState('preguntando')
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')

  // Se valida y se envía el valor SIN espacios en los extremos, pero lo que se escribe se deja como está: recortar
  // en cada pulsación se comería los espacios del medio de un valor mientras se escribe.
  const limpios = Object.fromEntries(Object.entries(valores).map(([nombre, valor]) => [nombre, valor.trim()]))
  const motivos = Object.fromEntries(variables.map((nombre) => [nombre, limpios[nombre] === '' ? 'Falta el valor.' : motivoDeValorInvalido(limpios[nombre])]))
  const hayProblemas = Object.values(motivos).some(Boolean)
  const faltaConfirmar = conexion.isProduction && !entiendo
  const puedeEjecutar = fase === 'preguntando' && !hayProblemas && !faltaConfirmar && integraciones.length > 0

  async function ejecutar() {
    setFase('ejecutando')
    setError('')
    try {
      const salida = await onEjecutar(limpios)
      if (esOrquestacion) { onCerrar(); return }
      setResultado(salida)
      setFase('listo')
    } catch (fallo) {
      setError(fallo.message)
      setFase('preguntando')
    }
  }

  return (
    <Modal
      title={titulo}
      subtitle={`${conexion.name} · ${hostDe(conexion.baseUrl)}`}
      // Mientras espera a CPI no se cierra: la carga sigue aunque se cierre el diálogo, y el resultado se perdería de vista.
      onClose={fase === 'ejecutando' ? () => {} : onCerrar}
      wide
      footer={fase === 'listo' ? (
        <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>
      ) : (
        <>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={fase === 'ejecutando'}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={ejecutar} disabled={!puedeEjecutar}>
            {fase === 'ejecutando' ? 'Ejecutando…' : '▶ Ejecutar'}
          </button>
        </>
      )}
    >
      <div className={`ci-ambiente ${conexion.isProduction ? 'ci-ambiente-prod' : ''}`}>
        <strong>{conexion.isProduction ? 'PRODUCCIÓN' : 'Desarrollo / Calidad'}</strong>
        <span>{conexion.name}</span>
        <span className="mono">{hostDe(conexion.baseUrl)}</span>
      </div>

      {fase !== 'listo' && (
        <>
          <RevisionIbp avisos={avisos} />
          <div className="ci-seccion">
            <h3 className="ci-seccion-titulo">
              {esOrquestacion ? `Se ejecutarán, en este orden (${integraciones.length})` : 'Se ejecutará'}
            </h3>
            <ul className="ci-lista-ejecutar">
              {integraciones.map((una, i) => (
                <li key={i}>
                  <span>
                    {una.paso && <span className="card-hint">Paso {una.paso}{una.paralelo ? ' (a la vez)' : ''} · </span>}
                    {una.nombre}
                  </span>
                  {una.comando && <code className="mono" title="BatchCommand del body">{una.comando}</code>}
                </li>
              ))}
            </ul>
          </div>

          {variables.length > 0 && (
            <div className="ci-seccion">
              <h3 className="ci-seccion-titulo">Valores</h3>
              <div className="ci-form-grid">
                {variables.map((nombre) => (
                  <div className="field" key={nombre}>
                    <label htmlFor={`ci-var-${nombre}`}>{`{{${nombre}}}`}</label>
                    {variablesDeFecha.includes(nombre) ? (
                      // Una variable que va en una condición sobre KEYFIGUREDATE es una fecha: se elige en un calendario.
                      <CampoDeFecha
                        id={`ci-var-${nombre}`}
                        valor={valores[nombre]}
                        ariaLabel={nombre}
                        conVariable={false}
                        deshabilitado={fase === 'ejecutando'}
                        onCambiar={(fecha) => setValores({ ...valores, [nombre]: fecha })}
                      />
                    ) : (
                      <input
                        id={`ci-var-${nombre}`}
                        className="input mono"
                        value={valores[nombre]}
                        disabled={fase === 'ejecutando'}
                        aria-invalid={Boolean(motivos[nombre])}
                        onChange={(evento) => setValores({ ...valores, [nombre]: evento.target.value })}
                      />
                    )}
                    {motivos[nombre] && limpios[nombre] !== '' && <span className="ci-aviso-fila">{motivos[nombre]}</span>}
                  </div>
                ))}
              </div>
              <p className="card-hint">Se proponen los valores de la última vez que se ejecutó.</p>
            </div>
          )}

          {conexion.isProduction && (
            <label className="ci-confirmar-prod">
              <input
                type="checkbox"
                checked={entiendo}
                disabled={fase === 'ejecutando'}
                onChange={(evento) => setEntiendo(evento.target.checked)}
              />
              Entiendo que esto carga datos en el ambiente PRODUCTIVO de «{conexion.name}».
            </label>
          )}

          {fase === 'ejecutando' && (
            <EstadoDeCarga
              mensaje={esOrquestacion ? 'Iniciando la orquestación…' : 'Esperando la respuesta de CPI. Puede tardar unos minutos: no cierres esta ventana.'}
            />
          )}
          {error && <div className="notice notice-error" role="alert">✕ {error}</div>}
        </>
      )}

      {fase === 'listo' && resultado && <ResultadoDeEjecucion run={resultado} />}
    </Modal>
  )
}
