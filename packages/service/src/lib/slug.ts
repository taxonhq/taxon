import pinyin from 'pinyin'

export function generateSlug(name: string): string {
  // \p{Script=Han} 覆盖基本汉字 + 扩展区，避免 /[一-龥]/ 漏掉生僻字（#132）
  const hasChinese = /\p{Script=Han}/u.test(name)

  if (hasChinese) {
    const py = pinyin.default(name, { style: 'NORMAL' })
      .flat()
      .join('-')
      .toLowerCase()
    // 与英文分支一致：清洗后为空时回落时间戳，避免产出空 slug（#132）
    return py.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || Date.now().toString(36)
  }

  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || Date.now().toString(36)
}
