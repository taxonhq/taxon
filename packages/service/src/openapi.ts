const ok  = (schema: object) => ({ description: '成功', content: { 'application/json': { schema } } })
const err = (desc: string, code = 400) => ({
  description: desc,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' }, example: { code, message: desc } } },
})

const components = {
  schemas: {
    ApiError: {
      type: 'object',
      properties: {
        code:    { type: 'integer', description: '错误状态码，非 0', example: 404 },
        message: { type: 'string',  description: '错误描述' },
      },
    },
    OkMessage: {
      type: 'object',
      properties: {
        code:    { type: 'integer', example: 0 },
        message: { type: 'string',  example: '操作成功' },
      },
    },
    RegisteredEntity: {
      type: 'object',
      properties: {
        entityType:   { type: 'string',  description: '实体类型，如 dish / dining', example: 'dish' },
        entityId:     { type: 'string',  description: '业务服务中的实体主键 ID',    example: 'clx1234567890abcdef' },
        registeredAt: { type: 'string',  description: '注册时间 ISO 8601',          example: '2026-05-10T00:00:00.000Z' },
      },
    },
    EntityIdList: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: {
          type: 'object',
          properties: {
            entityIds: { type: 'array', items: { type: 'string' }, description: '匹配条件的实体 ID 列表', example: ['clx1234567890abcdef'] },
          },
        },
      },
    },
    TagGroup: {
      type: 'object',
      properties: {
        id:            { type: 'string',  example: 'clx1234567890abcdef' },
        slug:          { type: 'string',  example: 'cuisine' },
        name:          { type: 'string',  example: '菜系' },
        description:   { type: 'string',  example: '菜品所属烹饪流派' },
        entityScopes:  { type: 'array', items: { type: 'string' }, description: '适用实体类型，空数组=通用', example: ['dish'] },
        allowMultiple: { type: 'boolean', example: false },
        sortOrder:     { type: 'integer', example: 0 },
        createdAt:     { type: 'string',  example: '2026-05-10T00:00:00.000Z' },
        updatedAt:     { type: 'string',  example: '2026-05-10T00:00:00.000Z' },
      },
    },
    Tag: {
      type: 'object',
      properties: {
        id:          { type: 'string',  example: 'clx0000000000tag001' },
        groupId:     { type: 'string',  example: 'clx1234567890abcdef' },
        slug:        { type: 'string',  example: 'sichuan' },
        name:        { type: 'string',  example: '川菜' },
        description: { type: 'string',  example: '四川风味' },
        sortOrder:   { type: 'integer', example: 0 },
        createdAt:   { type: 'string',  example: '2026-05-10T00:00:00.000Z' },
        updatedAt:   { type: 'string',  example: '2026-05-10T00:00:00.000Z' },
      },
    },
    TagWithCount: {
      allOf: [
        { $ref: '#/components/schemas/Tag' },
        { type: 'object', properties: { _count: { type: 'object', properties: { entityTags: { type: 'integer', example: 5 } } } } },
      ],
    },
    TagGroupResponse:     { type: 'object', properties: { code: { type: 'integer', example: 0 }, data: { $ref: '#/components/schemas/TagGroup' } } },
    TagGroupListResponse: { type: 'object', properties: { code: { type: 'integer', example: 0 }, data: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/TagGroup' } }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } } } },
    TagResponse:          { type: 'object', properties: { code: { type: 'integer', example: 0 }, data: { $ref: '#/components/schemas/Tag' } } },
    TagListResponse:      { type: 'object', properties: { code: { type: 'integer', example: 0 }, data: { type: 'array', items: { $ref: '#/components/schemas/Tag' } } } },
    TagListPaginatedResponse: {
      type: 'object',
      properties: {
        code: { type: 'integer', example: 0 },
        data: { type: 'object', properties: {
          items:    { type: 'array', items: { $ref: '#/components/schemas/TagWithCount' } },
          total:    { type: 'integer', example: 13 },
          page:     { type: 'integer', example: 1 },
          pageSize: { type: 'integer', example: 20 },
        }},
      },
    },
  },
  parameters: {
    EntityType: { name: 'entityType', in: 'path', required: true, schema: { type: 'string', example: 'dish' } },
    EntityId:   { name: 'entityId',   in: 'path', required: true, schema: { type: 'string', example: 'clx1234567890abcdef' } },
    TagId:      { name: 'tagId',      in: 'path', required: true, schema: { type: 'string', example: 'clx0000000000tag001' } },
    GroupId:    { name: 'groupId',    in: 'path', required: true, schema: { type: 'string', example: 'clx1234567890abcdef' } },
  },
}

export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Taxon',
    version: '1.0.0',
    description: '独立标签服务，端口 3300。\n\n提供实体注册、标签分组/标签管理、实体打标等能力，可被任意业务服务通过 HTTP 调用。\n\n**实体生命周期：** 业务服务在创建实体时调用 `POST /entities/:type/:id` 注册，删除实体时调用 `DELETE /entities/:type/:id` 注销，注销时所有标签关联由数据库 CASCADE 自动清理。',
  },
  servers: [{ url: 'http://localhost:3300', description: '本地开发环境' }],
  tags: [
    { name: '实体',     description: '实体注册/注销及按类型查询' },
    { name: '实体标签', description: '为已注册实体打标/摘标' },
    { name: '标签分组', description: '标签维度管理（菜系/口味/工艺等）' },
    { name: '标签',     description: '分组内的具体标签值' },
    { name: '实体类型', description: '统计已注册的实体类型分布' },
  ],
  components,
  paths: {

    /* ── /entity-types ──────────────────────────────────────── */
    '/entity-types': {
      get: {
        tags: ['实体类型'],
        operationId: 'listEntityTypes',
        summary: '获取已注册实体类型分布',
        description: '返回所有已在 tag-service 注册过实体的类型及数量统计，可作为 `entityScopes` 的合法值参考。',
        responses: {
          '200': ok({ type: 'object', properties: { code: { type: 'integer', example: 0 }, data: { type: 'array', items: { type: 'object', properties: { entityType: { type: 'string', example: 'dish' }, count: { type: 'integer', example: 42 } } } } } }),
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
          '200': ok({ type: 'object', properties: { code: { type: 'integer', example: 0 }, data: { $ref: '#/components/schemas/RegisteredEntity' } } }),
          '404': err('实体未注册', 404),
        },
      },
    },

    /* ── /entities/{entityType} ─────────────────────────────── */
    '/entities/{entityType}': {
      get: {
        tags: ['实体'],
        operationId: 'listEntities',
        summary: '按实体类型查询实体 ID 列表',
        description: '返回满足条件的 entityId 列表。\n\n- `tagId` 可重复传入多个，返回**包含所有指定标签**的实体（AND 语义）\n- `q` 按标签名模糊匹配，找出名称含 `q` 的标签，再返回拥有这些标签的实体（OR 语义）\n- 两个参数可组合使用\n- 不传任何参数时返回该类型下全部已注册实体 ID',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { name: 'tagId', in: 'query', description: '标签 ID，可重复传入多个（AND 语义）', schema: { type: 'string', example: 'clx0000000000tag001' } },
          { name: 'q',     in: 'query', description: '标签名模糊搜索关键词', schema: { type: 'string', example: '川菜' } },
        ],
        responses: { '200': ok({ $ref: '#/components/schemas/EntityIdList' }) },
      },
    },

    /* ── /entities/{entityType}/{entityId}/tags ─────────────── */
    '/entities/{entityType}/{entityId}/tags': {
      get: {
        tags: ['实体标签'],
        operationId: 'getEntityTags',
        summary: '查询实体的标签',
        description: '返回实体当前的所有标签，每条记录含所属分组信息，按打标时间升序排列。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagListResponse' }),
          '404': err('实体未注册', 404),
        },
      },
      put: {
        tags: ['实体标签'],
        operationId: 'setEntityTags',
        summary: '全量替换实体标签',
        description: '在同一事务内删除现有标签并写入新标签。传空数组则清空所有标签。违反 `entityScopes` 或 `allowMultiple` 约束时返回 422。',
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
                  tagIds: { type: 'array', items: { type: 'string' }, example: ['clx0000000000tag001', 'clx0000000000tag002'] },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '400': err('请求体格式错误', 400),
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
        description: '为实体追加单个标签。违反约束时返回 422。',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          { $ref: '#/components/parameters/TagId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
          '404': err('实体未注册或标签不存在', 404),
          '409': err('标签已存在', 409),
          '422': err('entityScopes 不匹配或分组不允许多选', 422),
        },
      },
      delete: {
        tags: ['实体标签'],
        operationId: 'removeEntityTag',
        summary: '摘标',
        parameters: [
          { $ref: '#/components/parameters/EntityType' },
          { $ref: '#/components/parameters/EntityId' },
          { $ref: '#/components/parameters/TagId' },
        ],
        responses: {
          '200': ok({ $ref: '#/components/schemas/OkMessage' }),
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
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['slug', 'name'], properties: {
            slug:          { type: 'string', example: 'cuisine' },
            name:          { type: 'string', example: '菜系' },
            description:   { type: 'string', maxLength: 200, example: '菜品所属烹饪流派' },
            entityScopes:  { type: 'array', items: { type: 'string' }, description: '适用实体类型，空数组=通用', example: ['dish'] },
            allowMultiple: { type: 'boolean', default: true, example: false },
            sortOrder:     { type: 'integer', default: 0, example: 0 },
          }}}},
        },
        responses: {
          '200': ok({ $ref: '#/components/schemas/TagGroupResponse' }),
          '400': err('必填字段缺失或格式错误', 400),
          '409': err('slug 或 name 已存在', 409),
        },
      },
      get: {
        tags: ['标签分组'],
        operationId: 'listTagGroups',
        summary: '获取标签分组列表',
        parameters: [
          { name: 'scope',    in: 'query', schema: { type: 'string', example: 'dish' }, description: '按实体类型过滤，可重复' },
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { '200': ok({ $ref: '#/components/schemas/TagGroupListResponse' }) },
      },
    },

    '/tag-groups/{groupId}': {
      get:    { tags: ['标签分组'], operationId: 'getTagGroup',    summary: '获取分组详情', parameters: [{ $ref: '#/components/parameters/GroupId' }], responses: { '200': ok({ $ref: '#/components/schemas/TagGroupResponse' }), '404': err('标签分组不存在', 404) } },
      patch:  { tags: ['标签分组'], operationId: 'updateTagGroup', summary: '更新标签分组', parameters: [{ $ref: '#/components/parameters/GroupId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, entityScopes: { type: 'array', items: { type: 'string' } }, allowMultiple: { type: 'boolean' }, sortOrder: { type: 'integer' } } } } } }, responses: { '200': ok({ $ref: '#/components/schemas/TagGroupResponse' }), '404': err('标签分组不存在', 404), '409': err('name 已存在', 409) } },
      delete: { tags: ['标签分组'], operationId: 'deleteTagGroup', summary: '删除标签分组', description: 'onDelete: Cascade 自动清除分组下所有标签及关联，无需应用层手动处理。', parameters: [{ $ref: '#/components/parameters/GroupId' }, { name: 'force', in: 'query', schema: { type: 'boolean', default: false } }], responses: { '200': ok({ $ref: '#/components/schemas/OkMessage' }), '404': err('标签分组不存在', 404), '409': err('有实体关联，请添加 ?force=true', 409) } },
    },

    '/tag-groups/{groupId}/tags': {
      get: {
        tags: ['标签分组'],
        operationId: 'listGroupTags',
        summary: '获取分组内标签列表',
        parameters: [{ $ref: '#/components/parameters/GroupId' }, { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: { '200': ok({ $ref: '#/components/schemas/TagListPaginatedResponse' }), '404': err('标签分组不存在', 404) },
      },
    },

    /* ── /tags ──────────────────────────────────────────────── */
    '/tags': {
      post: {
        tags: ['标签'],
        operationId: 'createTag',
        summary: '创建标签',
        description: '`slug` 可选，未传时从 name 自动生成拼音。',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['groupId', 'name'], properties: { groupId: { type: 'string', example: 'clx1234567890abcdef' }, name: { type: 'string', example: '川菜' }, slug: { type: 'string', example: 'sichuan' }, description: { type: 'string' }, sortOrder: { type: 'integer', default: 0 } } }, example: { groupId: 'clx1234567890abcdef', name: '川菜' } } } },
        responses: { '200': ok({ $ref: '#/components/schemas/TagResponse' }), '400': err('字段格式错误', 400), '404': err('标签分组不存在', 404), '409': err('name 或 slug 已存在', 409) },
      },
    },
    '/tags/{tagId}': {
      patch:  { tags: ['标签'], operationId: 'updateTag', summary: '更新标签', parameters: [{ $ref: '#/components/parameters/TagId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: ['string', 'null'] }, sortOrder: { type: 'integer' } } } } } }, responses: { '200': ok({ $ref: '#/components/schemas/TagResponse' }), '404': err('标签不存在', 404), '409': err('name 已存在', 409) } },
      delete: { tags: ['标签'], operationId: 'deleteTag', summary: '删除标签', description: 'onDelete: Cascade 自动清除关联，无需应用层手动处理。', parameters: [{ $ref: '#/components/parameters/TagId' }, { name: 'force', in: 'query', schema: { type: 'boolean', default: false } }], responses: { '200': ok({ $ref: '#/components/schemas/OkMessage' }), '404': err('标签不存在', 404), '409': err('标签正在使用，请添加 ?force=true', 409) } },
    },
  },
}
