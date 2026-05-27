-- Migration: add metadata JSON column to RegisteredEntity
-- Purpose: store optional business context (name, description, imageUrl, etc.)
--          used as default input for POST /entities/:type/:id/suggest

ALTER TABLE "RegisteredEntity" ADD COLUMN "metadata" JSONB;
