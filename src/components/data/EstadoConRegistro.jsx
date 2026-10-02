// La línea de estado con su «Ver logs técnicos» y el registro que despliega, como en v7.
//
// v7 tiene esto dos veces en el Network Visualizer: bajo el botón del paso ① (con una barra de
// progreso encima: `progBarViz`, `progStatusViz`, `logViz`) y en la franja que sale al cargar una red
// (`vizLoadStatusBar`, `logNet`). Es la misma cosa con y sin barra; aquí está la del paso ①, y la
// franja de la red usa solo `ListaDeRegistro`.
//
// Las líneas del registro llevan la hora delante y la clase —`info`, `ok`, `err`, `warn`— que les da
// color en `.log-area`, que es el formato de `log()` de v7.

import { horaDe } from '../../lib/registro-de-descarga.js'

/** El área del registro: una línea por anotación, con su hora. `registro` son líneas de `linea()`. */
export function ListaDeRegistro({ registro }) {
  return (
    <div className="log-area">
      {registro.map((una) => (
        <div className={una.clase} key={una.id}>{horaDe(una.cuando)} · {una.texto}</div>
      ))}
    </div>
  )
}

/** La barra, la línea de estado y el registro plegado del paso ①. */
export default function EstadoConRegistro({ porcentaje, texto, registro, abierto, onAlternar }) {
  return (
    <>
      <div className="progress-bar">
        <div className="fill" style={{ width: `${porcentaje}%` }} />
      </div>
      <div className="prog-estado">
        <span>{texto}</span>
        <button type="button" className="btn btn-secondary btn-small prog-logs-btn" onClick={onAlternar}>
          {abierto ? 'Ocultar logs' : 'Ver logs técnicos'}
        </button>
      </div>
      {abierto && <ListaDeRegistro registro={registro} />}
    </>
  )
}
