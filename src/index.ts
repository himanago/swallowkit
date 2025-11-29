/**
 * SwallowKit - Next.js framework optimized for Azure deployment
 * Main exports
 */

// Type definitions
export type {
  UseServerFnOptions,
  UseServerFnResult,
  ServerFnMode,
  SwallowKitConfig,
} from "./types";

// Configuration
export { loadConfig, generateConfig, getFullConfig, validateConfig } from "./core/config";

// Database - Zod-based schema sharing between frontend, backend, and Cosmos DB
export { DatabaseClient, getDatabaseClient } from "./database/client";
export { SchemaRepository, createRepository, TodoSchema, TodoRepository } from "./database/repository";
export { BaseModel } from "./database/base-model";
export type { Todo } from "./database/repository";
