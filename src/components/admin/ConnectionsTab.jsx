// Las conexiones a SAP de un cliente y sus acuerdos de comunicación.
//
// La contraseña se escribe aquí una vez y no vuelve a mostrarse nunca: viaja al servidor, se
// cifra y se queda ahí. Ninguna pantalla la puede recuperar, ni siquiera esta. Para cambiarla
// se escribe una nueva encima.

import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'

const ACUERDOS_CONOCIDOS = ['SAP_COM_0326', 'SAP_COM_0068', 'SAP_COM_0720', 'SAP_COM_0924']

// CI-DS no tiene acuerdos de comunicación: es un usuario y una contraseña por endpoint. Se
// guardan con este nombre fijo, que coincide con el de `core/connections`, y la pantalla no
// se lo enseña a nadie.
const ACUERDO_CIDS = 'CIDS'

export default function ConnectionsTab({ clientId }) {
  const [connections, setConnections] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  // Qué conexión se está renombrando, y con qué nombre. Lo único editable de una conexión: cambiarle
  // la dirección la convertiría en otro tenant conservando sus credenciales.
  const [renombrando, setRenombrando] = useState(null)

  const [nueva, setNueva] = useState({ kind: 'ibp', name: '', baseUrl: '', organization: '', isProduction: false })
  const [acuerdo, setAcuerdo] = useState({ agreement: 'SAP_COM_0326', sapUser: '', password: '' })

  const params = clientId ? { clientId } : undefined

  // El efecto solo lanza la petición; el estado se toca al volver la respuesta.
  useEffect(() => {
    let vivo = true
    api.get('/api/admin/connections', clientId ? { clientId } : undefined)
      .then((data) => { if (vivo) { setConnections(data.connections); setError(null) } })
      .catch((problem) => { if (vivo) setError(problem.message) })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [clientId, version])

  const recargar = () => setVersion((v) => v + 1)

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const open = (connection) => run(async () => {
    const data = await api.get('/api/admin/connections', { ...(params ?? {}), id: connection.id })
    setDetail(data.connection)
  })

  const createConnection = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post('/api/admin/connections', {
        clientId,
        kind: nueva.kind,
        name: nueva.name,
        baseUrl: nueva.baseUrl,
        organization: nueva.kind === 'cids' ? nueva.organization || null : null,
        isProduction: nueva.isProduction,
      })
      setNueva({ kind: 'ibp', name: '', baseUrl: '', organization: '', isProduction: false })
      recargar()
    })
  }

  const guardarNombre = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.patch('/api/admin/connections', {
        clientId, connectionId: renombrando.id, name: renombrando.name,
      })
      setRenombrando(null)
      recargar()
    })
  }

  const removeConnection = (connection) => run(async () => {
    await api.del('/api/admin/connections', { clientId, connectionId: connection.id })
    setDetail(null)
    recargar()
  })

  const saveAgreement = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post('/api/admin/connections', {
        clientId,
        connectionId: detail.id,
        agreement: detail.kind === 'cids' ? ACUERDO_CIDS : acuerdo.agreement,
        sapUser: acuerdo.sapUser,
        password: acuerdo.password,
      })
      setAcuerdo({ agreement: 'SAP_COM_0326', sapUser: '', password: '' })
      const data = await api.get('/api/admin/connections', { ...(params ?? {}), id: detail.id })
      setDetail(data.connection)
      recargar()
    })
  }

  const removeAgreement = (agreementId) => run(async () => {
    await api.del('/api/admin/connections', { clientId, agreementId })
    const data = await api.get('/api/admin/connections', { ...(params ?? {}), id: detail.id })
    setDetail(data.connection)
    recargar()
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <div className="card-title">Conexiones</div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Dirección</th>
                <th>Acuerdos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td className="table-empty" colSpan={5}>Cargando…</td></tr>}
              {!loading && connections.length === 0 && (
                <tr><td className="table-empty" colSpan={5}>Todavía no hay conexiones configuradas.</td></tr>
              )}
              {!loading && connections.map((connection) => (
                <tr key={connection.id} onClick={() => open(connection)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 600 }}>
                    {renombrando?.id === connection.id ? (
                      <form onSubmit={guardarNombre} style={{ display: 'flex', gap: 6 }}>
                        <input
                          className="input input-sm"
                          value={renombrando.name}
                          onChange={(e) => setRenombrando({ ...renombrando, name: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Nombre de ${connection.name}`}
                          autoFocus
                        />
                        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={(e) => { e.stopPropagation(); setRenombrando(null) }}
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : connection.name}
                    {/* Para CI-DS no se muestra: la conexión no es de pruebas ni productiva, es las
                        dos, y la marca de la fila solo confundiría. */}
                    {connection.kind !== 'cids' && connection.isProduction && (
                      <span className="tag tag-accent" style={{ marginLeft: 8 }}>Productivo</span>
                    )}
                    {connection.kind === 'cids' && (
                      <span className="tag tag-muted" style={{ marginLeft: 8 }}>Pruebas + Productivo</span>
                    )}
                  </td>
                  <td><span className="tag">{connection.kind === 'ibp' ? 'SAP IBP' : 'CI-DS'}</span></td>
                  <td className="mono" style={{ color: 'var(--text2)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {connection.baseUrl}
                  </td>
                  <td>{connection.agreementCount}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenombrando({ id: connection.id, name: connection.name })
                      }}
                    >
                      Renombrar
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      style={{ marginLeft: 6 }}
                      onClick={(e) => { e.stopPropagation(); removeConnection(connection) }}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="card">
          <div className="card-title">
            {detail.kind === 'cids' ? `Credenciales · ${detail.name}` : `Acuerdos de comunicación · ${detail.name}`}
          </div>
          <p className="card-hint" style={{ marginTop: 4 }}>
            {detail.kind === 'cids'
              ? 'El usuario con el que la Suite se identifica en CI-DS. La contraseña no se puede volver a ver: para cambiarla, se escribe una nueva.'
              : 'Cada acuerdo tiene su propio usuario de SAP. La contraseña no se puede volver a ver: para cambiarla, se escribe una nueva.'}
          </p>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  {detail.kind !== 'cids' && <th>Acuerdo</th>}
                  <th>Usuario</th><th>Actualizado</th><th />
                </tr>
              </thead>
              <tbody>
                {detail.agreements.length === 0 && (
                  <tr>
                    <td className="table-empty" colSpan={4}>
                      {detail.kind === 'cids'
                        ? 'Esta conexión todavía no tiene credenciales.'
                        : 'Esta conexión todavía no tiene acuerdos.'}
                    </td>
                  </tr>
                )}
                {detail.agreements.map((a) => (
                  <tr key={a.id}>
                    {detail.kind !== 'cids' && <td className="mono">{a.agreement}</td>}
                    <td>{a.sapUser}</td>
                    <td style={{ color: 'var(--text2)' }}>{new Date(a.updatedAt).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => removeAgreement(a.id)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={saveAgreement} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            {detail.kind !== 'cids' && (
              <div className="field" style={{ flex: '1 1 180px' }}>
                <label htmlFor="agreement">Acuerdo</label>
                <input
                  id="agreement"
                  className="input mono"
                  list="acuerdos-conocidos"
                  required
                  value={acuerdo.agreement}
                  onChange={(e) => setAcuerdo({ ...acuerdo, agreement: e.target.value.toUpperCase() })}
                />
                <datalist id="acuerdos-conocidos">
                  {ACUERDOS_CONOCIDOS.map((a) => <option key={a} value={a} />)}
                </datalist>
              </div>
            )}
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="sapUser">Usuario</label>
              <input
                id="sapUser"
                className="input"
                required
                value={acuerdo.sapUser}
                onChange={(e) => setAcuerdo({ ...acuerdo, sapUser: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="sapPassword">Contraseña</label>
              <input
                id="sapPassword"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={acuerdo.password}
                onChange={(e) => setAcuerdo({ ...acuerdo, password: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
              {detail.kind === 'cids' ? 'Guardar credenciales' : 'Guardar acuerdo'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="card-title">Nueva conexión</div>
        <form onSubmit={createConnection} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          <div className="field" style={{ flex: '0 0 140px' }}>
            <label htmlFor="kind">Tipo</label>
            <select
              id="kind"
              className="select"
              value={nueva.kind}
              onChange={(e) => setNueva({ ...nueva, kind: e.target.value })}
            >
              <option value="ibp">SAP IBP</option>
              <option value="cids">SAP CI-DS</option>
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor="connName">Nombre</label>
            <input
              id="connName"
              className="input"
              required
              placeholder="Tenant de calidad"
              value={nueva.name}
              onChange={(e) => setNueva({ ...nueva, name: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: '1 1 260px' }}>
            <label htmlFor="baseUrl">Dirección</label>
            <input
              id="baseUrl"
              className="input mono"
              required
              placeholder="https://mi-api.scmibp1.ondemand.com/"
              value={nueva.baseUrl}
              onChange={(e) => setNueva({ ...nueva, baseUrl: e.target.value })}
            />
          </div>
          {nueva.kind === 'cids' && (
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="organization">Organización</label>
              <input
                id="organization"
                className="input"
                value={nueva.organization}
                onChange={(e) => setNueva({ ...nueva, organization: e.target.value })}
              />
            </div>
          )}
          {/* Solo para IBP: allí el tenant de calidad y el productivo son direcciones distintas, así
              que hay que decir cuál es esta. En CI-DS no se pregunta porque no tiene respuesta —una
              conexión da acceso a los DOS repositorios y se elige al usarla. */}
          {nueva.kind !== 'cids' && (
            <label style={{ alignItems: 'center', alignSelf: 'flex-end', display: 'flex', gap: 7, paddingBottom: 9 }}>
              <input
                type="checkbox"
                checked={nueva.isProduction}
                onChange={(e) => setNueva({ ...nueva, isProduction: e.target.checked })}
              />
              Productivo
            </label>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
            Crear conexión
          </button>
        </form>
        <p className="card-hint" style={{ marginTop: 10 }}>
          La dirección se comprueba al guardar: si no corresponde a un tenant de SAP, no se crea.
        </p>
      </div>
    </div>
  )
}
