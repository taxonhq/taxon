/**
 * MycCanvas — 菌丝设计语言的「有机体即界面」背景层（#109 阶段 1）
 *
 * 当前为装饰性菌丝网络（静态结构 + 生长/辉光动画），铺满视口、pointer 透传。
 * 阶段 2 将由此演进为数据驱动的「标签有机体」组件，与实体图谱 #100/#101 共用渲染。
 *
 * `dim`：密集页传 true → 画布退后（降透明 + 模糊），让玻璃 sheet 成为焦点。
 */

import type { CSSProperties } from "react";

// 装饰节点：位置(%)、尺寸、荧光色、辉光周期、标签、可选计数
type KnotDef = {
  left: string; top: string; s: string; c: string; t: string; delay: string; label: string; n?: string;
};
const KNOTS: readonly KnotDef[] = [
  { left: "51.5%", top: "50%",   s: "clamp(30px,3.6vw,46px)", c: "var(--myc-bio)",   t: "2.6s", delay: ".3s",  label: "菜系",   n: "·3.4k" },
  { left: "72%",   top: "37.5%", s: "clamp(20px,2.4vw,32px)", c: "var(--myc-bio2)",  t: "3s",   delay: ".55s", label: "川菜",   n: "·1.6k" },
  { left: "32.5%", top: "44%",   s: "clamp(18px,2.2vw,28px)", c: "var(--myc-amber)", t: "3.3s", delay: ".7s",  label: "商品类目" },
  { left: "50%",   top: "80%",   s: "clamp(14px,1.7vw,21px)", c: "var(--myc-bio)",   t: "2.8s", delay: ".95s", label: "素食" },
  { left: "85%",   top: "59%",   s: "clamp(13px,1.6vw,19px)", c: "var(--myc-bio2)",  t: "3.4s", delay: "1.05s", label: "麻辣鲜香" },
  { left: "35.5%", top: "75%",   s: "clamp(12px,1.4vw,16px)", c: "var(--myc-amber)", t: "2.5s", delay: "1.15s", label: "海鲜" },
  { left: "69%",   top: "61%",   s: "clamp(11px,1.3vw,15px)", c: "var(--myc-bio)",   t: "3.1s", delay: "1.25s", label: "下饭" },
  { left: "17.5%", top: "41%",   s: "clamp(10px,1.2vw,14px)", c: "var(--myc-amber)", t: "2.7s", delay: "1.3s",  label: "清淡" },
] as const;

const HYPHAE = [
  { d: "M740,400 C860,350 920,280 1040,300", delay: ".2s" },
  { d: "M740,400 C600,360 540,300 470,350",  delay: ".4s" },
  { d: "M740,400 C740,520 690,560 720,640",  delay: ".55s" },
  { d: "M1040,300 C1140,360 1170,430 1220,470", delay: ".7s" },
  { d: "M470,350 C420,460 450,520 510,600",  delay: ".85s" },
  { d: "M720,640 C840,640 920,600 990,640",  delay: "1s" },
  { d: "M1040,300 C1000,420 930,440 880,490", delay: "1.1s" },
  { d: "M470,350 C360,330 320,300 250,330",  delay: "1.2s" },
] as const;

export function MycCanvas({ dim = false }: { dim?: boolean }) {
  return (
    <div className="myc-canvas" data-dim={dim} aria-hidden="true">
      <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice">
        {HYPHAE.map((h, i) => (
          <path key={i} className="myc-hypha" style={{ animationDelay: h.delay }} d={h.d} />
        ))}
      </svg>
      {KNOTS.map((k, i) => (
        <div key={i} className="myc-knot" style={{ left: k.left, top: k.top, animationDelay: k.delay }}>
          <div
            className="myc-cap"
            style={{ "--s": k.s, "--c": k.c, "--t": k.t } as CSSProperties}
          />
          <label>
            {k.label} {k.n && <span className="n">{k.n}</span>}
          </label>
        </div>
      ))}
    </div>
  );
}
