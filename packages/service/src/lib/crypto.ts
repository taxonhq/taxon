/**
 * AES-256-GCM 对称加密，用于 API key 等敏感配置在数据库中静止加密。
 *
 * 主密钥来源：env LLM_MASTER_KEY（必须 32 字节 hex / base64 / 任意字符串，
 *           不足 32 字节时用 SHA-256 派生）。
 *
 * 输出格式（紧凑、自描述）：v1.<iv_hex>.<tag_hex>.<cipher_hex>
 *   - 版本前缀方便未来升级算法
 *   - IV 每次随机 12 字节
 *   - GCM auth tag 16 字节
 *
 * 误用防护：
 *   - 解密失败抛 EncryptionError，调用方自行决定是否暴露
 *   - 主密钥缺失时 encrypt/decrypt 均抛 EncryptionError（fail-fast，不静默退回明文）
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

const VERSION = 'v1'
const ALGO    = 'aes-256-gcm' as const

export class EncryptionError extends Error {
  constructor(msg: string) { super(msg); this.name = 'EncryptionError' }
}

let _cachedKey: Buffer | null = null

/** 派生 32 字节密钥；env LLM_MASTER_KEY 未设置时抛错 */
function getKey(): Buffer {
  if (_cachedKey) return _cachedKey
  const raw = process.env.LLM_MASTER_KEY
  if (!raw) {
    throw new EncryptionError(
      'LLM_MASTER_KEY 未设置：无法加密 / 解密。请在 .env 中设置一个长字符串（最好 32 字节随机）'
    )
  }
  // 任意长度的 LLM_MASTER_KEY → SHA-256 → 32 字节
  _cachedKey = createHash('sha256').update(raw, 'utf8').digest()
  return _cachedKey
}

/** 加密明文字符串；空字符串返回空字符串（视为"未设置"） */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  const key = getKey()
  const iv  = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join('.')
}

/** 解密；格式不合法或 auth tag 校验失败时抛 EncryptionError */
export function decryptSecret(encoded: string): string {
  if (!encoded) return ''
  const parts = encoded.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new EncryptionError('密文格式不合法')
  }
  const [, ivHex, tagHex, dataHex] = parts
  try {
    const key = getKey()
    const iv  = Buffer.from(ivHex,  'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const data = Buffer.from(dataHex, 'hex')
    const decipher = createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(data), decipher.final()])
    return dec.toString('utf8')
  } catch (e) {
    if (e instanceof EncryptionError) throw e
    throw new EncryptionError('解密失败（密钥不匹配或密文被篡改）')
  }
}

/** mask API key：保留首 4 + 尾 4，中间用 …，用于安全展示 */
export function maskApiKey(plain: string): string {
  if (!plain) return ''
  if (plain.length <= 12) return plain.slice(0, 2) + '…' + plain.slice(-2)
  return plain.slice(0, 4) + '…' + plain.slice(-4)
}
