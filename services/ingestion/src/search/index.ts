/**
 * search — Busca PostgreSQL do catalogo (Backend A).
 *
 * Barrel dos modulos PUROS: dobra de texto (fold), projecao para
 * search_documents e construtor da consulta ranqueada parametrizada. O adapter
 * Prisma (upsert + execucao da consulta) vive em
 * services/ingestion/src/persistence/search-store.ts (excluido do typecheck).
 */

export * from './fold.js'
export * from './projection.js'
export * from './query.js'
export * from './store-port.js'
