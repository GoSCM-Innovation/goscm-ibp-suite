// La marca de "esta tarea ya está en producción".
//
// Aparece cuando el nombre de la tarea también existe en el tenant productivo declarado como
// contraparte de este. Lleva título explicando qué significa: una estrella sin explicación se
// interpreta como "favorita", que es justo lo contrario de lo que dice.

export default function PromotedBadge() {
  return (
    <span
      className="promoted-badge"
      title="Esta tarea también existe en el tenant productivo: ya está transportada"
    >
      ★ PRD
    </span>
  )
}
