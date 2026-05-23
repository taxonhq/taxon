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

export default prisma
