// Lo que no cuadra entre un body y lo que IBP tiene: un área o un campo que no existen, una tabla que no se puede
// cargar en esa versión.
//
// Son AVISOS. No impiden guardar ni ejecutar: IBP puede cambiar entre que se lee y que se carga, y un nombre que hoy
// no está puede ser justo lo que otro paso de una orquestación crea. La decisión es de quien configura la carga.

export default function RevisionIbp({ avisos }) {
  if (!avisos || avisos.length === 0) return null
  return (
    <div className="ci-revision" role="status">
      <strong>Revisión contra IBP</strong>
      <span className="card-hint"> · {avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}, no impiden guardar ni ejecutar</span>
      <ul>
        {avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
      </ul>
    </div>
  )
}
