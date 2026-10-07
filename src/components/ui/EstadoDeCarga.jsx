// El aviso de que algo se está cargando: un giro y una frase que dice QUÉ.
//
// Pedido el 2026-10-06: cuando se pulsa «Actualizar» (o cualquier acción que habla con SAP) corre un
// proceso que dura segundos y la pantalla no decía nada. Un botón apagado no explica nada; esto sí.
//
// `role="status"` hace que un lector de pantalla anuncie la frase sin robar el foco.

export default function EstadoDeCarga({ mensaje, className = '', style }) {
  return (
    <span className={`estado-de-carga ${className}`.trim()} role="status" aria-live="polite" style={style}>
      <span className="estado-de-carga-giro" aria-hidden="true" />
      <span>{mensaje}</span>
    </span>
  )
}
