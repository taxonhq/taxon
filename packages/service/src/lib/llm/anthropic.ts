/**
 * Anthropic Claude provider — 走 tool use 强制结构化输出。
 *
 * 实现要点：
 *   - 把 outputSchema 包装成一个 "tool"，Claude 唯一可调用的工具
 *   - tool_choice=any 强制 Claude 必须调用该工具
 *   - tool_use input 即为期望的结构化输出
 *   - 不需要 streaming（单次调用，单次响应）
 */
import Anthropic from '@anthropic-ai/sdk'
import type { LlmCallInput, LlmCallResult, LlmProvider } from './provider.js'
import { LlmError } from './provider.js'

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const
  private client: Anthropic
  private model:  string

  constructor(args: { apiKey: string; model: string; baseUrl?: string }) {
    this.client = new Anthropic({
      apiKey:  args.apiKey,
      baseURL: args.baseUrl,
    })
    this.model = args.model
  }

  async call(input: LlmCallInput): Promise<LlmCallResult> {
    try {
      const resp = await this.client.messages.create({
        model:      this.model,
        max_tokens: 2048,
        system:     input.systemPrompt,
        messages:   [{ role: 'user', content: input.userPrompt }],
        tools: [{
          name:         input.outputName,
          description:  input.outputDescription,
          input_schema: input.outputSchema as Anthropic.Messages.Tool.InputSchema,
        }],
        tool_choice: { type: 'tool', name: input.outputName },
      })

      // 收集文本（content blocks 中的 text）+ tool use 的 input
      let text = ''
      let output: unknown = undefined
      for (const block of resp.content) {
        if (block.type === 'text')     text += block.text
        if (block.type === 'tool_use' && block.name === input.outputName) {
          output = block.input
        }
      }
      if (output === undefined) {
        throw new LlmError('Claude 未调用工具返回结构化输出')
      }
      return { output, text: text.trim(), model: `anthropic/${this.model}` }
    } catch (e) {
      if (e instanceof LlmError) throw e
      throw new LlmError(`Anthropic 调用失败：${(e as Error).message ?? e}`, e, (e as { status?: number })?.status)
    }
  }

  async callPlain(input: { systemPrompt: string; userPrompt: string }): Promise<{ text: string; model: string }> {
    try {
      const resp = await this.client.messages.create({
        model:      this.model,
        max_tokens: 2048,
        system:     input.systemPrompt,
        messages:   [{ role: 'user', content: input.userPrompt }],
      })
      let text = ''
      for (const block of resp.content) {
        if (block.type === 'text') text += block.text
      }
      return { text: text.trim(), model: `anthropic/${this.model}` }
    } catch (e) {
      if (e instanceof LlmError) throw e
      throw new LlmError(`Anthropic plain 调用失败：${(e as Error).message ?? e}`, e, (e as { status?: number })?.status)
    }
  }
}
