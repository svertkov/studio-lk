// Быстрые шаблоны для "Комментарий к прибыли" (Order.financeComment,
// FinanceEditor в OrderFinanceBlock.tsx) — дополняют текст комментария готовой
// строкой вместо того, чтобы администратор каждый раз печатал одно и то же.
// Не отдельная сущность/система шаблонов — статический список плюс одна
// чистая функция объединения, тот же уровень сложности, что у остальных
// *-model.ts хелперов платформы (см. AGENTS.md, правило 4). Новый шаблон
// добавляется одной строкой в FINANCE_COMMENT_TEMPLATES, без изменения ни
// этой логики, ни UI в OrderFinanceBlock.tsx.

export interface FinanceCommentTemplate {
  id: string
  label: string
  text: string
}

export const FINANCE_COMMENT_TEMPLATES: FinanceCommentTemplate[] = [
  { id: 'tax_9', label: 'Налог 9%', text: 'Налог 9%' },
]

// Пустой комментарий — просто подставляет текст шаблона. Непустой — дописывает
// с новой строки, не затирая уже введённое. Если текст шаблона уже где-то в
// комментарии — не добавляет повторно (простое вхождение подстроки, не только
// точное совпадение отдельной строки: повторное "Налог 9%" внутри более
// длинной фразы тоже считается уже добавленным).
export function appendFinanceCommentTemplate(current: string, templateText: string): string {
  if (current.includes(templateText)) return current
  return current.trim() ? `${current}\n${templateText}` : templateText
}
