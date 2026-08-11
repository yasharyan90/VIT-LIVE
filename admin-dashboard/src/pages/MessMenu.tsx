import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import type { MessMenu } from '../types'
import { Card, PageTitle, Spinner, inputCls, labelCls, primaryBtnCls } from '../components/ui'

const MEALS: MessMenu['meal'][] = ['breakfast', 'lunch', 'snacks', 'dinner']
const MEAL_ICONS: Record<MessMenu['meal'], string> = {
  breakfast: '☕',
  lunch: '🍛',
  snacks: '🍪',
  dinner: '🍽',
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function MessMenuPage() {
  const { toast } = useToast()
  const [date, setDate] = useState(today())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingMeal, setSavingMeal] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api<{ date: string; meals: MessMenu[] }>(`/mess-menu?date=${date}`)
      .then((data) => {
        const next: Record<string, string> = {}
        for (const meal of MEALS) next[meal] = ''
        for (const m of data.meals) next[m.meal] = m.items
        setDrafts(next)
      })
      .catch((err) => toast(err instanceof Error ? err.message : 'Failed to load menu', 'error'))
      .finally(() => setLoading(false))
  }, [date, toast])

  const save = async (meal: MessMenu['meal']) => {
    setSavingMeal(meal)
    try {
      await api<{ menu: MessMenu }>('/admin/mess-menu', {
        method: 'POST',
        body: { menu_date: date, meal, items: drafts[meal] ?? '' },
      })
      toast(`${meal[0].toUpperCase() + meal.slice(1)} menu saved`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'error')
    } finally {
      setSavingMeal(null)
    }
  }

  return (
    <div>
      <PageTitle sub="Students see this at the top of their feed">Mess Menu</PageTitle>

      <div className="mb-6 max-w-48">
        <label htmlFor="mm-date" className={labelCls}>
          Date
        </label>
        <input id="mm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
      </div>

      {loading ? (
        <Spinner label="Loading menu…" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {MEALS.map((meal) => (
            <Card key={meal} className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold capitalize text-neutral-900">
                <span aria-hidden>{MEAL_ICONS[meal]}</span> {meal}
              </h2>
              <textarea
                value={drafts[meal] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [meal]: e.target.value }))}
                className={`${inputCls} min-h-24 resize-y`}
                placeholder="Comma-separated items, e.g. Idli, sambar, chutney, coffee"
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void save(meal)}
                  disabled={savingMeal === meal}
                  className={primaryBtnCls}
                >
                  {savingMeal === meal ? 'Saving…' : 'Save'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
