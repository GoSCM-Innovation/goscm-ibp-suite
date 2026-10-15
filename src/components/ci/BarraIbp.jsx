// Lo que se dice del IBP de destino en el editor, en dos piezas.
//
//   - `BarraIbp`: el estado en UNA línea, para ponerla a la derecha de las pestañas «Formulario / JSON» y no gastar una fila
//     entera: de qué IBP salen las sugerencias, con «Actualizar»; «Leyendo IBP…»; sin IBP de destino; o «IBP no disponible»
//     con «Reintentar».
//   - `DetalleDeIbp`: lo que no cabe en una línea y hay que leer entero: por qué no se pudo leer IBP y los avisos de los
//     servicios que no contestaron.
//
// Es información, no un obstáculo: sin IBP de destino, o con IBP caído, el formulario se llena a mano igual. Dice contra QUÉ
// tenant se sugiere porque los nombres de tabla no son iguales entre tenants: sugerir desde el equivocado no da un error,
// da un body que apunta a algo que no es.

export default function BarraIbp({ catalogo }) {
  if (!catalogo) return null

  if (catalogo.fase === 'sin-vinculo') {
    return (
      <span
        className="ci-ibp-estado"
        title="Esta conexión no tiene un IBP de destino, así que no hay sugerencias de áreas, versiones, tablas ni campos. Se elige en Administración → Conexiones, abriendo la conexión."
      >
        Sin IBP de destino (se elige en Administración → Conexiones)
      </span>
    )
  }

  if (catalogo.fase === 'cargando') return <span className="ci-ibp-estado">Leyendo IBP…</span>

  if (catalogo.fase === 'error') {
    return (
      <span className="ci-ibp-estado ci-ibp-estado-mal">
        IBP no disponible
        <button type="button" className="btn btn-ghost btn-sm" onClick={catalogo.actualizar}>Reintentar</button>
      </span>
    )
  }

  return (
    <span className="ci-ibp-estado">
      Sugerencias de IBP: <strong>{catalogo.ibp?.nombre}</strong>
      <button type="button" className="btn btn-ghost btn-sm" onClick={catalogo.actualizar} title="Volver a leer IBP">
        ↺ Actualizar
      </button>
    </span>
  )
}

/** El motivo de un fallo y los avisos de los servicios que no contestaron. Nada si todo va bien. */
export function DetalleDeIbp({ catalogo }) {
  if (!catalogo) return null

  if (catalogo.fase === 'error') {
    return (
      <div className="ci-ibp-barra ci-ibp-barra-mal" role="alert">
        <span>No se pudo leer IBP: {catalogo.error} Puedes seguir escribiendo a mano.</span>
      </div>
    )
  }

  if (catalogo.fase === 'listo' && catalogo.avisos.length > 0) {
    return (
      <div className="ci-ibp-barra">
        <ul className="ci-ibp-avisos">
          {catalogo.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
        </ul>
      </div>
    )
  }

  return null
}
