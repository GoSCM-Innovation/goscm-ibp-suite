// La franja de arriba del editor que dice si hay sugerencias de IBP y de cuál.
//
// Es información, no un obstáculo: sin IBP de destino, o con IBP caído, el formulario se llena a mano igual. Dice
// contra QUÉ tenant se sugiere porque los nombres de tabla no son iguales entre tenants: sugerir desde el
// equivocado no da un error, da un body que apunta a algo que no es.

export default function BarraIbp({ catalogo }) {
  if (!catalogo) return null

  if (catalogo.fase === 'sin-vinculo') {
    return (
      <div className="ci-ibp-barra">
        <span className="card-hint">
          Esta conexión no tiene un IBP de destino, así que no hay sugerencias de áreas, versiones, tablas ni campos.
          Se elige en Administración → Conexiones.
        </span>
      </div>
    )
  }

  if (catalogo.fase === 'cargando') {
    return <div className="ci-ibp-barra"><span className="card-hint">Leyendo IBP…</span></div>
  }

  if (catalogo.fase === 'error') {
    return (
      <div className="ci-ibp-barra ci-ibp-barra-mal" role="alert">
        <span>No se pudo leer IBP: {catalogo.error} Puedes seguir escribiendo a mano.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={catalogo.actualizar}>Reintentar</button>
      </div>
    )
  }

  return (
    <div className="ci-ibp-barra">
      <div className="ci-ibp-barra-linea">
        <span>Sugerencias de IBP: <strong>{catalogo.ibp?.nombre}</strong></span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={catalogo.actualizar} title="Volver a leer IBP">
          ↺ Actualizar
        </button>
      </div>
      {catalogo.avisos.length > 0 && (
        <ul className="ci-ibp-avisos">
          {catalogo.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
        </ul>
      )}
    </div>
  )
}
