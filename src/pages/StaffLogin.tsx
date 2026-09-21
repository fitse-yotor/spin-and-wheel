import { useState, type FormEvent } from 'react'
import { ApiError, login, logout, type User } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Area = 'cashier' | 'admin'
const COPY = {
  cashier: { title: 'CASHIER', sub: 'Sign in to sell and pay tickets at this terminal.', roles: ['CASHIER'], other: '/admin', otherLabel: 'Back office sign-in' },
  admin: { title: 'BACK OFFICE', sub: 'Administrators and shop managers.', roles: ['ADMIN', 'MANAGER'], other: '/cashier', otherLabel: 'Cashier terminal sign-in' },
} as const
const DEMO: Record<Area, [string, string, string][]> = {
  cashier: [['Cashier, Bole 01', 'cashier.bole1', 'cashier1234'], ['Cashier, Megenagna 01', 'cashier.meg1', 'cashier1234']],
  admin: [['Administrator', 'admin', 'admin1234'], ['Manager, Bole 01', 'manager.bole', 'manager1234']],
}

/** Sign-in for a staff area. The customer game screen (/) never shows this. */
export default function StaffLogin({ area }: { area: Area }) {
  const auth = useAuth()
  const c = COPY[area]
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const u: User = await login(username, password)
      if (!(c.roles as readonly string[]).includes(u.role)) {
        await logout()
        setError(area === 'cashier' ? 'This account is not a cashier. Managers and administrators sign in at /admin.' : 'This account is a cashier. Cashiers sign in at /cashier.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'NETWORK' ? 'Cannot reach the game server. Check the network and try again.' : err.message) : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const light = area === 'cashier'
  return (
    <div className={`flex min-h-full items-center justify-center p-6 ${light ? 'cashier bg-[#d9d9d9]' : 'bg-paper text-ink'}`}>
      <div className="w-full max-w-[26rem] overflow-hidden rounded-md bg-white shadow-lg">
        <div className="px-6 py-5 text-white" style={{ background: light ? '#0f2a5c' : '#16191e' }}>
          <div className="text-[0.7rem] font-bold tracking-[0.3em] text-[#ffd34d]">SPIN &amp; WHEEL</div>
          <h1 className="text-3xl font-light tracking-[0.2em]">{c.title}</h1>
          <p className="mt-1 text-sm text-white/70">{c.sub}</p>
        </div>
        {auth && !(c.roles as readonly string[]).includes(auth.user.role) ? (
          <div className="space-y-4 p-6 text-[#1e1e1e]">
            <p className="text-sm">You are signed in as <b>{auth.user.fullName}</b> ({auth.user.role.toLowerCase()}), which cannot use this area.</p>
            <button onClick={() => logout()} className="w-full rounded bg-[#1e1e1e] py-3 font-bold text-white">Sign out</button>
            <a href={auth.user.role === 'CASHIER' ? '/cashier' : '/admin'} className="block text-center text-sm underline">Go to {auth.user.role === 'CASHIER' ? 'the cashier terminal' : 'the back office'}</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-6 text-[#1e1e1e]">
            <label className="block">
              <span className="mb-1 block text-xs font-bold tracking-widest text-[#666]">USERNAME</span>
              <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded border border-[#bbb] bg-white px-3 py-2.5 text-lg outline-none focus:border-[#0f2a5c]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold tracking-widest text-[#666]">PASSWORD</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border border-[#bbb] bg-white px-3 py-2.5 text-lg outline-none focus:border-[#0f2a5c]" />
            </label>
            {error && <div role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
            <button disabled={busy || !username || !password} className="w-full rounded py-3 text-lg font-bold tracking-wide text-white disabled:opacity-40" style={{ background: light ? '#a5262a' : '#16191e' }}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button>
            <p className="text-center text-xs text-[#777]">Activity is logged with your device and IP address.</p>
            {import.meta.env.DEV && (
              <div className="rounded border border-dashed border-[#bbb] p-3 text-xs text-[#666]">
                <div className="mb-1 font-bold tracking-widest">DEMO ACCOUNTS (development only)</div>
                {DEMO[area].map(([label, u, p]) => (
                  <button key={u} type="button" onClick={() => { setUsername(u); setPassword(p) }} className="flex w-full justify-between py-0.5 text-left hover:text-black">
                    <span>{label}</span><span className="font-mono">{u}</span>
                  </button>
                ))}
              </div>
            )}
            <a href={c.other} className="block text-center text-xs text-[#777] underline">{c.otherLabel}</a>
          </form>
        )}
      </div>
    </div>
  )
}
