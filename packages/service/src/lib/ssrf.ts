/**
 * Webhook 出站 URL 的 SSRF 防护（#134）。
 *
 * 拒绝指向回环 / 私有 / 链路本地 / 元数据端点的目标，避免被用作打内网或窃取云元数据
 * （169.254.169.254）的 SSRF 原语。仅做主机字面量与协议校验——DNS rebinding 需在
 * 投递时对解析出的 IP 再校验一次（后续增强）。
 */

/** 私有 / 回环 / 链路本地 IPv4 网段判断。 */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1).map(Number)
  if (o.some(n => n > 255)) return false
  const [a, b] = o
  return (
    a === 0 ||                              // 0.0.0.0/8
    a === 127 ||                            // 回环
    a === 10 ||                             // 私有
    (a === 172 && b >= 16 && b <= 31) ||    // 私有
    (a === 192 && b === 168) ||             // 私有
    (a === 169 && b === 254) ||             // 链路本地（含云元数据 169.254.169.254）
    (a === 100 && b >= 64 && b <= 127)      // CGNAT 100.64/10
  )
}

/** 回环 / 链路本地 / ULA IPv6 判断（host 已去除中括号）。 */
function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === '::1' ||                          // 回环
    h === '::' ||
    h.startsWith('fe80:') ||                // 链路本地 fe80::/10
    h.startsWith('fc') || h.startsWith('fd') // ULA fc00::/7
  )
}

/**
 * 校验 webhook 目标 URL。返回错误信息字符串（不合法）或 null（通过）。
 */
export function webhookUrlError(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'url 不是合法的 URL'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'url 必须是 http(s)'
  }
  // 去掉 IPv6 字面量的中括号
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    host === 'localhost' || host.endsWith('.localhost') ||
    host === '0.0.0.0' || host === '[::]' ||
    isPrivateIPv4(host) || isPrivateIPv6(host)
  ) {
    return 'url 不能指向回环 / 私有 / 链路本地地址（SSRF 防护）'
  }
  return null
}
