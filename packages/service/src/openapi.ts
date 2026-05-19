const ok  = (schema: object) => ({ description: '成功', content: { 'application/json': { schema } } })
const err = (desc: string, code = 400) => ({
  description: desc,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' }, example: { code, message: desc } } },
})

const components = {
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
        slug:        { type: 'string',  description: '唯一标识符，格式 /^[a-z0-9][a-z0-9_-]*$/', example: 'sichuan' },
        name:        { type: 'string',  description: '标签显示名称', example: '川菜' },
        description: { type: 'string',  description: '标签描述', example: '四川风味' },
        sortOrder:   { type: 'integer', description: '排序权重', example: 0 },
        createdAt:   { type: 'string',  format: 'date-time', example: '2026-05-10T00:00:00.000Z' },
        updatedAt:   { type: 'string',  format: 'date-time', example: '2026-05-10T00:00:00.000Z' },
      },
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
      },
    },
    AuditItem: {
      type: 'object',
      description: '审核队列中的标签关联记录',
      properties: {
        tagId:      { type: 'string',  description: '标签 ID', example: 'clx0000000000tag001' },
        entityType: { type: 'string',  description: '实体类型', example: 'dish' },
        entityId:   { type: 'string',  description: '实体 ID', example: 'clx1234567890abcdef' },
        source:     { type: 'string',  enum: ['manual', 'ai', 'system', 'import'], description: '打标来源', example: 'ai' },
        confidence: { type: 'number',  nullable: true, minimum: 0, maximum: 1, description: 'AI 置信度', example: 0.92 },
        status:     { type: 'string',  enum: ['active', 'pending', 'rejected'], description: '当前审核状态', example: 'pending' },
        taggedAt:   { type: 'string',  format: 'date-time', description: '打标时间', example: '2026-05-10T00:00:00.000Z' },
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
    EntityIdList: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            entityIds: {
              type: 'array',
              items: { type: 'string' },
              description: '满足过滤条件的实体 ID 列表',
              example: ['clx1234567890abcdef'],
            },
          },
        },
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
  },
}

export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Taxon',
    version: '1.0.0',
    description: '独立标签服务，端口 3300。\n\n提供实体注册、标签分组/标签管理、实体打标等能力，可被任意业务服务通过 HTTP 调用。\n\n**实体生命周期：** 业务服务在创建实体时调用 `POST /entities/:type/:id` 注册，删除实体时调用 `DELETE /entities/:type/:id` 注销，注销时所有标签关联由数据库 CASCADE 自动清理。\n\n**AI 打标工作流：** 通过 `source: "ai"` 打标的记录默认为 `pending` 状态，需通过 `PATCH /entities/:type/:id/tags/:tagId` 人工审核通过（`active`）或拒绝（`rejected`）。',
  },
  servers: [{ url: 'http://localhost:3300', description: '本地开发环境' }],
  tags: [
    { name: '系统',     description: '服务健康检查' },
    { name: '实体',     description: '实体注册、注销及查询' },
    { name: '实体标签', description: '为已注册实体打标、摘标、审核' },
    { name: '标签分组', description: '标签维度管理（菜系/口味/工艺等）' },
    { name: '标签',     description: '分组内的具体标签值' },
    { name: '实体类型', description: '统计已注册的实体类型分布' },
  ],
  components,
  paths: {

    /* ── /health ────────────────────────────────────────────── */
    '/health': {
      get: {
        tags: ['系统'],
        operationId: 'healthCheck',
        summary: '服务健康检查',
        description: '检查服务本身及数据库连接是否正常，可用于负载均衡或 K8s readiness probe。',
        security: [],
        responses: {
          '200': {
            description: '服务正常',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:    { type: 'string', enum: ['ok'],        example: 'ok' },
                    db:        { type: 'string', enum: ['ok'],        example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time', example: '2026-05-18T00:00:00.000Z' },
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
                    status:    { type: 'string', enum: ['degraded'], example: 'degraded' },
                    db:        { type: 'string', enum: ['error'],    example: 'error' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
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
        description: '返回待审核（或指定状态）的标签关联列表，支持按实体类型过滤，按打标时间降序排列。\n\n主要用于人工审核 AI 自动打标结果，配合 `PATCH /entities/:type/:id/tags/:tagId` 完成审批。',
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
        description: '该接口有两种工作模式，根据传入参数自动切换：\n\n**标签过滤模式**（传入 `tagId` 或 `q`）：返回满足条件的 entityId 列表（`{ entityIds: [] }`）。\n- `tagId` 可重复传入多个，返回**包含所有指定标签**的实体（AND 语义）\n- `q` 按标签名模糊匹配，找出含关键词的标签，再返回拥有这些标签的实体（OR 语义）\n- 两个参数可组合使用\n\n**分页列表模式**（不传 `tagId` 和 `q`）：返回该类型下已注册实体的分页列表（`{ items, total, page, pageSize }`），支持 `search` 关键词过滤实体 ID。',
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
                    { $ref: '#/components/schemas/EntityIdList',    description: '标签过滤模式返回' },
                    { $ref: '#/components/schemas/EntityListResponse', description: '分页列表模式返回' },
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
        description: '更新标签关联的审核状态，用于 AI 打标的人工审核流程。\n\n- 设为 `active` = 审核通过\n- 设为 `rejected` = 审核拒绝\n- 设为 `pending` = 重置为待审核',
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
                  slug:          { type: 'string', maxLength: 100, pattern: '^[a-z0-9][a-z0-9_-]*$', example: 'cuisine' },
                  name:          { type: 'string', maxLength: 100, example: '菜系' },
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
        description: '`slug` 为只读字段，创建后不可修改。\n\n将 `allowMultiple` 从 `true` 改为 `false` 时，若已有实体在该分组下打了多个标签，接口返回 409。',
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
                  name:          { type: 'string', maxLength: 100 },
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
        description: '`slug` 可选，未传时从 `name` 自动生成拼音。`slug` 格式须符合 `/^[a-z0-9][a-z0-9_-]*$/`（最长 100 字符）。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['groupId', 'name'],
                properties: {
                  groupId:     { type: 'string', example: 'clx1234567890abcdef' },
                  name:        { type: 'string', maxLength: 100, example: '川菜' },
                  slug:        { type: 'string', maxLength: 100, pattern: '^[a-z0-9][a-z0-9_-]*$', example: 'sichuan' },
                  description: { type: 'string', maxLength: 200 },
                  sortOrder:   { type: 'integer', default: 0 },
                },
              },
              example: { groupId: 'clx1234567890abcdef', name: '川菜' },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagResponse' }),
          '400': err('字段格式错误', 400),
          '404': err('标签分组不存在', 404),
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
        description: '至少传一个可更新字段，否则返回 400。`slug` 更新须符合格式约束。',
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
                  name:        { type: 'string',           maxLength: 100 },
                  slug:        { type: 'string',           maxLength: 100, pattern: '^[a-z0-9][a-z0-9_-]*$' },
                  description: { type: ['string', 'null'], maxLength: 200 },
                  sortOrder:   { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagResponse' }),
          '400': err('未提供任何可更新字段或格式错误', 400),
          '404': err('标签不存在', 404),
          '409': err('name 或 slug 已存在', 409),
          '500': err('更新失败', 500),
        },
      },
      delete: {
        tags: ['标签'],
        operationId: 'deleteTag',
        summary: '删除标签',
        description: '软删除，slug/name 追加 `__deleted__` 后缀以释放唯一约束。onDelete: Cascade 自动清除关联，无需应用层手动处理。\n\n默认在有实体关联时返回 409；传 `?force=true` 可强制删除。',
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
  },
}
