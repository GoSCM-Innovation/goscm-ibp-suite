// Los pasos del avance de cada modo del documentador, tal cual `STEPPER_STEPS` de v9.
//
// Están aparte del componente para poder probarlos y porque React Refresh no deja exportar
// constantes desde un archivo de componentes.

export const PASOS_DEL_MODO = {
  zip: ['Subir ZIPs', 'ATL opcional', 'Seleccionar', 'Generar Excel'],
  jobs: ['Obtener Jobs', 'Seleccionar', 'Generar Excel'],
  zipjobs: ['Subir ZIPs', 'Analizar', 'Seleccionar', 'Generar Excel'],
}
