import { Hono } from 'hono'
import { auditRouter }       from './entity-audit.js'
import { registrationRouter } from './entity-registration.js'
import { taggingRouter }      from './entity-tagging.js'

const entities = new Hono()

// /audit 和 /:entityType 必须在 /:entityType/:entityId 之前注册，避免参数路由吞掉字面量路径
entities.route('/', auditRouter)
entities.route('/', taggingRouter)
entities.route('/', registrationRouter)

export { entities }
