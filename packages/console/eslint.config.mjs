// ESLint flat config (ESLint 9 / Next 16).
// eslint-config-next 16 exports ready-made flat config arrays.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // react-hooks v6 新增规则：在 effect 里 setState 做数据加载是本仓库的惯用模式，
      // 性能影响可接受，关闭此规则避免噪音。个别处如需额外抑制可用 inline disable。
      'react-hooks/set-state-in-effect': 'off',
      // immutability 规则：combobox 里 close() 已移至 useEffect 之前，此规则保留关闭。
      'react-hooks/immutability':        'off',
    },
  },
]

export default config
