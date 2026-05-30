# 标本馆 / Herbarium —— Taxon 设计语言参考

> 一套为 Taxon 探索的候选视觉语言。**未被选为主方向**（主方向是「菌丝 / Mycelial」），
> 但因其独特的品牌资产价值完整存档，供日后设计参考。
> 配套预览：[`preview.html`](./preview.html)（在浏览器打开看动效与排版实物）。

---

## 1. 概念内核

把 Taxon 的本质——**分类学（taxonomy）**——回溯到它的历史源头：**林奈分类法与博物学标本馆**。

每一个标签不是数据库里的一行，而是一份**标本**；标签层级不是树形控件，而是一张**博物学分类图版（plate）**；整个产品是一座**恒温归档的标本馆**。

这套语言的独特性在于：**没有任何竞品会用 18 世纪博物学的视觉语言做一个 AI 中台**。它把"分类"这件事的文化厚度变成无法被复制的品牌资产。

**适用边界**：偏文艺、偏叙事。适合品牌门面、空状态、引导、关于页、营销页；在高密度数据表格页需谨慎，避免为风格牺牲可读性（见 §8 风险）。

---

## 2. 色彩系统

档案纸张 + 矿物墨水。低饱和、暖调、有年代感。

| Token | Hex | 角色 | 用途 |
|-------|-----|------|------|
| `--paper` | `#f2ebdc` | 主背景 | 页面底色（陈年纸） |
| `--paper2` | `#e7ddc6` | 次级表面 | 卡片/chip 底、分区 |
| `--ink` | `#2f2a20` | 主文字 | 标题、正文、主笔画 |
| `--ink2` | `#6b6047` | 次文字 | 标签、元信息、拉丁名 |
| `--sepia` | `#8a6d3b` | 强调一（褐） | 斜体强调、分类枝线、品牌点缀 |
| `--leaf` | `#4a6741` | 强调二（叶绿） | 活跃标本点、正向状态 |
| `--rust` | `#9c4a2e` | 强调三（铁锈） | 警示标本点、负向/异常 |
| `--rule` | `rgba(74,67,52,.35)` | 分隔线 | 发丝级 hairline |

**配色原则**：纸与墨主导画面 80% 以上；sepia/leaf/rust 三个矿物色只做**点状强调**，绝不大面积铺。这种"主色克制 + 锐利点缀"的克制感正是区别于廉价配色的关键。

```css
:root{
  --paper:#f2ebdc; --paper2:#e7ddc6;
  --ink:#2f2a20;   --ink2:#6b6047;
  --sepia:#8a6d3b; --leaf:#4a6741; --rust:#9c4a2e;
  --rule:rgba(74,67,52,.35);
}
```

### 暗色变体（建议，未在预览中实现）
若需暗色，走"夜间档案室"而非反相：底 `#1a1712`（深木），纸面元素降为 `#2a251c`，文字 `#e7ddc6`，三个矿物色提亮 ~12% 维持点缀。

---

## 3. 字体系统

四款字体各司其职，混排是这套语言的灵魂——**衬线博物 + 打字机标签 + 思源宋体 CJK**。

| 字体 | 角色 | 字重 | 用途 |
|------|------|------|------|
| **Fraunces** | 展示衬线 | 400 / 600 + italic | 大标题、品牌名、强调数字。其"软"的笔触与高对比恰是博物学插画的气质 |
| **Spectral** | 正文衬线 | 300 / 500 + italic 400 | 正文、说明 |
| **Noto Serif SC（思源宋体）** | CJK | 400 / 600 / 900 | 所有中文——与 Fraunces 同为衬线，混排和谐 |
| **Courier Prime** | 打字机等宽 | 400 | 标签、元信息、拉丁名、编号——模拟标本卡上的打字机标注 |

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Spectral:ital,wght@0,300;0,500;1,400&family=Noto+Serif+SC:wght@400;600;900&family=Courier+Prime&display=swap" rel="stylesheet">
```

### 排版律动
- **大标题**：Fraunces 600，可混 italic 400 做"属名 + 拉丁学名"对照（如 `Taxon *taxonomia*`）
- **小标签**：Courier Prime，`letter-spacing: .22em`，`text-transform: uppercase`，`--ink2` 色——这是标本卡标注的关键质感
- **拉丁名**：Fraunces italic，`--ink2`，置于中文名下方做"学名"，是分类学的视觉签名
- **CJK 标题**：Noto Serif SC 600，可内嵌 Fraunces italic 的 sepia 强调（如「分类是一门 *博物学*」）

---

## 4. 标志母题：分类图版（Classification Plate）

这套语言**唯一不可替代的视觉签名**——把标签层级画成一张博物学分类图版：

- **标本点（specimen point）**：`0.5rem` 小圆
  - 空心描边（`--ink`）= 普通节点
  - 实心 `--leaf` = 活跃/已使用
  - 实心 `--rust` = 警示/异常
- **分类枝线（branch）**：用 SVG `path` 贝塞尔曲线连接父子，**模拟手绘墨线**（`--sepia`，1.2px）
- **学名标注**：每个标本中文名下挂 Fraunces italic 拉丁名
- **图版编号**：角落 `No. 001 / cuisine`、`Coll. 2026 · 568 spec.`（Courier Prime），把数据包装成标本馆藏品

> 这取代了通用饼图/折线图——**分类不该用卖鞋后台的饼图来画**。

---

## 5. 表面与纹理

陈年纸张质感，靠纯 CSS 分层渐变 + `mix-blend-mode: multiply` 实现，零图片依赖：

```css
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;
  background:
    /* foxing 霉斑点 */
    radial-gradient(circle at 18% 22%, rgba(138,109,59,.10), transparent 12%),
    radial-gradient(circle at 82% 68%, rgba(156,74,46,.07), transparent 14%),
    radial-gradient(circle at 60% 88%, rgba(138,109,59,.08), transparent 10%),
    /* 纸纤维横纹 */
    repeating-linear-gradient(94deg, transparent 0 6px, rgba(74,67,52,.012) 6px 7px);
  mix-blend-mode:multiply;
}
```

**发丝分隔线**：所有分区用 `1px solid var(--rule)`，masthead 用 `2px solid var(--ink)`——克制的线条层级建立"图版"的秩序感。

---

## 6. 组件草样

| 组件 | 规格 |
|------|------|
| **标本卡 / 列表行** | `--paper2` 底，`2px` 圆角（几乎方），hairline 分隔，左侧标本点 + 中文名 + 下挂拉丁名 |
| **标签 chip** | `border:1px solid var(--ink)`，`2px` 圆角，`--paper2` 底，可挂 Courier Prime 的 `№1.6k` 计数 |
| **Masthead 页头** | `2px` 下边框，左 Fraunces 大标题 + 思源副标，右 Courier Prime 元信息（编号/藏量/状态） |
| **色板 swatch** | `1px solid var(--ink)`，方形 `2px` 圆角——像标本盒里的色卡 |
| **页脚图版标签** | 上 hairline，左 Fraunces italic 大字（中文方向名），右 Courier Prime 英文（`HERBARIUM · LINNAEAN`） |

**圆角原则**：几乎全用 `2px`（近直角）。博物学图版是方正的，圆角越小越"档案"。

---

## 7. 动效

克制、有"书写感"，不要弹跳。

- **墨线生长（ink-draw）**：分类枝线用 `stroke-dasharray` + `stroke-dashoffset` 从 `400→0`，`1.8s ease`，配 `opacity 0→.8`——像墨水正在被画上纸
- **标本浮现（fade）**：标本点 `opacity 0→1`，错峰 `animation-delay`（0.2s 起每点 +0.1~0.15s），由根向叶生长
- **无限循环**：无。这套语言是"静物标本"，加载一次性书写完毕即静止——静止本身是它的气质
- 必带 `@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important}}`

---

## 8. 风险与注意

1. **可读性 > 风格**：纸色对比度低，高密度表格页（审核队列、检索结果）须验证 WCAG 对比度（`--ink` on `--paper` ≈ 9:1 OK；`--ink2` on `--paper` ≈ 4.5:1 临界，小字慎用）
2. **不要滥用纹理**：`multiply` 纸纹只在大背景，绝不叠在文字/输入框下
3. **拉丁名是装饰也是负担**：真实标签未必有英文 slug，缺失时降级为纯中文，不要硬造
4. **打字机字体仅限短标签**：Courier Prime 不可用于正文长句（等宽 CJK 间距差）

---

## 9. 落地映射（Tailwind / 目标技术栈）

目标是 `packages/console`（Next 16 + React 19 + Tailwind）。建议把 §2 token 写入 `globals.css` 的 `@theme` / `:root`，并映射：

```
--color-paper        → bg-surface
--color-ink          → text-ink
--color-ink2         → text-ink-sub
--color-sepia/leaf/rust → 强调/状态色
```

字体经 `next/font/google` 引入 Fraunces / Spectral / Noto Serif SC / Courier Prime，挂到 `--font-display / --font-body / --font-cjk / --font-mono`。分类图版用 SVG + 绝对定位节点（参考 `preview.html` 实现），可直接演进为实体图谱（见 issue #100/#101）。

---

*存档于 2026-05 的视觉语言探索。主方向见 `docs/design/mycelial/`。*
