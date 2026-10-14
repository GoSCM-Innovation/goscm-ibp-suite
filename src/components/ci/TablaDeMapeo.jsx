// La tabla de campos: de dónde sale cada campo y adónde va en IBP.
//
// El body repite esa información en tres listas (`SourceFieldsfromAddon`, `TargetFieldsInSAPIBP` y
// `FieldMapping`) que tienen que coincidir campo a campo y en el mismo orden. Aquí se edita UNA tabla y las
// tres listas salen de ella, así que no pueden quedar desalineadas (ver `core/ci/mapping.js`).
//
// Si un body que se pega trae las tres desalineadas, se AVISA y se ofrece alinearlas con un botón: no se
// arregla solo, porque no se sabe cuál de las tres era la buena.

import { useState } from 'react'
import { escribirMapeo, leerMapeo, leerPegado } from '../../../core/ci/mapping.js'
import { useFilasLocales } from '../../lib/useFilasLocales.js'

/** Las tres listas del bloque, en un solo texto comparable. */
const textoDeListas = (bloque) => JSON.stringify([
  bloque.SourceFieldsfromAddon ?? '', bloque.TargetFieldsInSAPIBP ?? '', bloque.FieldMapping ?? '',
])

export default function TablaDeMapeo({ bloque, onCambiar, deshabilitado = false }) {
  const externo = textoDeListas(bloque)
  const [filas, ponerFilas] = useFilasLocales(externo, () => leerMapeo(bloque).filas)
  const { coherente, avisos } = leerMapeo(bloque)
  const [pegando, setPegando] = useState(false)
  const [pegado, setPegado] = useState('')

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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPegando((v) => !v)}>
            {pegando ? 'Cancelar' : 'Pegar lista'}
          </button>
        )}
      </div>

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
              <tr><th>Campo de origen</th><th aria-hidden="true" /><th>Campo en SAP IBP</th><th /></tr>
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
    </div>
  )
}
