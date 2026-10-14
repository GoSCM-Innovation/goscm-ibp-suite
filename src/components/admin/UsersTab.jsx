// La gente de un cliente: alta, baja y permisos.
//
// El rol de plataforma solo aparece si quien mira lo tiene: el administrador de un cliente
// no puede repartirlo, y el backend lo rechaza aunque se intente a mano.
//
// La lista va agrupada por el permiso más alto de cada persona (y las dadas de baja aparte), para que una empresa con
// mucha gente no sea una sola tabla larga. Los grupos con gente en activo empiezan abiertos; el de baja, cerrado.

import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { GRUPOS_DE_PERSONA, agrupar, grupoDePersona, resumenDeNombres } from '../../lib/admin-grupos.js'
import SeccionPlegable from '../ui/SeccionPlegable.jsx'
import { useGrupos } from './useGrupos.js'

export default function UsersTab({ viewer, clientId }) {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const grupos = useGrupos(['plataforma', 'admin', 'usuario'])
  const [altaAbierta, setAltaAbierta] = useState(false)

  // El efecto solo lanza la petición; el estado se toca cuando la respuesta vuelve. La
  // bandera `vivo` evita escribir en un componente que ya se desmontó.
  useEffect(() => {
    let vivo = true
    api.get('/api/admin/users', clientId ? { clientId } : undefined)
      .then((data) => { if (vivo) { setUsers(data.users); setError(null) } })
      .catch((problem) => { if (vivo) setError(problem.message) })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [clientId, version])

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setVersion((v) => v + 1)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const createUser = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post('/api/admin/users', { clientId, email, name: name || null })
      setEmail('')
      setName('')
      setAltaAbierta(false)
    })
  }

  const patch = (body) => run(() => api.patch('/api/admin/users', { clientId, ...body }))
  const remove = (user) => run(() => api.del('/api/admin/users', { clientId, userId: user.id }))

  const filaDe = (user) => {
    const esYo = user.id === viewer.id
    return (
      <tr key={user.id}>
        <td style={{ fontWeight: 500 }}>
          {user.email}
          {esYo && <span className="tag tag-accent" style={{ marginLeft: 8 }}>tú</span>}
        </td>
        <td>{user.name || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
        <td>
          <div style={{ display: 'flex', gap: 6 }}>
            {user.isPlatformAdmin && <span className="tag tag-accent">Plataforma</span>}
            {user.isAdmin && <span className="tag">Admin</span>}
            {!user.isAdmin && !user.isPlatformAdmin && <span className="tag tag-muted">Usuario</span>}
          </div>
        </td>
        <td style={{ color: 'var(--text2)' }}>
          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => patch({ userId: user.id, isAdmin: !user.isAdmin })}
          >
            {user.isAdmin ? 'Quitar admin' : 'Hacer admin'}
          </button>
          {viewer.isPlatformAdmin && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || esYo}
              title={esYo ? 'No puedes cambiarte a ti mismo este permiso' : undefined}
              onClick={() => patch({ userId: user.id, isPlatformAdmin: !user.isPlatformAdmin })}
            >
              {user.isPlatformAdmin ? 'Quitar plataforma' : 'Dar plataforma'}
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => patch({ userId: user.id, status: user.status === 'active' ? 'disabled' : 'active' })}
          >
            {user.status === 'active' ? 'Dar de baja' : 'Reactivar'}
          </button>
          <button
            className="btn btn-sm btn-danger"
            disabled={busy || esYo}
            title={esYo ? 'No puedes borrarte a ti mismo' : undefined}
            onClick={() => remove(user)}
          >
            Borrar
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card admin-grupos">
        <div className="card-title">Personas</div>
        <div style={{ marginTop: 10 }}>
          {loading && <p className="card-hint">Cargando…</p>}
          {!loading && agrupar(users, GRUPOS_DE_PERSONA, grupoDePersona).map((grupo) => (
            <SeccionPlegable
              key={grupo.id}
              titulo={<>{grupo.titulo} <span className="tag tag-muted">{grupo.elementos.length}</span></>}
              plegada={grupos.plegado(grupo.id)}
              onAlternar={() => grupos.alternar(grupo.id)}
              resumen={resumenDeNombres(grupo.elementos.map((uno) => uno.email))}
            >
              {grupo.elementos.length === 0 ? <p className="card-hint">No hay nadie en este grupo.</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Correo</th><th>Nombre</th><th>Permisos</th><th>Última entrada</th><th /></tr>
                    </thead>
                    <tbody>{grupo.elementos.map(filaDe)}</tbody>
                  </table>
                </div>
              )}
            </SeccionPlegable>
          ))}
        </div>
        <p className="card-hint" style={{ marginTop: 6 }}>
          Dar de baja a alguien o cambiarle los permisos cierra sus sesiones abiertas en ese
          mismo momento.
        </p>
      </div>

      <SeccionPlegable
        titulo="+ Dar de alta"
        plegada={!altaAbierta}
        onAlternar={() => setAltaAbierta((v) => !v)}
        resumen="Solo hace falta el correo"
      >
        <p className="card-hint">
          La persona entra pidiendo un código; no hay contraseña que crear ni entregar.
        </p>
        <form onSubmit={createUser} style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="userEmail">Correo</label>
            <input
              id="userEmail"
              className="input"
              type="email"
              required
              value={email}
              placeholder="nombre@empresa.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="userName">Nombre</label>
            <input id="userName" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !email} style={{ alignSelf: 'flex-end' }}>
            Dar de alta
          </button>
        </form>
      </SeccionPlegable>
    </div>
  )
}
