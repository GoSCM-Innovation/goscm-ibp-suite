// La dirección del launchpad de SAP IBP, deducida de la de su API.
//
// Portado de `utils/sapUrl.js` de v8. Es lo que hace funcionar el enlace «Abrir en SAP IBP ↗» de la
// cabecera de la conexión: un tenant expone su API en `my400439-api.scmibp.ondemand.com` y su Fiori
// en `my400439.scmibp.ondemand.com`, y la única diferencia es el `-api`.
//
// Devuelve `null` cuando el patrón no encaja, y entonces el enlace no se dibuja. Es deliberado: un
// enlace que lleva a ninguna parte es peor que no tenerlo, y hay tenants con dominios propios donde
// esta deducción no vale.

/** El sufijo que distingue la dirección de la API de la del launchpad. */
const API_EN_EL_HOST = /-api\.scmibp(\d*)\./

/** La dirección del launchpad, o `null` si no se puede deducir de esta. */
export function urlDeSap(baseUrl) {
  if (!baseUrl) return null
  try {
    const { protocol, hostname } = new URL(baseUrl)
    const suyo = hostname.replace(API_EN_EL_HOST, '.scmibp$1.')
    if (suyo === hostname) return null
    return `${protocol}//${suyo}`
  } catch {
    return null
  }
}
