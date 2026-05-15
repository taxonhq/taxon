import pinyin from 'pinyin'

export function generateSlug(name: string): string {
  const hasChinese = /[一-龥]/.test(name)

  if (hasChinese) {
    const py = pinyin.default(name, { style: 'NORMAL' })
      .flat()
      .join('-')
      .toLowerCase()
    return py.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  }

  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || Date.now().toString(36)
}
