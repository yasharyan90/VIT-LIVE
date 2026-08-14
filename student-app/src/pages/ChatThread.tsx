// One-on-one chat thread: live bubbles over the glass, block/unblock inline.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { ws } from '../lib/ws'
import type { ChatMessage, ChatPerson } from '../lib/types'
import { PageLoader } from '../components/ui'
import { spring } from '../components/motion'
import { BackIcon } from '../components/Icons'
import { Avatar } from './Chats'

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function ChatThreadPage() {
  const { userID: partnerID } = useParams<{ userID: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const [partner, setPartner] = useState<ChatPerson | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [iBlocked, setIBlocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!partnerID) return
    let cancelled = false
    setLoading(true)
    api<{ partner: ChatPerson; i_blocked: boolean; items: ChatMessage[] }>(`/chat/with/${partnerID}`)
      .then((data) => {
        if (cancelled) return
        setPartner(data.partner)
        setIBlocked(data.i_blocked)
        setMessages(data.items)
      })
      .catch(() => {
        if (!cancelled) setPartner(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [partnerID])

  // Live incoming/outgoing messages for THIS thread.
  useEffect(() => {
    return ws.on('chat.message', (env) => {
      const m = env.payload as ChatMessage
      if (!m || (m.sender_id !== partnerID && m.recipient_id !== partnerID)) return
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
      // Reading live — tell the server (marks read) without reloading.
      if (m.sender_id === partnerID) {
        void api(`/chat/with/${partnerID}`).catch(() => {})
      }
    })
  }, [partnerID])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending || !partnerID) return
    setSending(true)
    try {
      const data = await api<{ message: ChatMessage }>(`/chat/with/${partnerID}`, { body: { body } })
      setMessages((prev) => (prev.some((x) => x.id === data.message.id) ? prev : [...prev, data.message]))
      setDraft('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast("You can't message this user.", { kind: 'error' })
      } else {
        toast(err instanceof Error ? err.message : 'Could not send', { kind: 'error' })
      }
    } finally {
      setSending(false)
    }
  }

  const toggleBlock = async () => {
    if (!partnerID || blockBusy) return
    if (!iBlocked && !window.confirm(`Block ${partner?.full_name ?? 'this user'}? They won't be able to message you.`)) {
      return
    }
    setBlockBusy(true)
    try {
      const data = await api<{ blocked: boolean }>(
        `/chat/${iBlocked ? 'unblock' : 'block'}/${partnerID}`,
        { method: 'POST' },
      )
      setIBlocked(data.blocked)
      toast(data.blocked ? 'Blocked. They can no longer message you.' : 'Unblocked.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', { kind: 'error' })
    } finally {
      setBlockBusy(false)
    }
  }

  if (loading) return <PageLoader />
  if (!partner) {
    return (
      <div className="px-4 py-4">
        <button
          type="button"
          onClick={() => navigate('/chats')}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-6 w-6" />
        </button>
        <p className="mt-6 text-center text-muted">User not found.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:min-h-[calc(100dvh-2rem)]">
      {/* Thread header */}
      <div className="glass-strong sticky top-[52px] z-20 flex items-center gap-3 border-b border-white/10 px-4 py-2.5 lg:top-0 lg:rounded-t-2xl">
        <button
          type="button"
          onClick={() => navigate('/chats')}
          aria-label="Back to chats"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-soft"
        >
          <BackIcon className="h-5 w-5" />
        </button>
        <Avatar url={partner.avatar_url} name={partner.full_name} size="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{partner.full_name}</p>
          <p className="truncate text-xs text-muted">{partner.college_email}</p>
        </div>
        <button
          type="button"
          onClick={() => void toggleBlock()}
          disabled={blockBusy}
          className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
            iBlocked
              ? 'border-success/40 text-success'
              : 'border-white/15 text-muted active:text-emergency'
          }`}
        >
          {iBlocked ? 'Unblock' : '🚫 Block'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            Say hi to {partner.full_name.split(' ')[0]} 👋
          </p>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m) => {
            const mine = m.sender_id === user?.id
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={spring}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                    mine ? 'rounded-br-md bg-primary text-black' : 'glass rounded-bl-md text-ink'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-black/50' : 'text-muted'}`}>
                    {clockTime(m.created_at)}
                    {mine && m.read_at ? ' · seen' : ''}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="sticky bottom-14 px-4 pb-3 lg:bottom-0">
        {iBlocked ? (
          <div className="glass flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-muted">
            You blocked this user.
            <button type="button" onClick={() => void toggleBlock()} className="font-semibold text-success">
              Unblock
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="glass flex items-end gap-2 rounded-2xl p-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message…"
              aria-label="Message"
              maxLength={2000}
              className="min-h-10 flex-1 bg-transparent px-2 text-[15px] text-ink placeholder:text-muted focus:outline-none"
            />
            <motion.button
              type="submit"
              disabled={!draft.trim() || sending}
              whileTap={{ scale: 0.9 }}
              transition={spring}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-black disabled:opacity-40"
              aria-label="Send"
            >
              ➤
            </motion.button>
          </form>
        )}
      </div>
    </div>
  )
}
