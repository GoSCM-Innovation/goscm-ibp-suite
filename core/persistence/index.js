// Superficie pública de core/persistence. Los handlers de api/ importan de aquí.
//
// Para datos de un cliente se usa `queryScoped` / `queryOneScoped`, no `query`: llevan la
// guarda de aislamiento. `query` queda expuesta para el panel de administración y las
// tablas que no son de nadie.

export { getSql, query, queryOne, transaction } from './postgres.js'
export {
  TENANT_SCOPED_TABLES,
  TenantScopeError,
  assertTenantScoped,
  queryScoped,
  queryOneScoped,
} from './tenant-scope.js'
export { getRedis, tenantKey, globalKey } from './redis.js'
