// Проверка ссылки перед рендером как href (Яндекс.Диск и т.п.) — не даёт
// сломанному/произвольному значению стать кликабельной ссылкой в интерфейсе.
export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
