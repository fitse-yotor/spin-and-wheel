import { Barcode, QR } from '@/components/Codes'
import { etb, fmtDate, fmtTime, gameNo, odds } from '@/lib/format'

export interface ReceiptData {
  company: string
  gameType?: 'WHEEL' | 'DOGS'
  gameName?: string
  shop: { name: string; code: string; address: string; phone: string }
  ticketNumber: string
  gameId: number
  createdAt: number
  cashier: string
  selections: { market: string; label: string; stake: number; oddsX100: number; possibleWin: number }[]
  totalStake: number
  maxWin: number
  qrPayload: string
  barcode: string
  verifyCode: string
  expiryDays: number
  footer: string
  notice: string
  duplicate: boolean
}

const Rule = () => <div className="my-[6px] border-t border-dashed border-black" />
const Row = ({ a, b, bold }: { a: string; b: string; bold?: boolean }) => (
  <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
    <span>{a}</span>
    <span className="text-right">{b}</span>
  </div>
)

/** 80 mm thermal receipt. The QR holds only an opaque secure reference — no internal IDs or amounts. */
export function Receipt({ r }: { r: ReceiptData }) {
  return (
    <div className="receipt-sheet">
      <div className="text-center">
        <div className="text-[18px] font-bold tracking-widest">{r.gameName ?? 'SPIN & WHEEL'}</div>
        <div className="font-bold">{r.shop.name}</div>
        <div>Shop code: {r.shop.code}</div>
        {r.shop.address && <div>{r.shop.address}</div>}
        {r.shop.phone && <div>{r.shop.phone}</div>}
      </div>
      {r.duplicate && <div className="mt-1 border border-black py-[2px] text-center font-bold">*** DUPLICATE COPY ***</div>}
      <Rule />
      <Row a="Ticket" b={r.ticketNumber} bold />
      <Row a={r.gameType === 'DOGS' ? 'Race' : 'Game'} b={`#${gameNo(r.gameId)}`} bold />
      <Row a="Date" b={fmtDate(r.createdAt)} />
      <Row a="Time" b={fmtTime(r.createdAt)} />
      <Row a="Cashier" b={r.cashier} />
      <Rule />
      {r.selections.map((s, i) => (
        <div key={i} className="mb-[5px]">
          <Row a={`${s.market}: ${s.label}`} b={`@ ${odds(s.oddsX100)}`} bold />
          <Row a={`  Stake ${etb(s.stake)}`} b={`Win ${etb(s.possibleWin)}`} />
        </div>
      ))}
      <Rule />
      <Row a="TOTAL STAKE" b={etb(r.totalStake)} bold />
      <Row a="MAX POSSIBLE WIN" b={etb(r.maxWin)} bold />
      <Rule />
      <div className="flex justify-center">
        <QR value={r.qrPayload} size={130} />
      </div>
      <div className="mt-[6px]">
        <Barcode value={r.barcode} height={44} />
      </div>
      <div className="mt-[6px] text-center">
        Verification code
        <div className="text-[20px] font-bold tracking-[0.3em]">{r.verifyCode}</div>
      </div>
      <Rule />
      <div className="text-center font-bold">{r.footer}</div>
      <div className="mt-[3px] text-center text-[10px]">Valid for {r.expiryDays} days after the draw. All amounts in ETB.</div>
      <div className="mt-[3px] text-center text-[10px]">18+ only. {r.notice}</div>
    </div>
  )
}
