// Superficie pública de core/odata: cómo se le pregunta a SAP.
//
// Las reglas medidas contra tenants reales están dentro de estas funciones, no en la
// documentación. Quien las use no puede saltárselas sin querer.

export {
  andFilters,
  assertNoSilentPredicate,
  buildConditionFilter,
  escapeText,
  literal,
  nonZero,
  notBlank,
  splitValues,
} from './filter.js'

export { SERVICES, buildQuery, buildReadUrl } from './query.js'

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_PAGE_SIZE,
  PARALLEL_READS,
  PARALLEL_WRITES,
  READ_BYTE_BUDGET,
  WRITE_BYTE_BUDGET,
  chunkSizeFor,
  chunkSizeForBytes,
  pageSizeFor,
  pageSizeForBytes,
  readBytesPerRow,
  writeBytesPerRow,
} from './page-size.js'

export { DEFAULT_RETRIES, createReader } from './reader.js'

export {
  PLANNING_COUNT_TOP,
  countRows,
  extractInlineCount,
  extractNextLink,
  extractRows,
  readAllRows,
  readAllRowsConcurrently,
  readPages,
} from './paginate.js'
