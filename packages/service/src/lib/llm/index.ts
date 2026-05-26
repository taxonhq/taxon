/**
 * LLM provider 工厂。
 */
import type { LlmProvider } from './provider.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'

export type { LlmProvider, LlmCallInput, LlmCallResult } from './provider.js'
export { LlmError } from './provider.js'

export function buildProvider(args: {
  provider: 'anthropic' | 'openai'
  apiKey:   string
  model:    string
  baseUrl?: string
}): LlmProvider {
  if (args.provider === 'anthropic') {
    return new AnthropicProvider({ apiKey: args.apiKey, model: args.model, baseUrl: args.baseUrl })
  }
  return new OpenAIProvider({ apiKey: args.apiKey, model: args.model, baseUrl: args.baseUrl })
}
