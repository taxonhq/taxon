import { OpenAPIHono } from '@hono/zod-openapi'
import { auditRouter }       from './entity-audit.js'
import { registrationRouter } from './entity-registration.js'
import { taggingRouter }      from './entity-tagging.js'
import { suggestRouter }      from './entity-suggest.js'

const entities = new OpenAPIHono()

// 路由顺序很重要：
// 1. /audit          — 字面量路径，必须最先
// 2. suggestRouter   — /:type/:id/suggest（字面量 suggest，必须在 tagging 的 /:tagId 前）
// 3. taggingRouter   — 双段路径 /:type/:id/tags/*
// 4. registrationRouter — 包含 GET /:type（单段）和 POST/DELETE/GET /:type/:id
entities.route('/', auditRouter)
entities.route('/', suggestRouter)
entities.route('/', taggingRouter)
entities.route('/', registrationRouter)

export { entities }
