/**
 * OpenAI provider — 走 response_format json_schema 强制结构化输出。
 *
 * 注意：response_format json_schema 仅在较新的 4o 系列 / o3 / gpt-5 模型上稳定，
 * 旧 gpt-3.5/4 可能 fallback 到 JSON mode。我们直接信任 SDK，由 user 选合适模型。
 */
import OpenAI from 'openai'
import type { LlmCallInput, LlmCallResult, LlmProvider } from './provider.js'
import { LlmError } from './provider.js'

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai' as const
  private client: OpenAI
  private model:  string

  constructor(args: { apiKey: string; model: string; baseUrl?: string }) {
    this.client = new OpenAI({
      apiKey:  args.apiKey,
      baseURL: args.baseUrl,
    })
    this.model = args.model
  }

  async call(input: LlmCallInput): Promise<LlmCallResult> {
    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user',   content: input.userPrompt   },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name:        input.outputName,
            description: input.outputDescription,
            schema:      input.outputSchema,
            strict:      true,
          },
        },
      })

      const msg = resp.choices[0]?.message
      if (!msg?.content) throw new LlmError('OpenAI 返回为空')
      const raw = typeof msg.content === 'string' ? msg.content : ''
      let output: unknown
      try { output = JSON.parse(raw) }
      catch { throw new LlmError(`OpenAI 输出非 JSON：${raw.slice(0, 200)}`) }
      return { output, text: '', model: `openai/${this.model}` }
    } catch (e) {
      if (e instanceof LlmError) throw e
      throw new LlmError(`OpenAI 调用失败：${(e as Error).message ?? e}`, e)
    }
  }

  async callPlain(input: { systemPrompt: string; userPrompt: string }): Promise<{ text: string; model: string }> {
    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user',   content: input.userPrompt   },
        ],
      })
      const text = resp.choices[0]?.message?.content
      return { text: typeof text === 'string' ? text.trim() : '', model: `openai/${this.model}` }
    } catch (e) {
      if (e instanceof LlmError) throw e
      throw new LlmError(`OpenAI plain 调用失败：${(e as Error).message ?? e}`, e)
    }
  }
}
