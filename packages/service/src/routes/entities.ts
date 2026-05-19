import { Hono } from 'hono'
import { auditRouter }       from './entity-audit.js'
import { registrationRouter } from './entity-registration.js'
import { taggingRouter }      from './entity-tagging.js'

const entities = new Hono()

// 路由顺序很重要：
// 1. /audit          — 字面量路径，必须最先
// 2. taggingRouter   — 双段路径 /:type/:id/tags/*
// 3. registrationRouter — 包含 GET /:type（单段）和 POST/DELETE/GET /:type/:id
entities.route('/', auditRouter)
entities.route('/', taggingRouter)
entities.route('/', registrationRouter)

export { entities }
