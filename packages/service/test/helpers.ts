/**
 * Test helpers — Prisma client + factory functions for fixtures.
 *
 * IMPORTANT: this file MUST be imported AFTER global-setup has run,
 * because `new PrismaClient()` reads DATABASE_URL at construction time
 * and global-setup mutates it.
 */

import { PrismaClient, TagSource, TagStatus } from '@prisma/client'

export const prisma = new PrismaClient()

// ── Factories ─────────────────────────────────────────────────────

let counter = 0
function uniq(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter}`
}

export async function makeGroup(overrides: {
  slug?: string
  name?: string
  allowMultiple?: boolean
  entityScopes?: string[]
} = {}) {
  return prisma.tagGroup.create({
    data: {
      slug:          overrides.slug ?? uniq('group-slug'),
      name:          overrides.name ?? uniq('group-name'),
      allowMultiple: overrides.allowMultiple ?? true,
      entityScopes:  overrides.entityScopes ?? [],
    },
  })
}

export async function makeTag(overrides: {
  groupId: string
  slug?: string
  name?: string
}) {
  return prisma.tag.create({
    data: {
      groupId: overrides.groupId,
      slug:    overrides.slug ?? uniq('tag-slug'),
      name:    overrides.name ?? uniq('tag-name'),
    },
  })
}

export async function makeEntity(entityType = 'dish', entityId?: string) {
  return prisma.registeredEntity.create({
    data: { entityType, entityId: entityId ?? uniq('entity') },
  })
}

export async function attachTag(args: {
  tagId: string
  entityType: string
  entityId: string
  source?: TagSource
  status?: TagStatus
  confidence?: number
}) {
  // 先确保实体存在
  await prisma.registeredEntity.upsert({
    where:  { entityType_entityId: { entityType: args.entityType, entityId: args.entityId } },
    create: { entityType: args.entityType, entityId: args.entityId },
    update: {},
  })
  return prisma.entityTag.create({
    data: {
      tagId:      args.tagId,
      entityType: args.entityType,
      entityId:   args.entityId,
      source:     args.source     ?? TagSource.manual,
      status:     args.status     ?? TagStatus.active,
      confidence: args.confidence,
    },
  })
}
