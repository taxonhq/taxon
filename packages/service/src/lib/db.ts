import { PrismaClient } from '@prisma/client'
import { dbQueryDuration } from './metrics.js'

const base = new PrismaClient()

// 用 $extends query 扩展采集每条 Prisma 操作的耗时
const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now()
        try {
          return await query(args)
        } finally {
          dbQueryDuration
            .labels(model ?? 'raw', operation)
            .observe((performance.now() - start) / 1000)
        }
      },
    },
  },
})

/**
 * 交互式事务客户端类型（来自 $extends 后的实例，非 base Prisma.TransactionClient）。
 * 供需要在事务内操作的工具函数（如 emitEvent）标注 tx 参数。
 */
export type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export default prisma
