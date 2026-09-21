import { useEffect } from 'react'
import { Modal } from '@/components/Modal'
import { Receipt, type ReceiptData } from '@/components/Receipt'
import { etb } from '@/lib/format'

/** Shows a just-booked (or reprinted) ticket and prints it. */
export function ReceiptModal({ receipt, autoPrint, onClose }: { receipt: ReceiptData; autoPrint: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(() => window.print(), 350)
    return () => clearTimeout(t)
  }, [receipt, autoPrint])
  return (
    <Modal dark wide>
      <div className="grid grid-cols-[auto_1fr] gap-6 p-6">
        <div className="print-area overflow-hidden rounded border border-line bg-white"><Receipt r={receipt} /></div>
        <div className="flex flex-col justify-center gap-4">
          <div className="text-3xl font-black text-go">{receipt.duplicate ? 'DUPLICATE COPY' : 'TICKET BOOKED'}</div>
          <div className="font-mono text-lg">{receipt.ticketNumber}</div>
          {!receipt.duplicate && <div className="text-mute">Collect <b className="text-ink">{etb(receipt.totalStake)}</b> in cash. Hand the printed ticket to the player.</div>}
          <button onClick={() => window.print()} className="rounded bg-[#a5262a] py-3 text-lg font-bold text-white">PRINT TICKET</button>
          <button autoFocus onClick={onClose} className="rounded border border-line py-3 text-lg font-bold">DONE</button>
        </div>
      </div>
    </Modal>
  )
}
