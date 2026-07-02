import { google } from 'googleapis'

export const CALENDARS: Record<string, string> = {
  studio: process.env.GOOGLE_CALENDAR_STUDIO_ID ?? '',
  smm:    process.env.GOOGLE_CALENDAR_SMM_ID ?? '',
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  description: string
  location: string
  calendar: string
  color: string
}

// Описание события в Google Calendar может содержать HTML (переносы строк как <br>,
// списки, ссылки и т.д.) — превращаем это в обычный текст, сохраняя структуру строк,
// как она выглядит в самом Google Calendar.
export function descriptionToPlainText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}')
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  })
}

export async function fetchCalendarEvents(
  filter: 'all' | 'studio' | 'smm',
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })

  const calIds = filter === 'all'
    ? Object.entries(CALENDARS).filter(([, id]) => id)
    : [[filter, CALENDARS[filter]]].filter(([, id]) => id)

  const allEvents = []
  for (const [key, calendarId] of calIds) {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    })
    allEvents.push((res.data.items ?? []).map(event => ({
      id: event.id ?? '',
      title: event.summary ?? '(без названия)',
      start: event.start?.dateTime ?? event.start?.date ?? '',
      end: event.end?.dateTime ?? event.end?.date ?? '',
      allDay: !event.start?.dateTime,
      description: descriptionToPlainText(event.description ?? ''),
      location: event.location ?? '',
      calendar: key,
      color: key === 'studio' ? '#00c26b' : '#3b82f6',
    })))
  }

  return allEvents.flat().sort((a, b) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )
}
