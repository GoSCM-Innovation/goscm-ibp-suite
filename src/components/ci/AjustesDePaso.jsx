// Los ajustes de UN paso: lo que esta orquestación cambia de ESTA integración, sin tocar la integración original.
//
// Los cuatro campos (versión, comando, origen y destino) y, debajo, el FILTRO de la integración condición por condición: sus fechas con
// calendario y sus valores en una línea. Cada campo arranca en «como en la integración» (o en lo que diga la orquestación, si ella cambia
// ese dato): lo que se cambia aquí manda sobre lo de la orquestación, y se marca de ámbar para verlo de un vistazo.
//
// Lo que se cambia a un valor que ya es el que quedaría de todos modos no se guarda: sería un ajuste que no cambia nada.

import { useState } from 'react'
import { CAMPOS_DE_AJUSTE, CAMPO_DE_FECHA, resolverAjustes } from '../../../core/ci/ajustes.js'
import { conCampo, conFiltro, rangoCorto } from '../../lib/ci-ajustes.js'
import CampoDeAjuste from './CampoDeAjuste.jsx'
import CampoDeFecha from './CampoDeFecha.jsx'

const CAMPOS = ['version', 'comando', 'origen', 'destino']

/** Lo que dice el body de la integración en un campo, para el texto de «como en la integración (…)». */
function originalDe(clave, resumen) {
  const valor = resumen[CAMPOS_DE_AJUSTE[clave].enVista]
  if (valor) return valor
  return clave === 'version' && resumen.areaDePlanificacion ? 'base' : '—'
}

/** Los valores de una condición del filtro, en una línea: `ZFER, ZHAW`. Se escribe de a poco: lo que se teclea se acepta tal cual. */
function CampoDeValores({ valores, onCambiar, ariaLabel }) {
  const texto = valores.join(', ')
  const [borrador, setBorrador] = useState(texto)

  return (
    <input
      className="input input-sm mono"
      value={borrador}
      aria-label={ariaLabel}
      onChange={(evento) => {
        setBorrador(evento.target.value)
        onCambiar(evento.target.value.split(',').map((valor) => valor.trim()).filter(Boolean))
      }}
      // Al salir se vuelve a escribir lo que quedó (sin espacios ni comas de sobra).
      onBlur={() => setBorrador(texto)}
    />
  )
}

/** Una condición del filtro de la integración, editable. */
function Condicion({ condicion, base, indice, ajustes, onCambiar }) {
  const { campo } = condicion
  const delPaso = condicion.fuente === 'paso'
  const esFecha = String(campo).trim().toUpperCase() === CAMPO_DE_FECHA
  const delFiltro = ajustes.filtro?.[campo] ?? {}

  const restablecer = () => onCambiar(conFiltro(ajustes, campo, null))

  function cambiarLado(lado, valor) {
    const nuevo = { ...delFiltro }
    // Se quita si se vació o si es lo que quedaría de todos modos (sin los ajustes de este paso): no cambia nada.
    if (valor === '' || valor === base[lado]) delete nuevo[lado]
    else nuevo[lado] = valor
    onCambiar(conFiltro(ajustes, campo, Object.keys(nuevo).length === 0 ? null : nuevo))
  }

  return (
    <div className={`ci-ajuste-condicion${delPaso ? ' cambiado' : ''}`}>
      <span className="ci-ajuste-condicion-campo mono" title={condicion.tipo === 'entre' ? 'Rango (BT): desde y hasta' : 'Valores (EQ)'}>{campo}</span>
      <div className="ci-ajuste-condicion-valores">
        {condicion.tipo === 'igual' ? (
          <CampoDeValores
            valores={condicion.valores}
            ariaLabel={`Valores de ${campo} (${indice + 1})`}
            onCambiar={(valores) => {
              if (valores.length === 0) return
              onCambiar(conFiltro(ajustes, campo, valores.join('\u0000') === base.valores.join('\u0000') ? null : { valores }))
            }}
          />
        ) : (
          // Un rango: «Desde» y «Hasta» uno bajo el otro, cada uno con su nombre. Con una flecha entre los dos, en un panel angosto
          // la flecha quedaba colgando al final de la primera línea.
          <div className="ci-ajuste-rango">
            <div className="ci-ajuste-rango-lado">
              <span>Desde</span>
              {esFecha
                ? <CampoDeFecha id={`ci-paso-${indice}-desde`} valor={condicion.desde} ariaLabel={`${campo} desde`} onCambiar={(v) => cambiarLado('desde', v)} />
                : <input className="input input-sm mono" value={condicion.desde} aria-label={`${campo} desde`} onChange={(e) => cambiarLado('desde', e.target.value)} />}
            </div>
            <div className="ci-ajuste-rango-lado">
              <span>Hasta</span>
              {esFecha
                ? <CampoDeFecha id={`ci-paso-${indice}-hasta`} valor={condicion.hasta} ariaLabel={`${campo} hasta`} onCambiar={(v) => cambiarLado('hasta', v)} />
                : <input className="input input-sm mono" value={condicion.hasta} aria-label={`${campo} hasta`} onChange={(e) => cambiarLado('hasta', e.target.value)} />}
            </div>
          </div>
        )}
      </div>
      {delPaso && (
        <span className="ci-ajuste-condicion-original card-hint" title="Lo que dice la integración">
          antes: {condicion.tipo === 'entre' ? rangoCorto(condicion.original) : condicion.original.valores.join(', ')}
        </span>
      )}
      {condicion.fuente === 'orquestacion' && <span className="card-hint">de la orquestación</span>}
      {delPaso && (
        <button type="button" className="ci-ajuste-restablecer" title="Volver a lo de la integración" aria-label={`Restablecer ${campo}`} onClick={restablecer}>↺</button>
      )}
    </div>
  )
}

export default function AjustesDePaso({ paso, integracion, ajustesDelLote, opciones, onCambiar }) {
  const ajustes = paso.ajustes ?? {}
  const resumen = integracion.resumen
  // Lo que valdría SIN los ajustes de este paso (la integración, o la orquestación si ella cambia ese dato) y lo que vale con ellos.
  const sinPaso = resolverAjustes(resumen, { general: ajustesDelLote, paso: {} })
  const conPaso = resolverAjustes(resumen, { general: ajustesDelLote, paso: ajustes })
  const deLaOrquestacion = (clave) => sinPaso.cambios.some((cambio) => cambio.clave === clave)

  return (
    <div className="ci-orq-ajustes-paso">
      <p className="card-hint">
        Solo para esta integración dentro de esta orquestación: la integración original no cambia, y lo que pongas aquí manda sobre los
        ajustes de la orquestación.
      </p>

      <div className="ci-ajustes-rejilla">
        {CAMPOS.map((clave) => (
          <CampoDeAjuste
            key={clave}
            id={`ci-${paso.id}-${clave}`}
            etiqueta={CAMPOS_DE_AJUSTE[clave].etiqueta}
            valor={ajustes[clave]}
            opciones={opciones[clave]}
            conBase={clave === 'version'}
            textoSinCambio={deLaOrquestacion(clave)
              ? `De la orquestación (${sinPaso[clave] === '' ? 'base' : sinPaso[clave]})`
              : `Como en la integración (${originalDe(clave, resumen)})`}
            onCambiar={(valor) => onCambiar(conCampo(ajustes, clave, valor === sinPaso[clave] ? undefined : valor))}
          />
        ))}
      </div>

      <div className="ci-ajustes-filtro">
        <div className="ci-ajustes-filtro-titulo">Filtro de la integración</div>
        {conPaso.condiciones.length === 0 && <p className="card-hint">Esta integración no tiene filtro.</p>}
        {conPaso.condiciones.map((condicion, i) => (
          <Condicion
            key={`${condicion.tipo}:${condicion.campo}:${i}`}
            condicion={condicion}
            base={sinPaso.condiciones[i]}
            indice={i}
            ajustes={ajustes}
            onCambiar={onCambiar}
          />
        ))}
      </div>

      {Object.keys(ajustes).length > 0 && (
        <div className="ci-orq-ajustes-pie">
          <button type="button" className="btn btn-sm" onClick={() => onCambiar({})}>Restablecer los ajustes de este paso</button>
        </div>
      )}
    </div>
  )
}
