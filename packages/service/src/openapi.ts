const ok  = (schema: object) => ({ description: '成功', content: { 'application/json': { schema } } })
const err = (desc: string, code = 400) => ({
  description: desc,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' }, example: { code, message: desc } } },
})

const securitySchemes = {
  BearerAuth: {
    type: 'http',
    scheme: 'bearer',
    description: 'API Token（从 `POST /tokens` 创建，或使用 env `API_TOKEN`）',
  },
}

const components = {
  securitySchemes,
  schemas: {
    ApiError: {
      type: 'object',
      description: '接口错误响应体',
      properties: {
        code:    { type: 'integer', description: '错误状态码（与 HTTP 状态码一致，非 0）', example: 404 },
        message: { type: 'string',  description: '错误描述信息', example: '资源不存在' },
      },
    },
    OkMessage: {
      type: 'object',
      description: '操作成功响应体',
      properties: {
        code:    { type: 'integer', description: '固定为 0', example: 0 },
        message: { type: 'string',  description: '操作结果描述', example: '操作成功' },
      },
    },
    RegisteredEntity: {
      type: 'object',
      description: '已注册实体',
      properties: {
        entityType:   { type: 'string',  description: '实体类型，如 dish / dining', example: 'dish' },
        entityId:     { type: 'string',  description: '业务系统中的实体唯一标识符', example: 'clx1234567890abcdef' },
        registeredAt: { type: 'string',  format: 'date-time', description: '注册时间 ISO 8601', example: '2026-05-10T00:00:00.000Z' },
      },
    },
    EntityRule: {
      type: 'object',
      description: '实体类型级别的多选规则覆盖（覆盖分组默认的 allowMultiple）',
      properties: {
        entityType:    { type: 'string',  description: '适用的实体类型', example: 'dish' },
        allowMultiple: { type: 'boolean', description: '该实体类型下是否允许打多个同分组标签', example: true },
      },
    },
    TagGroup: {
      type: 'object',
      description: '标签分组（标签维度，如菜系、口味、工艺等）',
      properties: {
        id:            { type: 'string',  description: '分组唯一 ID', example: 'clx1234567890abcdef' },
        slug:          { type: 'string',  description: '唯一标识符，创建后不可修改，格式 /^[a-z0-9][a-z0-9_-]*$/', example: 'cuisine' },
        name:          { type: 'string',  description: '分组显示名称', example: '菜系' },
        description:   { type: 'string',  description: '分组描述', example: '菜品所属烹饪流派' },
        entityScopes:  { type: 'array', items: { type: 'string' }, description: '适用的实体类型白名单，空数组表示通用（所有类型）', example: ['dish'] },
        allowMultiple: { type: 'boolean', description: '默认是否允许多选，可被 entityRules 按实体类型覆盖', example: false },
        sortOrder:     { type: 'integer', description: '排序权重，数值越小越靠前', example: 0 },
        createdAt:     { type: 'string',  format: 'date-time', example: '2026-05-10T00:00:00.000Z' },
        updatedAt:     { type: 'string',  format: 'date-time', example: '2026-05-10T00:00:00.000Z' },
      },
    },
    TagGroupFull: {
      allOf: [
        { $ref: '#/components/schemas/TagGroup' },
        {
          type: 'object',
          properties: {
            _count: {
              type: 'object',
              description: '关联统计',
              properties: {
                tags: { type: 'integer', description: '分组内有效标签数量（不含软删除）', example: 12 },
              },
            },
            entityRules: {
              type: 'array',
              items: { $ref: '#/components/schemas/EntityRule' },
              description: '实体类型级别的 allowMultiple 覆盖规则列表',
            },
          },
        },
      ],
    },
    Tag: {
      type: 'object',
      description: '标签（分组内的具体标签值）',
      properties: {
        id:          { type: 'string',  description: '标签唯一 ID', example: 'clx0000000000tag001' },
        groupId:     { type: 'string',  description: '所属分组 ID', example: 'clx1234567890abcdef' },
        parentId:    { type: 'string',  nullable: true, description: '父标签 ID，null 表示根节点', example: null },
        slug:        { type: 'string',  description: '唯一标识符，格式 /^[a-z0-9][a-z0-9_-]*$/', example: 'sichuan' },
        name:        { type: 'string',  description: '标签显示名称', example: '川菜' },
        description: { type: 'string',  description: '标签描述', example: '四川风味' },
        sortOrder:   { type: 'integer', description: '排序权重', example: 0 },
        path:        { type: 'string',  description: '物化路径，格式 /slug1/slug2/，用于祖先/后代高效查询', example: '/cuisine/chinese/sichuan/' },
        depth:       { type: 'integer', description: '节点深度，根节点为 0，最大 5', example: 2 },
        createdAt:   { type: 'string',  format: 'date-time', example: '2026-05-10T00:00:00.000Z' },
        updatedAt:   { type: 'string',  format: 'date-time', example: '2026-05-10T00:00:00.000Z' },
      },
    },
    TagAlias: {
      type: 'object',
      description: '标签别名（同义词）',
      properties: {
        id:        { type: 'string',  description: '别名记录唯一 ID', example: 'clx0000000000als001' },
        tagId:     { type: 'string',  description: '所属标签 ID', example: 'clx0000000000tag001' },
        alias:     { type: 'string',  description: '别名文本（分组内唯一）', example: '四川菜' },
        source:    { type: 'string',  enum: ['manual', 'ai', 'import'], description: '别名来源', example: 'manual' },
        createdAt: { type: 'string',  format: 'date-time', example: '2026-05-22T00:00:00.000Z' },
      },
    },
    TagTreeNode: {
      allOf: [
        { $ref: '#/components/schemas/Tag' },
        {
          type: 'object',
          properties: {
            children: {
              type: 'array',
              description: '子节点列表（递归结构）',
              items: { $ref: '#/components/schemas/TagTreeNode' },
            },
            aliases: {
              type: 'array',
              description: '标签别名列表',
              items: { $ref: '#/components/schemas/TagAlias' },
            },
            _count: {
              type: 'object',
              properties: { entityTags: { type: 'integer', description: '使用该标签的活跃实体数', example: 3 } },
            },
          },
        },
      ],
    },
    TagWithGroup: {
      allOf: [
        { $ref: '#/components/schemas/Tag' },
        {
          type: 'object',
          properties: {
            group: {
              type: 'object',
              description: '所属标签分组（简要信息）',
              properties: {
                id:   { type: 'string',  example: 'clx1234567890abcdef' },
                slug: { type: 'string',  example: 'cuisine' },
                name: { type: 'string',  example: '菜系' },
              },
            },
          },
        },
      ],
    },
    TagWithCount: {
      allOf: [
        { $ref: '#/components/schemas/Tag' },
        {
          type: 'object',
          properties: {
            _count: {
              type: 'object',
              properties: { entityTags: { type: 'integer', description: '使用该标签的实体关联数量', example: 5 } },
            },
          },
        },
      ],
    },
    EntityTagItem: {
      type: 'object',
      description: '实体标签关联记录（含标签元信息及审核状态）',
      properties: {
        id:         { type: 'string',  description: '标签 ID', example: 'clx0000000000tag001' },
        slug:       { type: 'string',  description: '标签 slug', example: 'sichuan' },
        name:       { type: 'string',  description: '标签名称', example: '川菜' },
        groupId:    { type: 'string',  description: '所属分组 ID', example: 'clx1234567890abcdef' },
        group: {
          type: 'object',
          description: '所属分组（简要信息）',
          properties: {
            id:   { type: 'string',  example: 'clx1234567890abcdef' },
            slug: { type: 'string',  example: 'cuisine' },
            name: { type: 'string',  example: '菜系' },
          },
        },
        source:     { type: 'string',  enum: ['manual', 'ai', 'system', 'import'], description: '打标来源', example: 'manual' },
        confidence: { type: 'number',  nullable: true, minimum: 0, maximum: 1, description: 'AI 置信度（仅 source=ai 时有值，其余为 null）', example: 0.95 },
        status:     { type: 'string',  enum: ['active', 'pending', 'rejected'], description: '审核状态；AI 打标默认为 pending，人工打标默认为 active', example: 'active' },
        taggedAt:   { type: 'string',  format: 'date-time', description: '打标时间', example: '2026-05-10T00:00:00.000Z' },
        reviewedAt: { type: 'string',  format: 'date-time', nullable: true, description: '最后一次审核操作时间（status 变更时设置）', example: '2026-05-19T10:00:00.000Z' },
      },
    },
    AuditItem: {
      type: 'object',
      description: '审核队列中的标签关联记录',
      properties: {
        tagId:        { type: 'string',  description: '标签 ID', example: 'clx0000000000tag001' },
        entityType:   { type: 'string',  description: '实体类型', example: 'dish' },
        entityId:     { type: 'string',  description: '实体 ID', example: 'clx1234567890abcdef' },
        source:       { type: 'string',  enum: ['manual', 'ai', 'system', 'import'], description: '打标来源', example: 'ai' },
        confidence:   { type: 'number',  nullable: true, minimum: 0, maximum: 1, description: 'AI 置信度', example: 0.92 },
        status:       { type: 'string',  enum: ['active', 'pending', 'rejected'], description: '当前审核状态', example: 'pending' },
        taggedAt:     { type: 'string',  format: 'date-time', description: '打标时间', example: '2026-05-10T00:00:00.000Z' },
        reviewedAt:   { type: 'string',  format: 'date-time', nullable: true, description: '最后一次审核操作时间', example: null },
        reviewNote:   { type: 'string',  nullable: true, description: '最后一次审核备注', example: null },
        reviewerName: { type: 'string',  nullable: true, description: '最后一次审核者 Token 名称', example: null },
        tag: {
          type: 'object',
          description: '关联的标签及其分组信息',
          properties: {
            id:    { type: 'string', example: 'clx0000000000tag001' },
            slug:  { type: 'string', example: 'sichuan' },
            name:  { type: 'string', example: '川菜' },
            group: {
              type: 'object',
              properties: {
                id:   { type: 'string', example: 'clx1234567890abcdef' },
                slug: { type: 'string', example: 'cuisine' },
                name: { type: 'string', example: '菜系' },
              },
            },
          },
        },
      },
    },
    EntityTagReview: {
      type: 'object',
      description: '单次审核操作记录（历史时间线中的一条）',
      properties: {
        id:         { type: 'string',  description: '记录 ID', example: 'clx0000000000rev001' },
        fromStatus: { type: 'string',  enum: ['active', 'pending', 'rejected'], description: '操作前的状态', example: 'pending' },
        toStatus:   { type: 'string',  enum: ['active', 'pending', 'rejected'], description: '操作后的状态', example: 'active' },
        note:       { type: 'string',  nullable: true, description: '审核备注', example: '置信度高，确认通过' },
        reviewedAt: { type: 'string',  format: 'date-time', description: '审核操作时间', example: '2026-05-22T10:00:00.000Z' },
        reviewer: {
          nullable: true,
          type: 'object',
          description: '审核者 Token 信息（dev-bypass 时为 null）',
          properties: {
            id:   { type: 'string',  example: 'clx0000000000tok001' },
            name: { type: 'string',  example: 'reviewer-team' },
            role: { type: 'string',  enum: ['reader', 'writer', 'reviewer', 'admin'], example: 'reviewer' },
          },
        },
      },
    },
    EntityFilterResponse: {
      type: 'object',
      description: '标签过滤模式的分页响应',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entityType: { type: 'string', example: 'dish' },
                  entityId:   { type: 'string', example: 'clx1234567890abcdef' },
                },
              },
              description: '满足过滤条件的实体列表',
            },
            total:    { type: 'integer', description: '总条数', example: 100 },
            page:     { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
          },
        },
      },
    },
    ApiToken: {
      type: 'object',
      description: 'API Token 记录（不含明文）',
      properties: {
        id:         { type: 'string', description: 'Token ID', example: 'clx0000000000tok001' },
        name:       { type: 'string', description: '人类可读标识', example: 'restaurant-service' },
        role:       { type: 'string', enum: ['reader', 'writer', 'reviewer', 'admin'], description: '权限角色', example: 'writer' },
        scopes:     { type: 'array', items: { type: 'string' }, description: 'entityType 白名单，空数组表示不限', example: [] },
        createdAt:  { type: 'string', format: 'date-time', example: '2026-05-22T00:00:00.000Z' },
        lastUsedAt: { type: 'string', format: 'date-time', nullable: true, description: '最近认证时间', example: null },
        revokedAt:  { type: 'string', format: 'date-time', nullable: true, description: '撤销时间，非 null 表示已撤销', example: null },
      },
    },
    // ── Response wrappers ──────────────────────────────────────────
    TagGroupResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: { $ref: '#/components/schemas/TagGroupFull' },
      },
    },
    TagGroupListResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            items:    { type: 'array', items: { $ref: '#/components/schemas/TagGroupFull' } },
            total:    { type: 'integer', description: '总条数', example: 8 },
            page:     { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
          },
        },
      },
    },
    TagResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: { $ref: '#/components/schemas/TagWithGroup' },
      },
    },
    TagListPaginatedResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            items:    { type: 'array', items: { $ref: '#/components/schemas/TagWithCount' } },
            total:    { type: 'integer', example: 13 },
            page:     { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
          },
        },
      },
    },
    TagWithGroupListResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            items:    { type: 'array', items: { $ref: '#/components/schemas/TagWithGroup' } },
            total:    { type: 'integer', example: 42 },
            page:     { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
          },
        },
      },
    },
    EntityTagListResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/EntityTagItem' },
        },
      },
    },
    EntityListResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            items:    { type: 'array', items: { $ref: '#/components/schemas/RegisteredEntity' } },
            total:    { type: 'integer', description: '总条数', example: 20 },
            page:     { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
          },
        },
      },
    },
    AuditListResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            items:    { type: 'array', items: { $ref: '#/components/schemas/AuditItem' } },
            total:    { type: 'integer', description: '总条数', example: 5 },
            page:     { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
          },
        },
      },
    },
  },
  parameters: {
    EntityType: {
      name: 'entityType', in: 'path', required: true,
      description: '实体类型，由业务方自定义，如 dish / dining / product',
      schema: { type: 'string', example: 'dish' },
    },
    EntityId: {
      name: 'entityId', in: 'path', required: true,
      description: '业务系统中的实体唯一标识符',
      schema: { type: 'string', example: 'clx1234567890abcdef' },
    },
    TagId: {
      name: 'tagId', in: 'path', required: true,
      description: '标签 ID',
      schema: { type: 'string', example: 'clx0000000000tag001' },
    },
    GroupId: {
      name: 'groupId', in: 'path', required: true,
      description: '标签分组 ID',
      schema: { type: 'string', example: 'clx1234567890abcdef' },
    },
    AliasId: {
      name: 'aliasId', in: 'path', required: true,
      description: '别名记录 ID',
      schema: { type: 'string', example: 'clx0000000000als001' },
    },
  },
}

export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Taxon',
    version: '1.0.0',
    description: '独立标签服务，端口 3300。\n\n提供实体注册、标签分组/标签管理、实体打标等能力，可被任意业务服务通过 HTTP 调用。\n\n**认证：** 除 `/health` 外所有接口均需 `Authorization: Bearer <token>`。Token 通过 `POST /tokens`（需 admin）创建；开发环境可通过 env `API_TOKEN` 设置 admin 兜底 token。\n\n**实体生命周期：** 业务服务在创建实体时调用 `POST /entities/:type/:id` 注册，删除实体时调用 `DELETE /entities/:type/:id` 注销，注销时所有标签关联由数据库 CASCADE 自动清理。\n\n**AI 打标工作流：** 通过 `source: "ai"` 打标的记录默认为 `pending` 状态，需通过 `PATCH /entities/:type/:id/tags/:tagId` 人工审核通过（`active`）或拒绝（`rejected`）。',
  },
  servers: [{ url: 'http://localhost:3300', description: '本地开发环境' }],
  security: [{ BearerAuth: [] }],
  tags: [
    { name: '系统',       description: '服务健康检查' },
    { name: 'Token 管理', description: 'API Token 的创建、列表与撤销（需 admin 权限）' },
    { name: '实体',       description: '实体注册、注销及查询' },
    { name: '实体标签',   description: '为已注册实体打标、摘标、审核' },
    { name: '标签分组',   description: '标签维度管理（菜系/口味/工艺等）' },
    { name: '标签',       description: '分组内的具体标签值' },
    { name: '实体类型',   description: '统计已注册的实体类型分布' },
  ],
  components,
  paths: {

    /* ── /health ────────────────────────────────────────────── */
    '/health/live': {
      get: {
        tags: ['系统'],
        operationId: 'healthLive',
        summary: 'Liveness probe',
        description: '进程存活检查。只要进程在运行即返回 200，无数据库依赖。适合 K8s liveness probe。无需认证。',
        security: [],
        responses: {
          '200': {
            description: '进程正常',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'], example: 'ok' } } } } },
          },
        },
      },
    },

    '/health/ready': {
      get: {
        tags: ['系统'],
        operationId: 'healthReady',
        summary: 'Readiness probe',
        description: '就绪检查。数据库可达时返回 200，否则 503。适合 K8s readiness probe 和负载均衡检查。无需认证。',
        security: [],
        responses: {
          '200': {
            description: '服务就绪',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'], example: 'ok' }, db: { type: 'string', enum: ['ok'], example: 'ok' } } } } },
          },
          '503': {
            description: '数据库不可用',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['degraded'], example: 'degraded' }, db: { type: 'string', enum: ['error'], example: 'error' } } } } },
          },
        },
      },
    },

    '/health': {
      get: {
        tags: ['系统'],
        operationId: 'healthCheck',
        summary: '服务健康检查（完整）',
        description: '返回服务版本、DB 状态和时间戳。兼容旧客户端；新客户端推荐使用 /health/live 和 /health/ready。无需认证。',
        security: [],
        responses: {
          '200': {
            description: '服务正常',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:      { type: 'string', enum: ['ok'],        example: 'ok' },
                    db:          { type: 'string', enum: ['ok'],        example: 'ok' },
                    timestamp:   { type: 'string', format: 'date-time', example: '2026-05-18T00:00:00.000Z' },
                    version:     { type: 'string', description: '服务版本号',    example: '0.1.0' },
                    nodeVersion: { type: 'string', description: 'Node.js 版本', example: 'v23.11.0' },
                  },
                },
              },
            },
          },
          '503': {
            description: '数据库不可用',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:      { type: 'string', enum: ['degraded'], example: 'degraded' },
                    db:          { type: 'string', enum: ['error'],    example: 'error' },
                    timestamp:   { type: 'string', format: 'date-time' },
                    version:     { type: 'string', example: '0.1.0' },
                    nodeVersion: { type: 'string', example: 'v23.11.0' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/metrics': {
      get: {
        tags: ['系统'],
        operationId: 'getMetrics',
        summary: 'Prometheus 指标',
        description: '以 Prometheus text exposition 格式暴露 HTTP 请求计数、延迟分布、DB 查询耗时、待审标签数量等指标。供 Prometheus scrape 使用。无需认证。',
        security: [],
        responses: {
          '200': {
            description: 'Prometheus 指标文本',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },

    /* ── /tokens ────────────────────────────────────────────── */
    '/tokens': {
      get: {
        tags: ['Token 管理'],
        operationId: 'listTokens',
        summary: '列出所有 API Token',
        description: '返回所有 Token 记录（不含明文），包含已撤销的。**需要 admin 权限。**',
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: { type: 'array', items: { $ref: '#/components/schemas/ApiToken' } },
            },
          }),
          '401': err('未提供 Bearer Token', 401),
          '403': err('需要 admin 权限', 403),
        },
      },
      post: {
        tags: ['Token 管理'],
        operationId: 'createToken',
        summary: '创建 API Token',
        description: '生成新 Token，**明文仅在此响应中返回一次**，请立即复制保存。\n\n**需要 admin 权限。**\n\n角色说明：`reader`（只读）< `writer`（打标）< `reviewer`（审核）< `admin`（全权限）。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'role'],
                properties: {
                  name:   { type: 'string', description: '人类可读标识，如服务名', example: 'restaurant-service' },
                  role:   { type: 'string', enum: ['reader', 'writer', 'reviewer', 'admin'], example: 'writer' },
                  scopes: { type: 'array', items: { type: 'string' }, description: 'entityType 白名单，空数组表示不限', example: [] },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                allOf: [
                  { $ref: '#/components/schemas/ApiToken' },
                  {
                    type: 'object',
                    required: ['token'],
                    properties: {
                      token: { type: 'string', description: '明文 Token，仅此一次返回', example: 'ct_a1b2c3d4...' },
                    },
                  },
                ],
              },
            },
          }),
          '400': err('name 或 role 缺失 / role 值无效', 400),
          '401': err('未提供 Bearer Token', 401),
          '403': err('需要 admin 权限', 403),
        },
      },
    },

    '/tokens/{id}': {
      delete: {
        tags: ['Token 管理'],
        operationId: 'revokeToken',
        summary: '撤销 API Token',
        description: '设置 `revokedAt` 时间戳，撤销后立即失效，不可恢复。**需要 admin 权限。**',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Token ID', schema: { type: 'string' } },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '401': err('未提供 Bearer Token', 401),
          '403': err('需要 admin 权限', 403),
          '404': err('Token 不存在', 404),
        },
      },
    },

    /* ── /entity-types ──────────────────────────────────────── */
    '/entity-types': {
      get: {
        tags: ['实体类型'],
        operationId: 'listEntityTypes',
        summary: '获取已注册实体类型分布',
        description: '返回所有已注册过实体的类型及数量统计，可作为 `entityScopes` 的合法值参考。',
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entityType: { type: 'string',  description: '实体类型', example: 'dish' },
                    count:      { type: 'integer', description: '已注册实体数量', example: 42 },
                  },
                },
              },
            },
          }),
        },
      },
    },

    /* ── /entities/audit ────────────────────────────────────── */
    '/entities/audit': {
      get: {
        tags: ['实体标签'],
        operationId: 'listAuditQueue',
        summary: '获取审核队列',
        description: '返回待审核（或指定状态）的标签关联列表，支持多种过滤条件，按打标时间降序排列。\n\n响应中的 `reviewNote` 和 `reviewerName` 仅在审核过的记录上有值（pending 时通常为 null）。',
        parameters: [
          {
            name: 'status', in: 'query',
            description: '审核状态过滤，默认 pending',
            schema: { type: 'string', enum: ['active', 'pending', 'rejected'], default: 'pending' },
          },
          {
            name: 'entityType', in: 'query',
            description: '按实体类型过滤',
            schema: { type: 'string', example: 'dish' },
          },
          {
            name: 'reviewerId', in: 'query',
            description: '按最后一次审核者 Token ID 过滤',
            schema: { type: 'string', example: 'clx0000000000tok001' },
          },
          {
            name: 'from', in: 'query',
            description: '审核时间下界（ISO 8601），与 reviewedAt 字段对应',
            schema: { type: 'string', format: 'date-time', example: '2026-05-01T00:00:00.000Z' },
          },
          {
            name: 'to', in: 'query',
            description: '审核时间上界（ISO 8601）',
            schema: { type: 'string', format: 'date-time', example: '2026-05-31T23:59:59.999Z' },
          },
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/AuditListResponse' }),
          '400': err('status 参数值无效', 400),
        },
      },
    },

    /* ── /entities/{entityType} ─────────────────────────────── */
    '/entities/{entityType}': {
      get: {
        tags: ['实体'],
        operationId: 'listEntities',
        summary: '查询实体列表',
        description: '该接口有两种工作模式，根据传入参数自动切换，均返回 `{ items, total, page, pageSize }` 分页结构：\n\n**标签过滤模式**（传入 `tagId` 或 `q`）：返回满足条件的实体列表，`items` 为 `{ entityType, entityId }` 对象数组。\n- `tagId` 可重复传入多个，返回**同时持有所有指定标签**的实体（AND 语义）\n- `q` 按标签名模糊匹配，返回拥有匹配标签的实体（OR 语义）\n- 两者可组合（先 AND 再 AND）\n\n**分页列表模式**（不传 `tagId` 和 `q`）：返回该类型下已注册实体的完整分页列表，`items` 含 `registeredAt`，支持 `search` 模糊过滤实体 ID。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          {
            name: 'tagId', in: 'query',
            description: '【标签过滤模式】标签 ID，可重复传入多个（AND 语义）',
            schema: { type: 'string', example: 'clx0000000000tag001' },
          },
          {
            name: 'q', in: 'query',
            description: '【标签过滤模式】标签名模糊搜索关键词（OR 语义）',
            schema: { type: 'string', example: '川菜' },
          },
          {
            name: 'search', in: 'query',
            description: '【分页列表模式】按实体 ID 模糊搜索',
            schema: { type: 'string', example: 'cmov8jq' },
          },
          { name: 'page',     in: 'query', description: '【分页列表模式】页码', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', description: '【分页列表模式】每页条数', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: '成功（响应结构取决于模式）',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/EntityFilterResponse', description: '标签过滤模式返回（传 tagId / q）' },
                    { $ref: '#/components/schemas/EntityListResponse',   description: '分页列表模式返回（无 tagId / q）' },
                  ],
                },
              },
            },
          },
        },
      },
    },

    /* ── /entities/{entityType}/{entityId} ──────────────────── */
    '/entities/{entityType}/{entityId}': {
      post: {
        tags: ['实体'],
        operationId: 'registerEntity',
        summary: '注册实体',
        description: '将业务实体登记到 tag-service，之后才能对该实体打标。**幂等**：重复注册不会报错。\n\n业务服务应在创建实体时调用此接口。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '500': err('注册失败', 500),
        },
      },
      delete: {
        tags: ['实体'],
        operationId: 'unregisterEntity',
        summary: '注销实体',
        description: '从 tag-service 删除实体记录，**数据库 CASCADE 自动清除该实体的所有标签关联**，无需额外调用。\n\n业务服务应在删除实体时调用此接口。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '404': err('实体未注册', 404),
          '500': err('注销失败', 500),
        },
      },
      get: {
        tags: ['实体'],
        operationId: 'getEntity',
        summary: '查询实体注册信息',
        description: '确认实体是否已注册，返回注册时间。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
        ],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: { $ref: '#/components/schemas/RegisteredEntity' },
            },
          }),
          '404': err('实体未注册', 404),
        },
      },
    },

    /* ── /entities/{entityType}/{entityId}/tags ─────────────── */
    '/entities/{entityType}/{entityId}/tags': {
      get: {
        tags: ['实体标签'],
        operationId: 'getEntityTags',
        summary: '查询实体的标签',
        description: '返回实体当前的标签列表，每条记录含所属分组信息及审核状态，按打标时间升序排列。\n\n默认只返回 `active` 状态的标签；传 `?status=all` 返回全部状态；传 `?status=pending` 只返回待审核标签。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          {
            name: 'status', in: 'query',
            description: '按审核状态过滤；不传默认为 active；传 all 返回全部状态',
            schema: { type: 'string', enum: ['active', 'pending', 'rejected', 'all'], default: 'active' },
          },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/EntityTagListResponse' }),
          '404': err('实体未注册', 404),
        },
      },
      put: {
        tags: ['实体标签'],
        operationId: 'setEntityTags',
        summary: '全量替换实体标签',
        description: '在同一事务内删除现有标签并写入新标签。传空 `tagIds` 数组则清空所有标签。重复的 tagId 会自动去重。\n\n违反 `entityScopes` 或 `allowMultiple` 约束时返回 422。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tagIds'],
                properties: {
                  tagIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '新标签 ID 列表，重复项自动去重，传空数组清空所有标签',
                    example: ['clx0000000000tag001', 'clx0000000000tag002'],
                  },
                  source: {
                    type: 'string',
                    enum: ['manual', 'ai', 'system', 'import'],
                    default: 'manual',
                    description: '打标来源',
                  },
                  confidence: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'AI 置信度，source=ai 时必填',
                    example: 0.95,
                  },
                  status: {
                    type: 'string',
                    enum: ['active', 'pending', 'rejected'],
                    description: '初始审核状态；不传时 ai 来源默认 pending，其余默认 active',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '400': err('请求体格式错误或 source/confidence/status 参数无效', 400),
          '404': err('实体未注册', 404),
          '422': err('entityScopes 不匹配或分组不允许多选', 422),
          '500': err('更新失败', 500),
        },
      },
    },

    /* ── /entities/{entityType}/{entityId}/tags/{tagId} ─────── */
    '/entities/{entityType}/{entityId}/tags/{tagId}': {
      post: {
        tags: ['实体标签'],
        operationId: 'addEntityTag',
        summary: '增量打标',
        description: '为实体追加单个标签。若实体未注册会自动注册。违反 `entityScopes` 或 `allowMultiple` 约束时返回 422。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          { $ref: '#/components/parameters/TagId' },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  source: {
                    type: 'string',
                    enum: ['manual', 'ai', 'system', 'import'],
                    default: 'manual',
                    description: '打标来源',
                  },
                  confidence: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'AI 置信度，source=ai 时必填',
                    example: 0.95,
                  },
                  status: {
                    type: 'string',
                    enum: ['active', 'pending', 'rejected'],
                    description: '初始审核状态；不传时 ai 来源默认 pending，其余默认 active',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '400': err('source/confidence/status 参数无效', 400),
          '404': err('标签不存在', 404),
          '409': err('标签已存在', 409),
          '422': err('entityScopes 不匹配或分组不允许多选', 422),
          '500': err('打标失败', 500),
        },
      },
      patch: {
        tags: ['实体标签'],
        operationId: 'updateEntityTagStatus',
        summary: '审核标签（通过/拒绝）',
        description: '更新标签关联的审核状态，并写入一条 EntityTagReview 历史记录。\n\n- 设为 `active` = 审核通过\n- 设为 `rejected` = 审核拒绝\n- 设为 `pending` = 重置为待审核\n\n`note` 可选，写入后可在历史时间线和审核列表中查看。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          { $ref: '#/components/parameters/TagId' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['active', 'pending', 'rejected'],
                    description: '目标审核状态',
                    example: 'active',
                  },
                  note: {
                    type: 'string',
                    description: '审核备注（可选），写入历史记录',
                    example: '置信度高，图像与标签高度吻合',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '400': err('status 参数缺失或无效', 400),
          '404': err('标签关联不存在', 404),
          '500': err('更新失败', 500),
        },
      },
      delete: {
        tags: ['实体标签'],
        operationId: 'removeEntityTag',
        summary: '摘标',
        description: '移除实体的某个标签关联。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          { $ref: '#/components/parameters/TagId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '404': err('关联不存在', 404),
          '500': err('摘标失败', 500),
        },
      },
    },

    /* ── /entities/{entityType}/{entityId}/tags/{tagId}/history */
    '/entities/{entityType}/{entityId}/tags/{tagId}/history': {
      get: {
        tags: ['实体标签'],
        operationId: 'getEntityTagHistory',
        summary: '查看标签审核历史时间线',
        description: '返回指定实体标签关联的完整审核历史，按时间升序排列。每次 `PATCH` 状态变更都会生成一条记录。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          { $ref: '#/components/parameters/TagId' },
        ],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'array',
                items: { $ref: '#/components/schemas/EntityTagReview' },
              },
            },
          }),
          '404': err('关联不存在', 404),
        },
      },
    },

    /* ── /tag-groups ────────────────────────────────────────── */
    '/tag-groups': {
      post: {
        tags: ['标签分组'],
        operationId: 'createTagGroup',
        summary: '创建标签分组',
        description: '`slug` 必填且创建后不可修改，格式须符合 `/^[a-z0-9][a-z0-9_-]*$/`（最长 100 字符）。`name` 最长 100 字符，`description` 最长 200 字符。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['slug', 'name'],
                properties: {
                  slug:          { type: 'string', maxLength: 50, pattern: '^[a-z0-9][a-z0-9_-]*$', example: 'cuisine' },
                  name:          { type: 'string', maxLength: 50, example: '菜系' },
                  description:   { type: 'string', maxLength: 200, example: '菜品所属烹饪流派' },
                  entityScopes:  { type: 'array', items: { type: 'string' }, description: '适用实体类型白名单，空数组=通用', example: ['dish'] },
                  allowMultiple: { type: 'boolean', default: true,  description: '默认是否允许多选，可被 entityRules 覆盖', example: false },
                  sortOrder:     { type: 'integer', default: 0, example: 0 },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagGroupResponse' }),
          '400': err('必填字段缺失或格式错误', 400),
          '409': err('slug 或 name 已存在', 409),
          '500': err('创建失败', 500),
        },
      },
      get: {
        tags: ['标签分组'],
        operationId: 'listTagGroups',
        summary: '获取标签分组列表',
        description: '支持按实体类型过滤（`scope` 参数可重复，多值之间为 OR 语义：返回 entityScopes 包含任一指定类型或为通用的分组）。',
        parameters: [
          {
            name: 'scope', in: 'query',
            description: '按实体类型过滤，可重复传多个（OR 语义）',
            schema: { type: 'string', example: 'dish' },
          },
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: { '200': ok({ $ref: '#/components/schemas/TagGroupListResponse' }) },
      },
    },

    '/tag-groups/{groupId}': {
      get: {
        tags: ['标签分组'],
        operationId: 'getTagGroup',
        summary: '获取分组详情',
        description: '返回分组完整信息，包含标签数量统计（`_count.tags`）和实体类型规则列表（`entityRules`）。',
        parameters: [{ $ref: '#/components/parameters/GroupId' }],
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagGroupResponse' }),
          '404': err('标签分组不存在', 404),
        },
      },
      patch: {
        tags: ['标签分组'],
        operationId: 'updateTagGroup',
        summary: '更新标签分组',
        description: '`slug` 字段支持修改，但须符合格式约束且不与其他分组冲突。\n\n将 `allowMultiple` 从 `true` 改为 `false` 时，若已有实体在该分组下打了多个标签，接口返回 409。',
        parameters: [{ $ref: '#/components/parameters/GroupId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                minProperties: 1,
                description: '至少传一个字段',
                properties: {
                  slug:          { type: 'string', maxLength: 50, pattern: '^[a-z0-9][a-z0-9_-]*$' },
                  name:          { type: 'string', maxLength: 50 },
                  description:   { type: 'string', maxLength: 200 },
                  entityScopes:  { type: 'array', items: { type: 'string' } },
                  allowMultiple: { type: 'boolean' },
                  sortOrder:     { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagGroupResponse' }),
          '400': err('未提供任何可更新字段', 400),
          '404': err('标签分组不存在', 404),
          '409': err('name 已存在，或 allowMultiple 改为 false 时已有多标签实体', 409),
          '500': err('更新失败', 500),
        },
      },
      delete: {
        tags: ['标签分组'],
        operationId: 'deleteTagGroup',
        summary: '删除标签分组',
        description: '软删除：设置 `deletedAt` 并在 slug/name 后追加 `__deleted__` 后缀，以释放唯一约束供重新创建。onDelete: Cascade 自动清除分组下所有标签及实体关联，无需应用层手动处理。\n\n默认在有实体关联时返回 409；传 `?force=true` 可强制删除。',
        parameters: [
          { $ref: '#/components/parameters/GroupId' },
          { name: 'force', in: 'query', description: '强制删除（忽略关联检查）', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '404': err('标签分组不存在', 404),
          '409': err('有实体关联，请添加 ?force=true', 409),
          '500': err('删除失败', 500),
        },
      },
    },

    '/tag-groups/{groupId}/tags': {
      get: {
        tags: ['标签分组'],
        operationId: 'listGroupTags',
        summary: '获取分组内标签列表',
        description: '返回指定分组下的标签列表（不含软删除），每条记录包含使用该标签的实体关联数（`_count.entityTags`）。',
        parameters: [
          { $ref: '#/components/parameters/GroupId' },
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagListPaginatedResponse' }),
          '404': err('标签分组不存在', 404),
        },
      },
    },

    '/tag-groups/{groupId}/tree': {
      get: {
        tags: ['标签分组'],
        operationId: 'getTagGroupTree',
        summary: '获取分组标签树',
        description: '一次性返回分组内所有有效标签，以树形结构（嵌套 children）组织，前端可直接渲染层级视图。',
        parameters: [{ $ref: '#/components/parameters/GroupId' }],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: { type: 'array', items: { $ref: '#/components/schemas/TagTreeNode' }, description: '根节点列表' },
            },
          }),
          '404': err('标签分组不存在', 404),
        },
      },
    },

    '/tag-groups/{groupId}/entity-rules': {
      put: {
        tags: ['标签分组'],
        operationId: 'setGroupEntityRules',
        summary: '全量替换实体类型规则',
        description: '以传入的 `rules` 数组**全量替换**该分组的实体类型多选规则（先删后写，在同一事务内完成）。每条规则覆盖该实体类型下的 `allowMultiple` 默认值。\n\n传空数组清空所有规则（全部使用分组默认值）。',
        parameters: [{ $ref: '#/components/parameters/GroupId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['rules'],
                properties: {
                  rules: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/EntityRule' },
                    description: '规则列表，传空数组清空所有规则',
                    example: [{ entityType: 'dish', allowMultiple: false }, { entityType: 'dining', allowMultiple: true }],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'array',
                items: { $ref: '#/components/schemas/EntityRule' },
                description: '更新后的完整规则列表',
              },
            },
          }),
          '400': err('请求体格式错误', 400),
          '404': err('标签分组不存在', 404),
          '500': err('更新失败', 500),
        },
      },
    },

    /* ── /tags ──────────────────────────────────────────────── */
    '/tags': {
      get: {
        tags: ['标签'],
        operationId: 'listTags',
        summary: '获取标签列表',
        description: '支持按分组过滤（`groupId`）和名称模糊搜索（`q`），返回结果含所属分组简要信息及使用数量统计。',
        parameters: [
          {
            name: 'groupId', in: 'query',
            description: '按分组 ID 过滤',
            schema: { type: 'string', example: 'clx1234567890abcdef' },
          },
          {
            name: 'q', in: 'query',
            description: '标签名称模糊搜索关键词',
            schema: { type: 'string', example: '川' },
          },
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagWithGroupListResponse' }),
        },
      },
      post: {
        tags: ['标签'],
        operationId: 'createTag',
        summary: '创建标签',
        description: '`slug` 可选，未传时从 `name` 自动生成拼音。`parentId` 可选，指定后该标签成为指定标签的子节点，最大深度 5 层。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['groupId', 'name'],
                properties: {
                  groupId:     { type: 'string', example: 'clx1234567890abcdef' },
                  name:        { type: 'string', maxLength: 50, example: '川菜' },
                  slug:        { type: 'string', maxLength: 100, pattern: '^[a-z0-9][a-z0-9_-]*$', example: 'sichuan' },
                  description: { type: 'string', maxLength: 200 },
                  sortOrder:   { type: 'integer', default: 0 },
                  parentId:    { type: 'string', nullable: true, description: '父标签 ID，null 或不传表示根节点', example: null },
                },
              },
              example: { groupId: 'clx1234567890abcdef', name: '川菜' },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagResponse' }),
          '400': err('字段格式错误或层级超限', 400),
          '404': err('标签分组或父标签不存在', 404),
          '409': err('name 或 slug 已存在', 409),
          '500': err('创建失败', 500),
        },
      },
    },

    '/tags/{tagId}': {
      get: {
        tags: ['标签'],
        operationId: 'getTag',
        summary: '获取标签详情',
        description: '返回标签完整信息，包含所属分组简要信息及使用数量统计。',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagResponse' }),
          '404': err('标签不存在', 404),
        },
      },
      patch: {
        tags: ['标签'],
        operationId: 'updateTag',
        summary: '更新标签',
        description: '至少传一个可更新字段。`parentId` 可设为 null（提升为根节点）或另一标签 ID（移动至该父节点），系统自动维护 path/depth 及所有子孙节点。移动时进行循环检测和深度校验。',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                minProperties: 1,
                description: '至少传一个字段',
                properties: {
                  name:        { type: 'string',           maxLength: 50 },
                  slug:        { type: 'string',           maxLength: 100, pattern: '^[a-z0-9][a-z0-9_-]*$' },
                  description: { type: ['string', 'null'], maxLength: 200 },
                  sortOrder:   { type: 'integer' },
                  parentId:    { type: ['string', 'null'], description: 'null = 提升为根节点；字符串 = 移动至该父节点' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagResponse' }),
          '400': err('未提供任何可更新字段、格式错误或循环引用', 400),
          '404': err('标签不存在或父标签不存在', 404),
          '409': err('name 或 slug 已存在', 409),
          '500': err('更新失败', 500),
        },
      },
      delete: {
        tags: ['标签'],
        operationId: 'deleteTag',
        summary: '删除标签',
        description: '软删除。子标签的 parentId 由 FK onDelete:SetNull 自动清空（子标签提升为根节点）。默认在有实体关联时返回 409；传 `?force=true` 可强制删除。',
        parameters: [
          { $ref: '#/components/parameters/TagId' },
          { name: 'force', in: 'query', description: '强制删除（忽略关联检查）', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '404': err('标签不存在', 404),
          '409': err('标签正在使用，请添加 ?force=true', 409),
          '500': err('删除失败', 500),
        },
      },
    },

    '/tags/{tagId}/descendants': {
      get: {
        tags: ['标签'],
        operationId: 'getTagDescendants',
        summary: '获取标签的所有子孙',
        description: '返回所有子孙节点（不含自身），按 path 字典序排列，可用于上卷查询（roll-up）。',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code:  { type: 'integer', example: 0 },
              data: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
                  total: { type: 'integer' },
                },
              },
            },
          }),
          '404': err('标签不存在', 404),
        },
      },
    },

    '/tags/{tagId}/ancestors': {
      get: {
        tags: ['标签'],
        operationId: 'getTagAncestors',
        summary: '获取标签的祖先链',
        description: '从根到父依序返回所有祖先（不含自身），可用于 breadcrumb 展示。',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id:    { type: 'string' },
                    slug:  { type: 'string' },
                    name:  { type: 'string' },
                    depth: { type: 'integer' },
                  },
                },
              },
            },
          }),
          '404': err('标签不存在', 404),
        },
      },
    },

    /* ── /tags/resolve ─────────────────────────────────────────── */
    '/tags/resolve': {
      get: {
        tags: ['标签'],
        operationId: 'resolveTag',
        summary: '按名称/slug/别名解析标签',
        description: '根据查询字符串 `q` 在标签的 name、slug 和别名（alias）中依次查找，返回首个匹配结果及匹配方式。\n\n**查找优先级：** name > slug > alias。可选传 `groupId` 将搜索范围限定在某个分组内。\n\n适用场景：文字标注、批量导入时将自然语言词汇映射到标准标签。',
        parameters: [
          {
            name: 'q', in: 'query', required: true,
            description: '待解析的词汇（名称、slug 或别名）',
            schema: { type: 'string', example: '四川菜' },
          },
          {
            name: 'groupId', in: 'query',
            description: '限定搜索的分组 ID（可选）',
            schema: { type: 'string', example: 'clx1234567890abcdef' },
          },
        ],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'object',
                properties: {
                  tag:       { $ref: '#/components/schemas/Tag' },
                  matchedBy: {
                    type: 'string',
                    enum: ['name', 'slug', 'alias'],
                    description: '实际匹配的字段',
                    example: 'alias',
                  },
                },
              },
            },
          }),
          '400': err('缺少 q 参数', 400),
          '404': err('未找到匹配标签', 404),
        },
      },
    },

    /* ── /tags/{tagId}/aliases ─────────────────────────────────── */
    /* ── /tags/{tagId}/merge ──────────────────────────────────── */
    '/tags/{tagId}/merge': {
      post: {
        tags: ['标签'],
        operationId: 'mergeTags',
        summary: '合并标签（同分组）',
        description: '将一个或多个源标签合并到目标标签（`targetId = :tagId`）。\n\n**事务内行为：**\n1. 把源标签的 EntityTag 迁移到目标标签（已存在则跳过）\n2. 删除源标签原有的 EntityTag 记录（EntityTagReview 级联删除）\n3. 把源标签的别名迁移到目标标签（与目标已有别名/name/slug 冲突的跳过）\n4. 软删除所有源标签\n5. 写入 TagMergeLog\n\n**约束：**\n- 所有源标签必须与目标标签在同一分组\n- 源标签不能有子节点（需先处理子节点）\n- sourceIds 不能包含 targetId 本身',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sourceIds'],
                properties: {
                  sourceIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    description: '待合并的源标签 ID 列表',
                    example: ['clx0000000000tag002', 'clx0000000000tag003'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'object',
                properties: {
                  entityTagsMoved: { type: 'integer', description: '实际迁移的实体关联数（已存在则跳过）', example: 42 },
                  aliasesMoved:    { type: 'integer', description: '迁移的别名数（冲突的跳过）', example: 3 },
                },
              },
            },
          }),
          '400': err('sourceIds 格式错误、包含 targetId 本身、或源标签与目标标签不在同一分组', 400),
          '404': err('目标标签或某个源标签不存在', 404),
          '409': err('某个源标签存在子节点，无法合并', 409),
          '500': err('合并失败', 500),
        },
      },
    },

    /* ── /tags/{tagId}/move ───────────────────────────────────── */
    '/tags/{tagId}/move': {
      post: {
        tags: ['标签'],
        operationId: 'moveTagToGroup',
        summary: '迁移标签到其他分组（含子孙）',
        description: '将标签及其所有子孙节点一次性迁移到另一个分组，成为目标分组的根节点（parentId=null）。\n\n**前置校验：**\n- 目标分组必须存在且未被软删除\n- 目标分组 entityScopes 必须兼容该标签下所有实体类型\n- 目标分组不允许多选时，若同一实体持有迁移子树中的多个标签则拒绝\n- 目标分组内不能有同名或同 slug 的活跃标签\n\n**事务内行为：**\n1. 更新标签 groupId / parentId=null / path / depth\n2. 批量更新所有子孙的 groupId / path / depth\n3. 写入 TagMoveLog',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['targetGroupId'],
                properties: {
                  targetGroupId: {
                    type: 'string',
                    description: '目标分组 ID',
                    example: 'clx1234567890abcdef',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: {
                type: 'object',
                properties: {
                  tag:       { $ref: '#/components/schemas/Tag', description: '迁移后的标签数据' },
                  tagsMoved: { type: 'integer', description: '迁移的标签总数（含子孙）', example: 5 },
                },
              },
            },
          }),
          '400': err('targetGroupId 缺失或与当前分组相同', 400),
          '404': err('标签或目标分组不存在', 404),
          '409': err('名称/slug 冲突、entityScopes 不兼容或 allowMultiple 违反约束', 409),
          '500': err('迁移失败', 500),
        },
      },
    },

    '/tags/{tagId}/aliases': {
      get: {
        tags: ['标签'],
        operationId: 'listTagAliases',
        summary: '列出标签的别名',
        description: '返回指定标签的所有别名，按创建时间升序排列。',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: { type: 'array', items: { $ref: '#/components/schemas/TagAlias' } },
            },
          }),
          '404': err('标签不存在', 404),
        },
      },
      post: {
        tags: ['标签'],
        operationId: 'createTagAlias',
        summary: '为标签添加别名',
        description: '在指定标签下新增一个别名。**同一分组内别名唯一**：同一分组内不同标签不能共享同一别名，且别名不能与分组内其他标签的 name 或 slug 相同（避免解析歧义）。',
        parameters: [{ $ref: '#/components/parameters/TagId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['alias'],
                properties: {
                  alias:  { type: 'string', maxLength: 100, description: '别名文本', example: '四川菜' },
                  source: { type: 'string', enum: ['manual', 'ai', 'import'], default: 'manual', description: '别名来源' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({
            type: 'object',
            properties: {
              code: { type: 'integer', example: 0 },
              data: { $ref: '#/components/schemas/TagAlias' },
            },
          }),
          '400': err('alias 为必填项或格式无效', 400),
          '404': err('标签不存在', 404),
          '409': err('该别名在分组内已被其他标签使用，或与其他标签的 name/slug 冲突', 409),
          '500': err('创建失败', 500),
        },
      },
    },

    /* ── /tags/{tagId}/aliases/{aliasId} ──────────────────────── */
    '/tags/{tagId}/aliases/{aliasId}': {
      delete: {
        tags: ['标签'],
        operationId: 'deleteTagAlias',
        summary: '删除标签别名',
        description: '硬删除一条别名记录。',
        parameters: [
          { $ref: '#/components/parameters/TagId' },
          { $ref: '#/components/parameters/AliasId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '404': err('别名不存在或不属于该标签', 404),
        },
      },
    },
  },
}
