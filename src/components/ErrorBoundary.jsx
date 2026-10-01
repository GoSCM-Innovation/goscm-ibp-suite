// La red de seguridad de la aplicación: si una pantalla se rompe al dibujarse, se dice y se ofrece
// recargar, en vez de dejar la página en blanco.
//
// Sin esto, un error al dibujar desmonta TODO el árbol de React y quien mira solo ve el fondo vacío,
// sin cabecera ni menú ni una pista de qué pasó. Pasó de verdad: tras un despliegue, una pestaña
// abierta de antes pedía un archivo de la versión anterior que ya no existe y se quedaba en blanco.

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { fallo: null }

  static getDerivedStateFromError(fallo) {
    return { fallo }
  }

  componentDidCatch(fallo) {
    console.error('[ErrorBoundary]', fallo)
  }

  render() {
    if (!this.state.fallo) return this.props.children

    return (
      <div style={{ margin: '12vh auto', maxWidth: 460, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Algo no se pudo mostrar</div>
        <p style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
          Lo más común es que haya una versión nueva de la aplicación y esta pestaña siga con la
          anterior. Recargar lo arregla casi siempre.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Recargar
        </button>
        <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 16, wordBreak: 'break-word' }}>
          {String(this.state.fallo?.message ?? this.state.fallo)}
        </div>
      </div>
    )
  }
}
