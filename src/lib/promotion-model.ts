// Единая логика акции "−20% первый визит" — заменяет прежний подход, где
// акция была просто фразой в свободном комментарии (Order.comment /
// ScheduleEvent.notes), из-за чего таблица "Заказы" и карточка клиента
// показывали одновременно и капсулу, и полный текст фразы рядом (дубль).
//
// Теперь источник правды — структурированное поле promotionType (см.
// OrderPromotionType в schema.prisma, зеркалится на Order и ScheduleEvent тем
// же принципом двойного источника, что и comment/notes). Текстовое
// распознавание (COMMENT_PROMO_REGEX ниже) остаётся только как:
//  1) способ проинициализировать тоггл в карточке для СТАРЫХ записей, где
//     structured-поле ещё не проставлено (см. OrderFormModal/EventCardModal —
//     после первого же сохранения такой карточки promotionType проставится,
//     и текст-детект для неё больше не понадобится);
//  2) страховка для истории съёмок (ClientVisit) — у исторических визитов,
//     импортированных из таблиц, структурированного поля нет и не будет.
//
// Все компоненты, которые показывают акцию (таблица "Заказы", карточка
// заказа/записи, карточка клиента, CRM), обязаны использовать ТОЛЬКО эти
// функции — не писать собственные regex/includes на местах.

export type OrderPromotionType = 'FIRST_VISIT_20'

// Короткая подпись капсулы — единый текст везде, как того требует ТЗ ("везде
// использовать один текст"). Не переносить, не сокращать дальше по месту.
export const PROMOTION_PILL_LABEL: Record<OrderPromotionType, string> = {
  FIRST_VISIT_20: '−20% первый визит',
}

// Ещё более компактный вариант ТОЙ ЖЕ подписи — не альтернативная
// формулировка "по месту", а единственный canonical короткий вариант, для
// мест, где даже PROMOTION_PILL_LABEL не помещается без переноса/обрезания
// (сейчас — только плотный ("dense") режим таблицы "Заказы" на 1280–1366px,
// см. OrdersListView.tsx). Показывать вместо полного текста ellipsis'ом
// запрещено самим ТЗ уплотнения таблицы — вместо этого один заранее заданный
// короткий вариант, а не обрезание на местах.
export const PROMOTION_PILL_LABEL_SHORT: Record<OrderPromotionType, string> = {
  FIRST_VISIT_20: '−20% · 1-й визит',
}

// Название кнопки быстрого выбора в карточке заказа/записи — то же значение,
// что раньше вставлялось буквально в комментарий (полный текст шаблона),
// сейчас используется только как подпись переключателя, в комментарий больше
// не пишется (см. OrderFormModal.tsx/EventCardModal.tsx).
export const PROMOTION_TEMPLATE_LABEL: Record<OrderPromotionType, string> = {
  FIRST_VISIT_20: 'Акция! 20% скидка на первую запись',
}

// Регулярка для распознавания акции в СВОБОДНОМ тексте старых заказов —
// покрывает все документированные исторические варианты формулировки:
// с "Акция"/без, с "!"/без, "20% скидка на X" и "скидка 20% на X" порядок
// слов, "первую запись"/"первый визит" (и их смешение на случай опечатки),
// произвольные пробелы/переносы строк (\s уже покрывает \n), регистр —
// через флаг i.
// Кириллический класс [а-яё] вместо \w — \w в JS regex матчит только ASCII
// [A-Za-z0-9_], без него "скидк\w*" не поглощал бы кириллическое окончание
// "а" в "скидка" и вся альтернатива ломалась бы посередине слова.
const COMMENT_PROMO_REGEX =
  /(?:акция!?\s*[-–—]?\s*)?(?:20\s*%\s*скидк[а-яё]*|скидк[а-яё]*\s*20\s*%)\s*(?:на\s*)?перв(?:ую|ый)\s*(?:запись|визит)!?/gi

// true, если свободный текст комментария содержит любую из исторических
// формулировок акции "−20% первый визит" — используется ТОЛЬКО как fallback
// для записей без structured-поля (см. заголовок файла).
export function commentMentionsFirstVisitPromo(comment: string | null | undefined): boolean {
  if (!comment) return false
  COMMENT_PROMO_REGEX.lastIndex = 0
  return COMMENT_PROMO_REGEX.test(comment)
}

// Определяет активную акцию заказа/записи: сперва смотрит на
// structured-поле (источник правды для всего, что уже пересохранялось через
// новые карточки), и только если оно пустое — пробует распознать акцию в
// тексте комментария (старые, ещё не тронутые записи). Как только такая
// запись пересохраняется через карточку, promotionType проставляется явно и
// текстовый fallback для неё больше не нужен (см. getOrderPromotion в
// OrderFormModal.tsx/EventCardModal.tsx — тоггл инициализируется этой же
// функцией, поэтому "мигрирует" акцию в structured-поле при следующем Save).
export function getOrderPromotion(
  order: { promotionType?: OrderPromotionType | string | null; comment: string | null },
): OrderPromotionType | null {
  if (order.promotionType === 'FIRST_VISIT_20') return 'FIRST_VISIT_20'
  if (commentMentionsFirstVisitPromo(order.comment)) return 'FIRST_VISIT_20'
  return null
}

// Убирает распознанный акционный текст из комментария для превью/textarea —
// остальной текст администратора сохраняется как есть, лишние пустые строки
// схлопываются. Возвращает null, если после удаления акции ничего не
// осталось (см. ТЗ: "если после удаления акционной фразы обычного
// комментария не осталось, показывать только капсулу").
export function stripPromotionTextFromComment(comment: string | null | undefined): string | null {
  if (!comment) return null
  COMMENT_PROMO_REGEX.lastIndex = 0
  const stripped = comment
    .replace(COMMENT_PROMO_REGEX, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  return stripped || null
}

// Итоговый текст комментария для отображения (таблица, tooltip, textarea
// карточки при инициализации) — всегда очищенный от акционной фразы,
// независимо от того, откуда она распознана (structured-поле или текст).
export function getVisibleOrderComment(order: { comment: string | null }): string | null {
  return stripPromotionTextFromComment(order.comment)
}
