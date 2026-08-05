// Lo que se ve al entrar a un módulo que no está contratado.
//
// Se muestra en vez de esconder el módulo, que es una decisión de producto: si desaparece,
// el usuario no sabe que existe y nadie lo pide. Y conviene recordar que esto es solo la
// cara visible — el backend rechaza igual las llamadas a un módulo no contratado, así que
// saltarse esta pantalla no sirve de nada.

export default function ModuleLocked({ module }) {
  return (
    <div className="locked-panel">
      <div className="locked-icon">{module.icon}</div>
      <div>
        <div className="page-title">{module.name}</div>
        <p className="page-hint">{module.summary}</p>
      </div>
      <div className="notice notice-info" style={{ textAlign: 'left' }}>
        Este módulo no está incluido en la suscripción de tu empresa. Si te interesa,
        habla con tu administrador o escríbenos y lo activamos.
      </div>
      <span className="tag">🔒 No contratado</span>
    </div>
  )
}
