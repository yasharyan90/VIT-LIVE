// Ticket purchase flow. With Razorpay configured on the backend the real
// checkout opens; in dev (mock gateway) the purchase completes instantly so
// the whole ticket → QR → check-in loop works with zero setup.

import { api } from './api'
import type { Ticket } from './types'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void
    }
  }
}

interface OrderResponse {
  mock: boolean
  key_id: string
  order_id: string
  amount_cents: number
  currency: string
  event_title: string
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load the payment page — check your connection'))
    document.head.appendChild(s)
  })
}

export function formatPrice(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN')}`
}

export async function buyTicket(eventId: string): Promise<Ticket> {
  const order = await api<OrderResponse>(`/events/${eventId}/order`, { method: 'POST', body: {} })

  if (order.mock) {
    const res = await api<{ ticket: Ticket }>(`/events/${eventId}/confirm`, { method: 'POST', body: {} })
    return res.ticket
  }

  await loadCheckout()
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_cents,
      currency: order.currency,
      name: 'VIT Live',
      description: order.event_title,
      theme: { color: '#0a0a0a' },
      handler: (res: Record<string, string>) => {
        api<{ ticket: Ticket }>(`/events/${eventId}/confirm`, { method: 'POST', body: res })
          .then((r) => resolve(r.ticket))
          .catch(reject)
      },
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    })
    rzp.on('payment.failed', (resp) => {
      reject(new Error(resp.error?.description || 'Payment failed — you have not been charged'))
    })
    rzp.open()
  })
}
