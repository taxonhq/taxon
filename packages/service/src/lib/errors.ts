export function isPrismaError(e: unknown, code: string): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: unknown }).code === code
  )
}

export class ValidationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// 软删除时在 slug/name 末尾追加时间戳，释放唯一约束名称供重建使用
export function deletedSuffix(): string {
  return `__deleted__${Date.now().toString(36)}`
}
