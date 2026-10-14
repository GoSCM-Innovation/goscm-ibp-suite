// La tabla de campos: de dónde sale cada campo y adónde va en IBP.
//
// El body repite esa información en tres listas (`SourceFieldsfromAddon`, `TargetFieldsInSAPIBP` y
// `FieldMapping`) que tienen que coincidir campo a campo y en el mismo orden. Aquí se edita UNA tabla y las
// tres listas salen de ella, así que no pueden quedar desalineadas (ver `core/ci/mapping.js`).
//
// Si un body que se pega trae las tres desalineadas, se AVISA y se ofrece alinearlas con un botón: no se
// arregla solo, porque no se sabe cuál de las tres era la buena.
//
// Con `ibp` (lo que IBP dice de la tabla o del área del body) la tabla se puede llenar eligiendo campos de IBP, y
// cada fila dice qué es su destino en IBP o avisa de que no existe. Sin `ibp` es la tabla de siempre.

import { useState } from 'react'
import { escribirMapeo, leerMapeo, leerPegado } from '../../../core/ci/mapping.js'
import { aplicarCamposDeMaestro, camposPreseleccionados, infoDeDestino } from '../../lib/ci-ibp.js'
import { useFilasLocales } from '../../lib/useFilasLocales.js'
import VentanaDeSeleccion from '../ui/VentanaDeSeleccion.jsx'
import ConstructorDeCifra from './ConstructorDeCifra.jsx'

/** Las tres listas del bloque, en un solo texto comparable. */
const textoDeListas = (bloque) => JSON.stringify([
  bloque.SourceFieldsfromAddon ?? '', bloque.TargetFieldsInSAPIBP ?? '', bloque.FieldMapping ?? '',
])

/** Cómo se enseña lo que IBP dice del campo destino de una fila. */
function EnIbp({ info }) {
  if (!info) return null
  if (info.estado === 'falta') return <span className="ci-ibp-falta" title="IBP no tiene este campo">⚠ No existe en IBP</span>
  if (info.estado === 'sistema') return <span className="ci-ibp-falta" title="SAP lo rellena solo">⚠ Lo rellena SAP: no se carga</span>
  if (info.estado === 'carga') return <span className="card-hint">Campo de la carga, no de IBP</span>
  return <span className="card-hint">{info.etiqueta}</span>
}

export default function TablaDeMapeo({ bloque, onCambiar, deshabilitado = false, ibp = null }) {
  const externo = textoDeListas(bloque)
  const [filas, ponerFilas] = useFilasLocales(externo, () => leerMapeo(bloque).filas)
  const { coherente, avisos } = leerMapeo(bloque)
  const [pegando, setPegando] = useState(false)
  const [pegado, setPegado] = useState('')
  const [eligiendo, setEligiendo] = useState(false)

  // Lo que IBP dice de la tabla (dato maestro) o del área (cifras clave); `null` mientras no se leyó.
  const detalle = ibp && (ibp.campos || ibp.cifras) ? { tipo: ibp.tipo, campos: ibp.campos, cifras: ibp.cifras } : null

  /** Cambia las filas y avisa de las tres listas que resultan. */
  function cambiarFilas(nuevas) {
    const listas = escribirMapeo(nuevas)
    ponerFilas(nuevas, JSON.stringify([listas.SourceFieldsfromAddon, listas.TargetFieldsInSAPIBP, listas.FieldMapping]))
    onCambiar(listas)
  }

  const cambiarFila = (i, cambios) => cambiarFilas(filas.map((fila, j) => (j === i ? { ...fila, ...cambios } : fila)))

  function aplicarPegado() {
    const nuevas = leerPegado(pegado)
    if (nuevas.length > 0) cambiarFilas(nuevas)
    setPegado('')
    setPegando(false)
  }

  const completas = filas.filter((fila) => fila.origen.trim() && fila.destino.trim()).length

  return (
    <div className="ci-mapeo">
      <div className="ci-filtro-cabeza">
        <span className="card-hint">
          {completas} {completas === 1 ? 'campo' : 'campos'}
          {filas.length !== completas && ` (y ${filas.length - completas} sin completar: no se envían)`}
        </span>
        {!deshabilitado && (
          <div className="ci-mapeo-acciones">
            {ibp?.tipo === 'MASTERDATA' && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEligiendo(true)}
                disabled={!ibp.campos}
                title={ibp.campos ? `Elegir entre los campos de ${ibp.entidad}` : 'Elige primero la tabla de IBP'}
              >
                Elegir campos de IBP
              </button>
            )}
            {ibp?.tipo === 'KEYFIGURES' && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEligiendo(true)}
                disabled={!ibp.cifras}
                title={ibp.cifras ? 'Armar la tabla con una cifra y sus dimensiones' : 'Elige primero el área de IBP'}
              >
                Armar desde IBP
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPegando((v) => !v)}>
              {pegando ? 'Cancelar' : 'Pegar lista'}
            </button>
          </div>
        )}
      </div>

      {ibp?.cargando && <span className="card-hint">Leyendo los campos de IBP…</span>}
      {ibp?.error && <span className="ci-aviso-fila">No se pudieron leer los campos de IBP: {ibp.error}</span>}

      {!coherente && (
        <div className="notice notice-error" role="alert">
          Las tres listas del body no coinciden entre sí. Si se envía así, la carga puede fallar o mapear mal.
          <ul className="ci-avisos">{avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul>
          {!deshabilitado && (
            <button type="button" className="btn btn-sm" onClick={() => cambiarFilas(filas)}>
              Alinear las tres listas con esta tabla
            </button>
          )}
        </div>
      )}

      {pegando && (
        <div className="ci-pegar">
          <textarea
            className="input mono ci-texto-largo"
            rows={5}
            value={pegado}
            autoFocus
            placeholder={'Una lista separada por comas (PRDID,LOCID), pares (KFVALUE:ZFACTURASPOS) o columnas copiadas de Excel.\nReemplaza la tabla actual.'}
            aria-label="Lista de campos a pegar"
            onChange={(evento) => setPegado(evento.target.value)}
          />
          <button type="button" className="btn btn-sm btn-primary" onClick={aplicarPegado} disabled={!pegado.trim()}>
            Reemplazar la tabla
          </button>
        </div>
      )}

      {filas.length > 0 && (
        <div className="table-wrap ci-mapeo-tabla">
          <table className="table">
            <thead>
              <tr>
                <th>Campo de origen</th><th aria-hidden="true" /><th>Campo en SAP IBP</th>
                {detalle && <th>En IBP</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                // El índice es la clave: las filas se recalculan desde el texto y sus identificadores cambian.
                <tr key={i}>
                  <td>
                    <input
                      className="input input-sm mono"
                      value={fila.origen}
                      disabled={deshabilitado}
                      aria-label={`Campo de origen ${i + 1}`}
                      onChange={(evento) => cambiarFila(i, { origen: evento.target.value.trim() })}
                    />
                  </td>
                  <td className="ci-flecha" aria-hidden="true">→</td>
                  <td>
                    <input
                      className="input input-sm mono"
                      value={fila.destino}
                      disabled={deshabilitado}
                      aria-label={`Campo en SAP IBP ${i + 1}`}
                      onChange={(evento) => cambiarFila(i, { destino: evento.target.value.trim() })}
                    />
                  </td>
                  {detalle && <td className="ci-mapeo-ibp"><EnIbp info={infoDeDestino(fila.destino, detalle)} /></td>}
                  <td style={{ textAlign: 'right' }}>
                    {!deshabilitado && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm ci-quitar"
                        onClick={() => cambiarFilas(filas.filter((_uno, j) => j !== i))}
                        title="Quitar el campo"
                        aria-label={`Quitar el campo ${i + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!deshabilitado && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => cambiarFilas([...filas, { id: `nuevo-${filas.length}`, origen: '', destino: '' }])}
        >
          + Campo
        </button>
      )}

      {eligiendo && ibp?.tipo === 'MASTERDATA' && ibp.campos && (
        <VentanaDeSeleccion
          titulo={`Campos de ${ibp.entidad}`}
          opciones={ibp.campos.map((uno) => uno.campo)}
          etiquetas={Object.fromEntries(ibp.campos.map((uno) => [uno.campo, uno.etiqueta]))}
          seleccion={camposPreseleccionados(filas, ibp.campos)}
          sufijoDeConteo="campo(s) seleccionado(s)"
          insignia={(campo) => (ibp.campos.find((uno) => uno.campo === campo)?.sistema ? <span className="tag tag-muted">sistema</span> : null)}
          aviso="Los marcados «sistema» los rellena SAP y no se cargan."
          onGuardar={(elegidos) => { cambiarFilas(aplicarCamposDeMaestro(filas, ibp.campos, elegidos)); setEligiendo(false) }}
          onCerrar={() => setEligiendo(false)}
        />
      )}

      {eligiendo && ibp?.tipo === 'KEYFIGURES' && ibp.cifras && (
        <ConstructorDeCifra
          cifras={ibp.cifras}
          filas={filas}
          area={ibp.area}
          onAplicar={(nuevas) => { cambiarFilas(nuevas); setEligiendo(false) }}
          onCerrar={() => setEligiendo(false)}
        />
      )}
    </div>
  )
}
