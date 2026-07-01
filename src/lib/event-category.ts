// Определяем тип записи по названию мероприятия в Google Calendar.
// Известные обозначения студии описаны в /admin/schedule (ГГ, ТЗ, СЗ, Nк, Nч).
// Если ни один известный тип не найден, выводим категорию прямо из названия
// (убрав служебные пометки зала/камер/человек) — так новые виды съёмок,
// которые появляются в календаре, сами становятся отдельными категориями.

const MODIFIER_TOKEN_RE = /^(тз|сз|\d+[кч])$/i

const KNOWN_CATEGORIES: { test: (lower: string, tokens: string[]) => boolean; label: string }[] = [
  { test: lower => lower.includes('подкаст'), label: 'Подкаст' },
  { test: (lower, tokens) => tokens.includes('гг') || lower.includes('говорящ'), label: 'Говорящая голова' },
  { test: lower => lower.includes('рил') || lower.includes('reels'), label: 'Рилс' },
  { test: lower => lower.includes('выезд'), label: 'Выездная съёмка' },
]

export function categorizeEvent(title: string): string {
  const lower = title.toLowerCase()
  const tokens = lower.split(/[^а-яёa-z0-9]+/i).filter(Boolean)

  for (const { test, label } of KNOWN_CATEGORIES) {
    if (test(lower, tokens)) return label
  }

  const words = title
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w && !MODIFIER_TOKEN_RE.test(w.replace(/[.,;:!?()]/g, '')))
  const label = words.join(' ').trim()
  return label || 'Без названия'
}

const CHART_PALETTE = ['#00c26b', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444', '#a3a3a3']

export function colorForCategory(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return CHART_PALETTE[hash % CHART_PALETTE.length]
}

// Разбираем название мероприятия на структурированные поля для таблицы отчёта.
// Студия пишет названия в порядке "категория, тз/сз, Nк, Nч, имя клиента"
// (запятые или пробелы — неважно). Зал/камеры/человек — служебные пометки,
// первая из них считается границей: всё до неё — название категории,
// всё после (кроме самих пометок) — имя клиента.
const HALL_RE = /^(тз|сз)$/i
const CAMERA_RE = /^(\d+)к$/i
const PEOPLE_RE = /^(\d+)ч$/i
const isModifierToken = (token: string) => HALL_RE.test(token) || CAMERA_RE.test(token) || PEOPLE_RE.test(token)

export interface ParsedEvent {
  category: string
  hall: string | null
  cameras: number | null
  people: number | null
  client: string | null
}

// Студия начинает писать имя клиента в описании мероприятия в Google Calendar
// (а не в названии) — если описание заполнено, его первая строка побеждает
// разбор названия как источник имени клиента.
export function parseEventTitle(title: string, description?: string | null): ParsedEvent {
  const tokens = title.split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
  const firstModIdx = tokens.findIndex(isModifierToken)

  const categoryPhrase = (firstModIdx === -1 ? tokens : tokens.slice(0, firstModIdx)).join(' ').trim() || title.trim()
  const category = categorizeEvent(categoryPhrase)

  let hall: string | null = null
  let cameras: number | null = null
  let people: number | null = null
  const clientTokens: string[] = []

  if (firstModIdx !== -1) {
    for (const token of tokens.slice(firstModIdx)) {
      if (HALL_RE.test(token)) {
        hall = token.toLowerCase() === 'тз' ? 'Тёмный зал' : 'Светлый зал'
        continue
      }
      const cam = token.match(CAMERA_RE)
      if (cam) { cameras = Number(cam[1]); continue }
      const ppl = token.match(PEOPLE_RE)
      if (ppl) { people = Number(ppl[1]); continue }
      clientTokens.push(token)
    }
  }

  const descriptionClient = description?.split('\n').map(l => l.trim()).find(Boolean) ?? null
  const client = descriptionClient || clientTokens.join(' ').trim() || null

  return { category, hall, cameras, people, client }
}

// Отделяем настоящие записи студии от личных пометок в календаре
// ("Ваня", "не будет Ромы", "выставить счёт" и т.п.) — это не мероприятия
// студии, а заметки для себя, их не нужно учитывать в часах/отчётах.
// Запись считаем настоящей, если в названии есть служебная пометка зала/камер/
// человек (тз, сз, Nк, Nч) или название совпадает с одной из известных категорий.
export function isStudioBooking(title: string): boolean {
  const lower = title.toLowerCase()
  const tokens = lower.split(/[^а-яёa-z0-9]+/i).filter(Boolean)
  if (KNOWN_CATEGORIES.some(({ test }) => test(lower, tokens))) return true
  const splitTokens = title.split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
  return splitTokens.some(isModifierToken)
}
