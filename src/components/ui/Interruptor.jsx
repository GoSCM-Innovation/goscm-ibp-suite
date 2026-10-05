// El interruptor de pastilla con perilla de v9 (`.ex-toggle-switch`).
//
// En v9 los filtros del Integration Explorer («Solo transportadas», «Solo en IBP», «Solo con script»…)
// eran este interruptor, con su texto a la izquierda, y no una casilla. Se respeta esa forma.
//
// Es un `<label>` con un `<input type=checkbox>` dentro, escondido pero accesible: así se activa con el
// teclado y con lector de pantalla sin escribir nada de manejo de teclas.

export default function Interruptor({ activo, onCambiar, titulo, children }) {
  return (
    <label className="interruptor" title={titulo}>
      <span className="interruptor-texto">{children}</span>
      <input
        type="checkbox"
        className="interruptor-input"
        checked={activo}
        onChange={(evento) => onCambiar(evento.target.checked)}
      />
      <span className={`interruptor-pastilla${activo ? ' on' : ''}`} aria-hidden="true">
        <span className="interruptor-perilla" />
      </span>
    </label>
  )
}
