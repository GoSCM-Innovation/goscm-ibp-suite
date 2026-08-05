// Pantalla de ingreso: correo, código de un solo uso, dentro.
//
// La respuesta del servidor es la misma exista o no el correo, así que esta pantalla tampoco
// puede distinguirlo — y por eso el mensaje que se muestra es deliberadamente vago. Es lo que
// impide usar el ingreso para averiguar quién es cliente.

import { useRef, useState } from 'react'
import { api } from '../lib/api.js'

export default function Login({ onSignedIn }) {
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const codeInput = useRef(null)

  async function requestCode(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/request-code', { email })
      setStep('code')
      setTimeout(() => codeInput.current?.focus(), 50)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await api.post('/api/auth/verify-code', { email, code })
      onSignedIn(session)
    } catch (problem) {
      setError(problem.message)
      setCode('')
      codeInput.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ alignItems: 'center', display: 'flex', gap: 10, marginBottom: 22 }}>
          <span className="header-brand-mark">GS</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Suite IBP</div>
            <div style={{ color: 'var(--text3)', fontSize: 11 }}>GoSCM</div>
          </div>
        </div>

        {step === 'email' ? (
          <form onSubmit={requestCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="email">Correo</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.com"
              />
            </div>
            <p className="card-hint">
              Te enviaremos un código de 6 dígitos. No hay contraseña que recordar.
            </p>
            {error && <div className="notice notice-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={busy || !email}>
              {busy ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="code">Código</label>
              <input
                id="code"
                ref={codeInput}
                className="input code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="······"
              />
            </div>
            <p className="card-hint">
              Si <strong>{email}</strong> está dado de alta, el código llegará en unos segundos.
              Vence a los 10 minutos y sirve una sola vez.
            </p>
            {error && <div className="notice notice-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Comprobando…' : 'Entrar'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError(null) }}
            >
              Usar otro correo
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
