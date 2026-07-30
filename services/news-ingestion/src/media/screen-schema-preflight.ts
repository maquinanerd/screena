/**
 * screen-schema-preflight.ts — O banco publico esta na versao que a projecao
 * exige? PURO no nucleo, com um coletor fino de IO.
 *
 * POR QUE ISTO EXISTE. As migrations do `screen-db` pertencem ao processo
 * governado do banco publico — o worker NUNCA as executa. Mas se ele consumir
 * eventos contra um schema atrasado, a escrita falha, a tentativa e gasta e uma
 * materia perfeitamente valida vai para dead-letter. A culpa seria do deploy
 * fora de ordem, e o sintoma apareceria como "erro de projecao".
 *
 * Entao: schema atrasado NAO e erro de evento, e sim readiness negativa. O
 * worker se recusa a atender e ninguem perde materia.
 */

/** Tabelas que a projecao editorial exige no banco publico. */
export const REQUIRED_TABLES = [
  'articles',
  'article_translations',
  'editorial_projection_receipts',
  'editorial_media_assets',
] as const

/** Colunas exigidas, por tabela. Adicionadas nas FASES 2C e 2D. */
export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  articles: ['payload_document_id', 'projected_sequence', 'hero_media_asset_id', 'hero_image_path'],
  article_translations: ['body_blocks', 'body_blocks_version'],
  editorial_projection_receipts: ['event_id', 'emission_sequence', 'outcome', 'worker_id'],
  editorial_media_assets: ['payload_media_id', 'content_hash', 'storage_key', 'public_path'],
}

export interface SchemaSnapshot {
  /** Tabelas encontradas no schema `public`. */
  readonly tables: readonly string[]
  /** Colunas por tabela, como o banco reportou. */
  readonly columns: Readonly<Record<string, readonly string[]>>
}

/**
 * O que falta no banco publico.
 *
 * Devolve nomes QUALIFICADOS (`tabela.coluna`) para que a mensagem de readiness
 * diga exatamente qual migration falta aplicar, em vez de "schema atrasado".
 */
export function findMissingSchemaObjects(snapshot: SchemaSnapshot): string[] {
  const missing: string[] = []
  const present = new Set(snapshot.tables)

  for (const table of REQUIRED_TABLES) {
    if (!present.has(table)) {
      missing.push(table)
      continue
    }
    const columns = new Set(snapshot.columns[table] ?? [])
    for (const column of REQUIRED_COLUMNS[table] ?? []) {
      if (!columns.has(column)) missing.push(`${table}.${column}`)
    }
  }
  return missing
}

/** Cliente minimo de leitura. Permite testar o preflight sem Prisma. */
export interface SchemaReader {
  queryTables(): Promise<{ table_name: string }[]>
  queryColumns(): Promise<{ table_name: string; column_name: string }[]>
}

/**
 * Lê o schema publico e devolve o que falta.
 *
 * SOMENTE LEITURA — consulta `information_schema` e nada mais. Um preflight que
 * escrevesse para "testar" mudaria o banco que ele deveria apenas inspecionar.
 */
export async function inspectScreenSchema(reader: SchemaReader): Promise<string[]> {
  const [tables, columns] = await Promise.all([reader.queryTables(), reader.queryColumns()])

  const byTable: Record<string, string[]> = {}
  for (const row of columns) {
    const list = byTable[row.table_name] ?? []
    list.push(row.column_name)
    byTable[row.table_name] = list
  }

  return findMissingSchemaObjects({
    tables: tables.map((row) => row.table_name),
    columns: byTable,
  })
}
