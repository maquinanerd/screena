# services/entity-writer

**Entity Writer** — o motor editorial derivado do **MN26** que gera `content_blocks` a
partir de um **payload controlado do PostgreSQL**. E o unico componente autorizado a
produzir texto editorial assistido por IA (Gemini) na Screena, e o faz **sempre offline**.

## O que faz
- Consome jobs de `entity_writer_jobs` (status: `queued`, `claimed`, `running`,
  `completed`, `failed`, `blocked`, `cancelled`).
- Monta um **payload controlado** a partir das tabelas canonicas (entidade, elenco,
  ratings atribuidos, disponibilidade, noticias relacionadas) — **nunca** a partir de
  chamadas externas.
- Chama Gemini **offline** para gerar blocos dos tipos suportados: `editorial_intro`,
  `summary_without_spoilers`, `ratings_explanation`, `where_to_watch_text`, `cast_intro`,
  `similar_titles_intro`, `franchise_context`, `season_guide`, `episode_context`, `faq`,
  `news_context`, `review_summary`.
- Persiste o resultado em `content_blocks` com versionamento e auditoria completos.
- Registra cada passo em `entity_writer_logs`.

## Como roda
- **Worker Python 3.12, sempre offline.** Agendado por **systemd timers**.
- **NUNCA e chamado no render publico.** A pagina le `content_blocks` ja salvos e
  validados; **zero Gemini no render**.

## Resiliencia obrigatoria
- **Cache**, **retry** com **backoff**, **rate-limit** (do provedor de IA),
  **circuit-breaker** e **logs** em `entity_writer_logs`.

## Invariantes aplicaveis (criticas)
- **So escreve com base em payload controlado do PostgreSQL** — nao inventa fatos, nao
  cria entidades, nao chama APIs externas e **nao publica sozinho**.
- **Zero Gemini no render** — a IA so gera blocos offline, salvos e validados antes de
  qualquer indexacao.
- **content_blocks sao versionados e revisaveis** — `prompt_version`, `input_hash`,
  `output_hash`, `model_provider`, `model_name` e `review_status` sao **obrigatorios**.
- **Nao copia sinopse externa** — o bloco passa por validacao anti-alucinacao; em caso de
  divergencia com o payload, registra `warnings_json` e vai para `needs_review`/`blocked`.
- Bloco gerado por IA **so conta como valor** (gate anti-thin >= 2) se: veio de payload
  controlado, passou validacao, esta salvo em `content_blocks`, tem `prompt_version` e
  `input_hash`, e tem `review_status` permitido.
- **pt-BR primeiro** — saidas en/es nascem em `draft`/`noindex` ate revisao humana.
- Status de bloco: `draft`, `ai_generated`, `needs_review`, `human_reviewed`,
  `published`, `needs_update`, `blocked`, `archived` — publicacao exige revisao humana.

## Validacao com PostgreSQL real (dev, descartavel)

```
pnpm --filter @screena/entity-writer validate:real
```

Ferramenta de desenvolvimento **descartavel** (`scripts/validate-real-postgres.ts`) —
nunca roda no render/produto. Sobe um PostgreSQL 16 **efemero** via `embedded-postgres`
(mesmo padrao de `@screena/db`), aplica a migration e o seed existentes (sem criar
migration nem alterar schema) e exercita os **adapters Prisma reais** de
`src/persistence/*` ponta a ponta:

`enqueue -> job queued -> claim -> payload source -> runner com FakeGeminiPort ->
content_block (ai/ai_generated) -> entity_writer_log -> job completed com result_block_id`.

Tambem cobre **deduplicacao** (skip por job ativo e por up-to-date) e **arquivamento**
(regeneracao com `--force` arquiva o bloco `ai` antigo, cria o novo e preserva blocos
`human`/`hybrid`). **Zero rede e zero Gemini real**; o banco efemero e derrubado e o
diretorio temporario removido ao final. `DATABASE_URL` so existe em memoria — nunca em
disco/.env.
