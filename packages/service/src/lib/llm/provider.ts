/**
 * LLM provider 统一抽象。
 *
 * 设计：
 *   - 输入 system prompt + user prompt + JSON schema（结构化输出契约）
 *   - 输出符合 schema 的 JSON 对象（已解析）+ provider 的"思考"文字（用于审计）
 *   - 不同 provider 内部走不同 API：
 *       anthropic → messages API + tool use（强制 tool input 符合 schema）
 *       openai    → chat.completions + response_format json_schema
 *   - 调用方负责对 result 做二次 Zod 校验（防 provider 返回错误数据）
 */

export interface LlmCallInput {
  systemPrompt: string
  userPrompt:   string
  /** JSON schema（OpenAPI 3.0 / JSON Schema draft-7 子集）描述期望的输出结构 */
  outputSchema: Record<string, unknown>
  /** 输出 schema 的"工具名"或"function 名"，多 provider 复用 */
  outputName:   string
  /** schema 描述，给 LLM 看 */
  outputDescription: string
}

export interface LlmCallResult {
  /** 解析后的 JSON 对象（未做 Zod 二次校验） */
  output: unknown
  /** 自由文本，部分 provider 在结构化输出之外还会有解释 */
  text:   string
  /** 实际生效的模型版本（带 provider 前缀，如 "anthropic/claude-sonnet-4-5"） */
  model:  string
}

export interface LlmProvider {
  /** provider 名，用于日志和 model 前缀 */
  readonly name: 'anthropic' | 'openai'
  /** 结构化输出（tool use / json_schema）。需要模型 + 中转层都支持。 */
  call(input: LlmCallInput): Promise<LlmCallResult>
  /** 纯文本输出。兼容性最广，调用方负责从 text 中解析数据。 */
  callPlain(input: { systemPrompt: string; userPrompt: string }): Promise<{ text: string; model: string }>
}

export class LlmError extends Error {
  constructor(msg: string, public cause?: unknown) {
    super(msg)
    this.name = 'LlmError'
  }
}
