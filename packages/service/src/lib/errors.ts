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
