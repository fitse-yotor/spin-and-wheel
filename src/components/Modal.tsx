import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Modal({ children, onClose, wide, dark }: { children: ReactNode; onClose?: () => void; wide?: boolean; dark?: boolean }) {
  useEffect(() => {
    if (!onClose) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" className={`max-h-[92vh] w-full overflow-auto rounded-md shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-md'} ${dark ? 'border border-line bg-panel text-ink' : 'bg-card text-ink'}`}>
        {children}
      </div>
    </div>
  )
}

/** Asks the signed-in staff member to re-enter their PIN before a sensitive action. */
export function PinModal({ title, detail, confirmLabel, onConfirm, onClose }: { title: string; detail?: ReactNode; confirmLabel: string; onConfirm: (pin: string) => Promise<void>; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  async function go() {
    setBusy(true)
    setErr('')
    try {
      await onConfirm(pin)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
      setPin('')
      ref.current?.focus()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal dark onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); go() }} className="space-y-4 p-6">
        <h2 className="text-xl font-black">{title}</h2>
        {detail && <div className="text-sm text-mute">{detail}</div>}
        <input ref={ref} type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="w-full rounded border border-line bg-night px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-amber" />
        {err && <div role="alert" className="text-sm font-semibold text-stop">{err}</div>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded border border-line py-3 font-bold text-mute hover:text-ink">CANCEL</button>
          <button disabled={busy || pin.length < 4} className="flex-1 rounded bg-amber py-3 font-black text-black disabled:opacity-40">{busy ? 'WORKING…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  )
}
