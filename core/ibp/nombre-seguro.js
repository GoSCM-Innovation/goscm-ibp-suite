// Un nombre de entidad o de campo de OData que se puede poner en una URL sin que arme otra consulta.
//
// El nombre de la entidad se pega en la ruta (`…/${entidad}Trans`) y el de un campo en el `$select` o el
// `$filter`. Con un `/`, un `?`, un `&` o un `..` quien lo manda cambiaría a qué servicio o con qué
// parámetros se llama a SAP usando las credenciales de la conexión. Un nombre real es letras, números y
// guion bajo, y nada más.

const NOMBRE_SEGURO = /^[A-Za-z0-9_]+$/

/** Si `valor` es un texto con un nombre de OData válido. */
export const esNombreSeguro = (valor) => typeof valor === 'string' && NOMBRE_SEGURO.test(valor)
