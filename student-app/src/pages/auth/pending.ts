// Holds signup credentials between Signup → OTP → auto-login.
// sessionStorage so it survives a refresh but not a closed tab.

const KEY = 'vit_pending_signup'

export interface PendingSignup {
  email: string
  password: string
  devOtp?: string
}

export function setPending(p: PendingSignup) {
  sessionStorage.setItem(KEY, JSON.stringify(p))
}

export function getPending(): PendingSignup | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PendingSignup) : null
  } catch {
    return null
  }
}

export function clearPending() {
  sessionStorage.removeItem(KEY)
}

/** Maps backend domain-rejection errors to the friendly copy from the App Flow doc. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('domain') || m.includes('college email') || m.includes('email not allowed')) {
    return 'Use your college email'
  }
  return message
}
