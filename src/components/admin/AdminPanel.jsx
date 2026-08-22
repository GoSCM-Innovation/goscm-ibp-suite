// El panel de administración.
//
// Muestra lo que cada quien puede hacer y no más: el administrador de plataforma ve la
// pestaña de clientes y puede elegir sobre cuál trabaja; el de un cliente solo ve lo suyo y
// ni siquiera se entera de que existe un selector.

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import ClientsTab from './ClientsTab.jsx'
import UsersTab from './UsersTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'

export default function AdminPanel({ user }) {
  const esPlataforma = user.isPlatformAdmin
  const [tab, setTab] = useState(esPlataforma ? 'clients' : 'users')
  const [clients, setClients] = useState([])
  // `null` hasta que vuelva la primera respuesta: sin esto la tabla afirma «todavía no hay
  // clientes» mientras está preguntando, y eso no es un dato, es un hueco.
  const [cargados, setCargados] = useState(false)
  const [clientId, setClientId] = useState(null)
  const [error, setError] = useState(null)

  const [version, setVersion] = useState(0)
  const recargarClientes = useCallback(() => setVersion((v) => v + 1), [])

  // El efecto solo lanza la petición; el estado se toca cuando vuelve la respuesta.
  useEffect(() => {
    if (!esPlataforma) return undefined
    let vivo = true
    api.get('/api/admin/clients')
      .then((data) => { if (vivo) { setClients(data.clients); setError(null) } })
      .finally(() => { if (vivo) setCargados(true) })
      .catch((problem) => { if (vivo) setError(problem.message) })
    return () => { vivo = false }
  }, [esPlataforma, version])

  const seleccionado = clients.find((c) => c.id === clientId) ?? null

  const pestañas = [
    ...(esPlataforma ? [{ id: 'clients', label: 'Clientes', icon: '🏢' }] : []),
    { id: 'users', label: 'Personas', icon: '👥' },
    { id: 'connections', label: 'Conexiones', icon: '🔌' },
  ]

  return (
    <div className="content-narrow">
      <div className="page-title">Administración</div>
      <p className="page-hint">
        {esPlataforma
          ? 'Clientes, personas, suscripciones y conexiones a SAP de toda la plataforma.'
          : 'Las personas de tu empresa y sus conexiones a SAP.'}
      </p>

      <div style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, margin: '16px 0 18px' }}>
        {pestañas.map((p) => (
          <button
            key={p.id}
            className="btn btn-ghost"
            onClick={() => setTab(p.id)}
            style={{
              borderBottom: tab === p.id ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              color: tab === p.id ? 'var(--accent)' : undefined,
              fontWeight: tab === p.id ? 600 : 500,
            }}
          >
            <span>{p.icon}</span> {p.label}
          </button>
        ))}
      </div>

      {error && <div className="notice notice-error" style={{ marginBottom: 14 }}>{error}</div>}

      {esPlataforma && tab !== 'clients' && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 14px' }}>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ color: 'var(--text2)', fontSize: 12 }}>Administrando</span>
            <select
              className="select"
              style={{ maxWidth: 280, width: 'auto' }}
              value={clientId ?? ''}
              onChange={(e) => setClientId(e.target.value || null)}
            >
              <option value="">Mi empresa ({user.email.split('@')[1]})</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {seleccionado?.status === 'suspended' && <span className="tag tag-muted">Cliente suspendido</span>}
          </div>
        </div>
      )}

      {tab === 'clients' && (
        <ClientsTab
          clients={clients}
          cargados={cargados}
          onChanged={recargarClientes}
          selectedClientId={clientId}
          onSelect={setClientId}
        />
      )}
      {/* La clave hace que al cambiar de cliente el componente empiece de cero, en vez de
          arrastrar los datos del anterior mientras llegan los nuevos. */}
      {tab === 'users' && <UsersTab key={clientId ?? 'propio'} viewer={user} clientId={clientId} />}
      {tab === 'connections' && <ConnectionsTab key={clientId ?? 'propio'} clientId={clientId} />}
    </div>
  )
}
