import { useState, useEffect, useRef, useCallback } from 'react'
import katex from 'katex'

declare global {
  interface Window {
    electronAPI: {
      platform: string
      minimize: () => void
      close: () => void
      captureScreen: () => Promise<string | null>
      openUrl: (url: string) => void
      onTriggerScreenshot: (cb: () => void) => void
    }
  }
}

const API_BASE = 'https://snappier-web.vercel.app'

interface HistoryItem {
  id: number
  question: string
  answer: string
  ts: number
}

// ── Render markdown-ish answer with KaTeX math and Mermaid diagrams ──────────
function renderMath(text: string): string {
  // display math $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    try {
      return `<div class="katex-display">${katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`
    } catch { return `$$${expr}$$` }
  })
  // inline math $...$
  text = text.replace(/\$([^\n$]+?)\$/g, (_, expr) => {
    try {
      return katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })
    } catch { return `$${expr}$` }
  })
  return text
}

function renderMarkdown(raw: string): string {
  let html = raw

  // extract mermaid blocks before other processing
  const mermaidBlocks: string[] = []
  html = html.replace(/```mermaid\n([\s\S]+?)```/g, (_, code) => {
    const idx = mermaidBlocks.length
    mermaidBlocks.push(code.trim())
    return `__MERMAID_${idx}__`
  })

  // code blocks
  html = html.replace(/```[\w]*\n?([\s\S]+?)```/g, (_, code) =>
    `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)

  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // math
  html = renderMath(html)

  // lists
  html = html.replace(/((?:^[\-\*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[\-\*] /, '')}</li>`).join('')
    return `<ul>${items}</ul>`
  })
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')
    return `<ol>${items}</ol>`
  })

  // paragraphs — wrap lines not already in block elements
  html = html.split('\n\n').map(block => {
    const trimmed = block.trim()
    if (!trimmed) return ''
    if (/^<(h[1-6]|ul|ol|pre|div)/.test(trimmed)) return trimmed
    return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`
  }).join('\n')

  // restore mermaid blocks
  mermaidBlocks.forEach((code, idx) => {
    const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    html = html.replace(
      `__MERMAID_${idx}__`,
      `<div class="mermaid-wrap"><pre style="font-family:monospace;font-size:12px;color:#5b21b6">📊 Diagram:\n${escaped}</pre></div>`
    )
  })

  return html
}

function AnswerBody({ text }: { text: string }) {
  const html = renderMarkdown(text)
  return <div className="answer-body" dangerouslySetInnerHTML={{ __html: html }} />
}

// ── Auth screen ──────────────────────────────────────────────────────────────
type AuthMode = 'login' | 'register' | 'forgot'

function AuthScreen({ onAuth, onGemini }: { onAuth: (token: string, name: string, credits: number) => void; onGemini: () => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')

    try {
      if (mode === 'forgot') {
        await fetch(`${API_BASE}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        setSuccess('If that email exists, a reset link has been sent.')
        setLoading(false); return
      }

      const endpoint = mode === 'login' ? '/api/auth/desktop-login' : '/api/auth/register'
      const body = mode === 'register' ? { name, email, password } : { email, password }
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'not_subscribed') {
          setError('No active subscription. Visit snappier.net to subscribe, then sign in.')
        } else {
          setError(data.error ?? 'Something went wrong')
        }
      } else if (mode === 'register') {
        setSuccess('Account created! Check your email to verify, then sign in.')
        setMode('login')
      } else {
        const credits = data.subscription?.credits ?? 0
        localStorage.setItem('snappier_token', data.token)
        localStorage.setItem('snappier_name', data.user?.name ?? email)
        localStorage.setItem('snappier_credits', String(credits))
        onAuth(data.token, data.user?.name ?? email, credits)
      }
    } catch {
      setError('Could not connect. Check your internet connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-title">⚡ Snappier</div>
        <div className="auth-sub">
          {mode === 'login' && 'Sign in to your account'}
          {mode === 'register' && 'Create your free account'}
          {mode === 'forgot' && 'Reset your password'}
        </div>

        {error && <div className="error-box">{error}</div>}
        {success && <div className="success-box">{success}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          {mode !== 'forgot' && (
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'Min 8 characters' : 'Password'} required minLength={mode === 'register' ? 8 : 1} />
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        <div style={{ margin: '14px 0 4px', borderTop: '1px solid var(--border)', paddingTop: 14, textAlign: 'center' }}>
          <button
            type="button"
            onClick={onGemini}
            style={{ background: '#ecfdf5', color: '#065f46', border: '1.5px solid #6ee7b7', borderRadius: 12, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', width: '100%' }}
          >
            🆓 Use free Gemini key instead
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 6 }}>No account needed · get a key at aistudio.google.com</div>
        </div>

        <div className="auth-link" style={{ marginTop: 10 }}>
          {mode === 'login' && <>
            <a href="#" onClick={() => { setMode('register'); setError(''); setSuccess('') }}>Create account</a>
            {' · '}
            <a href="#" onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}>Forgot password?</a>
          </>}
          {mode === 'register' && <>
            Already have one?{' '}
            <a href="#" onClick={() => { setMode('login'); setError(''); setSuccess('') }}>Sign in</a>
          </>}
          {mode === 'forgot' && <>
            <a href="#" onClick={() => { setMode('login'); setError(''); setSuccess('') }}>Back to sign in</a>
          </>}
        </div>
      </div>
    </div>
  )
}

// ── Settings panel ────────────────────────────────────────────────────────────
function SettingsPanel({ geminiKey, onSave, onClose }: {
  geminiKey: string
  onSave: (key: string) => void
  onClose: () => void
}) {
  const [key, setKey] = useState(geminiKey)

  function save() {
    onSave(key.trim())
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-panel">
        <div className="settings-title">⚙️ Settings</div>
        <div className="settings-sub">
          Add your free Gemini API key to use Snappier without a subscription.
          Get one at <a href="#" onClick={() => window.electronAPI.openUrl('https://aistudio.google.com/app/apikey')} style={{ color: 'var(--purple)', fontWeight: 600 }}>aistudio.google.com</a>
        </div>

        <div className="settings-section">Gemini API key (free)</div>
        <div className="field">
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="AIzaSy..."
          />
        </div>
        {key && (
          <div className="success-box" style={{ fontSize: 12 }}>
            ✅ Gemini key saved — screenshots will use your free Gemini quota.
          </div>
        )}

        <div className="settings-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Gemini API call (client-side, student's own key) ─────────────────────────
async function callGemini(apiKey: string, imageData: string, onChunk: (t: string) => void): Promise<string> {
  const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')
  const mimeType = imageData.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'

  const SYSTEM = "You are Snappier, a friendly AI tutor for students. Look at the screenshot and answer whatever question or problem you see. For math, use LaTeX notation: inline with $...$ and display with $$...$$. For diagrams that would help, use Mermaid code blocks. Keep answers clear and encouraging. Respond with exactly [skip] ONLY if there is no question visible at all."

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{
          role: 'user',
          parts: [
            { text: 'Please answer the question visible in this screenshot.' },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 1500 },
      }),
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText
    console.error('[snappier] Gemini error:', res.status, msg)
    if (res.status === 429) throw new Error('quota_exceeded')
    throw new Error(msg)
  }

  const data = await res.json()
  console.log('[snappier] Gemini response:', JSON.stringify(data).slice(0, 200))
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (text) onChunk(text)
  return text
}

// ── Backend API call (subscription) ──────────────────────────────────────────
async function callBackend(token: string, imageData: string, onChunk: (t: string) => void): Promise<string> {
  const res = await fetch(`${API_BASE}/api/snappier/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageData }),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('not_subscribed')
    throw new Error('request_failed')
  }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    for (const line of dec.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue
      const d = line.slice(6).trim(); if (d === '[DONE]') break
      try { const t = JSON.parse(d).choices?.[0]?.delta?.content ?? ''; if (t) { full += t; onChunk(full) } } catch { /* partial */ }
    }
  }
  return full
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('snappier_token') ?? '')
  const [userName, setUserName] = useState(() => localStorage.getItem('snappier_name') ?? '')
  const [credits, setCredits] = useState(() => parseInt(localStorage.getItem('snappier_credits') ?? '0'))
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('snappier_gemini_key') ?? '')
  const [showLogin, setShowLogin] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('snappier_history') ?? '[]')
    } catch { return [] }
  })
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const idCounter = useRef(0)
  const screenshotHandlerRef = useRef<() => void>(() => {})

  const isLoggedIn = Boolean(token)
  const hasGemini = Boolean(geminiKey)

  function handleAuth(t: string, name: string, cr: number) {
    setToken(t); setUserName(name); setCredits(cr)
  }

  function signOut() {
    localStorage.removeItem('snappier_token')
    localStorage.removeItem('snappier_name')
    localStorage.removeItem('snappier_credits')
    setToken(''); setUserName(''); setCredits(0)
  }

  function saveGeminiKey(key: string) {
    setGeminiKey(key)
    if (key) localStorage.setItem('snappier_gemini_key', key)
    else localStorage.removeItem('snappier_gemini_key')
  }

  const handleScreenshot = useCallback(async () => {
    if (loading) return
    if (!isLoggedIn && !hasGemini) { setStatus('Sign in or add a Gemini key first'); setTimeout(() => setStatus(''), 2500); return }

    setLoading(true)
    setStatus('Capturing…')
    console.log('[snappier] capturing screen, hasGemini:', hasGemini, 'isLoggedIn:', isLoggedIn)

    try {
      const imageData = await window.electronAPI.captureScreen()
      console.log('[snappier] captureScreen result:', imageData ? imageData.slice(0, 40) : imageData)

      if (imageData === '__permission_denied__') {
        setStatus('Screen Recording denied — enable in System Settings > Privacy & Security')
        setTimeout(() => setStatus(''), 6000)
        setLoading(false); return
      }
      if (!imageData || imageData === '__needs_permission__') {
        setStatus('Allow Screen Recording in System Settings, then try again')
        setTimeout(() => setStatus(''), 5000)
        setLoading(false); return
      }

      setStatus('Thinking…')
      const id = ++idCounter.current
      setHistory(prev => [{ id, question: '📸 Screenshot', answer: '', ts: Date.now() }, ...prev.slice(0, 19)])

      let full = ''
      const onChunk = (text: string) => {
        full = text
        setHistory(prev => prev.map(item => item.id === id ? { ...item, answer: text } : item))
      }

      try {
        if (hasGemini) {
          full = await callGemini(geminiKey, imageData, onChunk)
        } else {
          full = await callBackend(token, imageData, onChunk)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'error'

        if (msg === 'quota_exceeded' && isLoggedIn) {
          // Gemini quota hit — try subscription backend
          setStatus('Gemini quota reached — using subscription…')
          try {
            full = await callBackend(token, imageData, onChunk)
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : 'error'
            if (msg2 === 'not_subscribed') {
              setHistory(prev => prev.filter(item => item.id !== id))
              setStatus('Gemini quota used up. Subscribe at snappier.net to continue.')
              setTimeout(() => setStatus(''), 6000)
              setLoading(false); return
            }
            throw err2
          }
        } else if (msg === 'not_subscribed') {
          setHistory(prev => prev.filter(item => item.id !== id))
          setStatus('Subscription required — visit snappier.net')
          setTimeout(() => setStatus(''), 5000)
          setLoading(false); return
        } else if (msg === 'quota_exceeded') {
          setHistory(prev => prev.filter(item => item.id !== id))
          setStatus('Gemini quota used up for today. Add your API key or subscribe at snappier.net.')
          setTimeout(() => setStatus(''), 6000)
          setLoading(false); return
        } else {
          throw err
        }
      }

      if (!full || full.trim().toLowerCase() === '[skip]') {
        setHistory(prev => prev.filter(item => item.id !== id))
        setStatus('No question found — open a question on screen first, then snap')
        setTimeout(() => setStatus(''), 4000)
      } else {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, answer: full } : item))
        setStatus('')
      }
    } catch (e) {
      setHistory(prev => prev.filter(item => item.answer !== ''))
      setStatus('⚠ ' + (e instanceof Error ? e.message : 'Unknown error'))
      setTimeout(() => setStatus(''), 3000)
    }

    setLoading(false)
  }, [loading, isLoggedIn, hasGemini, token, geminiKey])

  useEffect(() => { screenshotHandlerRef.current = handleScreenshot }, [handleScreenshot])

  useEffect(() => {
    window.electronAPI.onTriggerScreenshot(() => screenshotHandlerRef.current())
  }, [])

  useEffect(() => {
    if (history.length > 0)
      localStorage.setItem('snappier_history', JSON.stringify(history.slice(0, 20)))
  }, [history])

  const isMac = window.electronAPI?.platform === 'darwin'
  const shortcut = isMac ? '⌘⌥S' : 'Ctrl+Alt+S'

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <span className="titlebar-logo">⚡ Snappier</span>
        <div className="titlebar-actions">
          {isLoggedIn && (
            <button className="win-btn" onClick={signOut} title="Sign out">↩</button>
          )}
          <button className="win-btn" onClick={() => window.electronAPI.minimize()} title="Minimise">−</button>
          <button className="win-btn close" onClick={() => window.electronAPI.close()} title="Close">✕</button>
        </div>
      </div>

      {!isLoggedIn && !hasGemini ? (
        <AuthScreen onAuth={handleAuth} onGemini={() => setShowSettings(true)} />
      ) : (
        <div className="main-wrap">
          {/* Toolbar */}
          <div className="toolbar">
            <button
              className={`snap-btn${loading ? ' loading' : ''}`}
              onClick={handleScreenshot}
              disabled={loading}
            >
              {loading ? '⏳' : '📸'} {loading ? 'Analyzing…' : 'Snap & Ask'}
            </button>

            {hasGemini && <span className="status-chip gemini">🆓 Gemini</span>}
            {!hasGemini && isLoggedIn && <span className="status-chip">✅ Subscribed</span>}

            {history.length > 0 && (
              <button
                className="icon-btn"
                onClick={() => { setHistory([]); localStorage.removeItem('snappier_history') }}
                style={{ fontSize: 12, width: 'auto', padding: '0 10px', color: '#dc2626' }}
              >Clear</button>
            )}

            <div className="toolbar-right">
              <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
              {!isLoggedIn && (
                <button
                  className="icon-btn"
                  style={{ fontSize: 12, width: 'auto', padding: '0 10px' }}
                  onClick={() => setShowLogin(true)}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>

          {/* Answer feed */}
          <div className="feed">
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📸</div>
                <div className="empty-title">Ready to help!</div>
                <div className="empty-hint">
                  See a question on your screen? Press the button or use the shortcut:
                </div>
                <div className="shortcut-badge">{shortcut}</div>
                <div className="empty-hint" style={{ marginTop: 8 }}>
                  Works with math, science, coding, history — anything!
                </div>
              </div>
            ) : (
              history.map((item, i) => (
                <div key={item.id} className={`answer-card${i === 0 ? ' latest' : ''}`}>
                  <div className="answer-label">📸 Question from screenshot</div>
                  {item.answer ? (
                    <AnswerBody text={item.answer} />
                  ) : (
                    <div className="answer-body" style={{ color: 'var(--text-soft)', fontStyle: 'italic' }}>Thinking…</div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Status bar */}
          <div className="statusbar">
            <span>{userName ? `Hi ${userName}! 👋` : 'Ready'}</span>
            <span className="hotkey">{shortcut}</span>
          </div>
        </div>
      )}

      {/* Auth prompt when logged out but has Gemini key */}
      {showLogin && (
        <div className="settings-overlay" onClick={e => { if (e.target === e.currentTarget) setShowLogin(false) }}>
          <div style={{ width: '100%', maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'right', marginBottom: 8 }}>
              <button onClick={() => setShowLogin(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', fontWeight: 700 }}>✕</button>
            </div>
            <AuthScreen onAuth={(t, n, c) => { handleAuth(t, n, c); setShowLogin(false) }} onGemini={() => { setShowLogin(false); setShowSettings(true) }} />
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          geminiKey={geminiKey}
          onSave={saveGeminiKey}
          onClose={() => setShowSettings(false)}
        />
      )}

      {status && <div className="toast">{status}</div>}
    </div>
  )
}
