// La marca de "esta tarea ya está en producción".
//
// Aparece cuando el nombre de la tarea también existe en el tenant productivo declarado como
// contraparte de este. Es la de v9: «PRD» en verde y letra mono, con el título «Promovido a
// producción». No lleva estrella: se confundiría con la de fijar un proyecto.

export default function PromotedBadge() {
  return (
    <span className="promoted-badge" title="Promovido a producción">
      PRD
    </span>
  )
}
