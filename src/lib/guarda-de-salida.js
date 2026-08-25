// Impedir que una copia en marcha se pierda al salir de la pantalla.
//
// Portado de `services/migrationGuard.js` + el `beforeunload` de `Migration.jsx` de v8. Existe porque
// las dos copias —dato maestro y cifras clave— las encadena EL NAVEGADOR: la pantalla pide un segmento,
// espera, pide el siguiente. Si alguien cambia de módulo, cierra la pestaña o pulsa «Salir» a mitad, la
// cadena se corta ahí. Lo ya confirmado en SAP se queda, pero el resto no se copia y nadie lo dice.
//
// Son dos salidas distintas y hacen falta las dos:
//
//   - **Cerrar o recargar la pestaña**: solo el navegador puede preguntar, con `beforeunload`. El texto
//     lo pone él; el nuestro no se puede elegir, y por eso no se intenta.
//   - **Navegar dentro de la aplicación**: eso no dispara `beforeunload`, así que hay que preguntar
//     nosotros. El armazón consulta `puedeSalir()` antes de cambiar de módulo o de cerrar la sesión.
//
// El registro vive FUERA de React a propósito, igual que en v8: el armazón y la pantalla que copia no
// se conocen, y pasarse el aviso por props obligaría a atravesar cuatro componentes que no tienen nada
// que ver.

import { useEffect } from 'react'

/** La guarda activa, si hay alguna. Solo una a la vez: solo se puede estar en una pantalla. */
let activa = null

/**
 * Si se puede salir. Cuando hay una copia en marcha, pregunta.
 *
 * Devuelve `true` si no hay nada que proteger o si la persona confirma. Quien llama NO debe navegar
 * si devuelve `false`.
 */
export function puedeSalir() {
  if (!activa) return true
  return window.confirm(activa)
}

/** Para las pruebas y para el desmontaje: deja el registro limpio. */
export const olvidarGuarda = () => { activa = null }

/**
 * Avisa antes de salir mientras `enCurso` sea cierto.
 *
 * `mensaje` es el que se le muestra a la persona al navegar dentro de la aplicación. Tiene que decir
 * qué se pierde, no solo que algo se pierde: «se cancelará» a secas no dice si lo ya copiado se queda.
 */
export function useGuardaDeSalida(enCurso, mensaje) {
  useEffect(() => {
    if (!enCurso) return undefined

    activa = mensaje
    // `preventDefault` y `returnValue` porque los navegadores no coinciden en cuál miran.
    const alCerrar = (evento) => { evento.preventDefault(); evento.returnValue = '' }
    window.addEventListener('beforeunload', alCerrar)

    return () => {
      activa = null
      window.removeEventListener('beforeunload', alCerrar)
    }
  }, [enCurso, mensaje])
}
