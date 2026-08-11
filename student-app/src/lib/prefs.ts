// Local-only notification preferences (Profile tab toggles).

const LS_PREFS = 'vit_notif_prefs'

export interface NotifPrefs {
  announcements: boolean
  events: boolean
  polls: boolean
  lostfound: boolean
}

const DEFAULTS: NotifPrefs = {
  announcements: true,
  events: true,
  polls: true,
  lostfound: true,
}

export function getNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(LS_PREFS)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotifPrefs>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setNotifPrefs(prefs: NotifPrefs) {
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs))
}
