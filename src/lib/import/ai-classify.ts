import Anthropic from '@anthropic-ai/sdk'
import { FIELD_LABELS, type ImportField } from './detect'

// Классификация заголовков колонок через Claude — видит только НАЗВАНИЯ колонок
// и короткое privacy-safe описание формы данных (см. describeColumnShape),
// сами данные клиентов (значения ячеек) сюда не передаются.

const ALL_FIELDS = Object.keys(FIELD_LABELS) as ImportField[]

export interface ColumnToClassify {
  header: string
  hint: string
}

export interface AiColumnGuess {
  index: number
  field: ImportField | null
}

interface ClassifyResult {
  columns: { index: number; field: string }[]
}

export async function classifyHeadersWithAI(columns: ColumnToClassify[]): Promise<AiColumnGuess[] | null> {
  if (!process.env.ANTHROPIC_API_KEY || columns.length === 0) return null

  try {
    const client = new Anthropic()
    const fieldDescriptions = ALL_FIELDS.map(f => `"${f}" — ${FIELD_LABELS[f]}`).join('\n')

    const message = await client.messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              columns: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'integer' },
                    field: { type: 'string', enum: [...ALL_FIELDS, 'ignore'] },
                  },
                  required: ['index', 'field'],
                  additionalProperties: false,
                },
              },
            },
            required: ['columns'],
            additionalProperties: false,
          },
        },
      },
      messages: [{
        role: 'user',
        content:
          `Вот колонки таблицы студии звукозаписи, которые не удалось определить по названию.\n` +
          `Для каждой — название и краткое описание формы данных внутри (без самих данных клиентов):\n\n` +
          columns.map((c, i) => `${i}: заголовок "${c.header}", содержимое: ${c.hint}`).join('\n') +
          `\n\nОпредели наиболее вероятное назначение каждой колонки из списка полей:\n${fieldDescriptions}\n` +
          `"ignore" — колонка не относится ни к одному из полей (например статус выполнения, номер счёта, источник рекламы, имя сотрудника студии).\n\n` +
          `Если описание формы данных противоречит названию колонки (например название похоже на дату, но данные — статусы вроде "Выполнен"/"Не выполнен") — доверяй форме данных, а не только названию.\n` +
          `Верни поле для КАЖДОЙ колонки по индексу.`,
      }],
    })

    if (!message.parsed_output) return null
    const result = message.parsed_output as ClassifyResult

    return result.columns.map(c => ({
      index: c.index,
      field: c.field === 'ignore' ? null : (c.field as ImportField),
    }))
  } catch (e) {
    console.error('[classifyHeadersWithAI]', e)
    return null
  }
}
