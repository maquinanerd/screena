-- admin_operational_panel: o painel operacional passa a ter memoria propria.
--
-- O PROBLEMA QUE ESTAS TABELAS FECHAM
-- ---------------------------------------------------------------------------
-- Num unico dia de operacao o dono precisou de quatro terminais e dezenas de
-- consultas escritas a mao para perguntas que deveriam ser uma tela: "o deploy
-- subiu?", "a fila rodou?", "por que nao tem nota?", "quanto do catalogo tem
-- sinopse?". Quase tudo ja estava no banco. Quatro coisas NAO estavam, e sao
-- elas que esta migration cria:
--
--   1. admin_action_audits       -- quem forcou o que, quando, e o resultado.
--   2. scheduler_force_requests  -- pedido ao screen-cron (fila, nota, score).
--   3. service_heartbeats        -- sinal de vida + IMPRESSAO DIGITAL do codigo.
--   4. deploy_main_commits       -- os commits do main, com a mesma impressao.
--   5. catalog_coverage_snapshots-- um retrato de cobertura por dia.
--
-- E um registro de fornecedor: 'github', de onde a fila deploy_reference le o
-- main (repositorio publico, sem token).
--
-- POR QUE A IMPRESSAO DIGITAL, E NAO CINERIE_BUILD_SHA
-- ---------------------------------------------------------------------------
-- CINERIE_BUILD_SHA e variavel ESTATICA do EasyPanel: definida uma vez, nunca
-- atualizada pelo deploy. Em 2026-08-31 ela dizia um commit 38 commits atras do
-- que os containers realmente rodavam. Um rotulo digitado mente nas duas
-- direcoes. O digest de service_heartbeats e calculado pelo PROPRIO processo
-- sobre os arquivos que estao no disco do container (SHA-1 de blob git de cada
-- arquivo-fonte), e deploy_main_commits guarda o MESMO digest calculado sobre a
-- arvore do commit no GitHub. Mesmo digest = mesmo codigo.
--
-- POLIMORFICAS DE HISTORICO
-- ---------------------------------------------------------------------------
-- admin_action_audits e scheduler_force_requests carregam entity_type/entity_id
-- do titulo alvo e NAO tem FK para entities, de proposito: sao HISTORICO. Um
-- titulo apagado no recorte de idioma nao pode levar junto a prova de que alguem
-- forcou a atualizacao dele, e uma FK RESTRICT faria o DELETE do titulo abortar.
-- Estao em POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED
-- (services/ingestion/src/persistence/language-cutdown.ts), com o motivo.

-- 0. Fornecedor tecnico da referencia do main. Chega por migration (o release
-- roda migrate deploy e NAO roda db:seed) e espelha API_PROVIDER_SEED.
INSERT INTO "api_providers" ("key", "name", "kind", "homepage_url")
VALUES ('github', 'GitHub (referencia do main)', 'data', 'https://github.com')
ON CONFLICT ("key") DO NOTHING;

-- 1. Auditoria das acoes do painel.
CREATE TABLE "admin_action_audits" (
    "id" BIGSERIAL NOT NULL,
    "action_kind" TEXT NOT NULL,
    "entity_type" "EntityType",
    "entity_id" BIGINT,
    "tmdb_id" INTEGER,
    "queue" TEXT,
    "actor_kind" TEXT NOT NULL,
    "actor_label" TEXT NOT NULL,
    "request_token" TEXT NOT NULL,
    "estimate" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "outcome_detail" TEXT,
    "catalog_job_id" BIGINT,
    "idempotency_key" TEXT,
    "force_request_id" BIGINT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_action_audits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_action_audits_action_kind_check" CHECK ("action_kind" IN (
        'force_title_detail', 'force_title_media', 'force_title_seasons',
        'force_title_ratings', 'force_title_score', 'force_queue')),
    CONSTRAINT "admin_action_audits_outcome_check" CHECK ("outcome" IN (
        'enqueued', 'already_enqueued', 'refused', 'failed')),
    CONSTRAINT "admin_action_audits_actor_kind_check" CHECK ("actor_kind" IN (
        'basic_auth_shared', 'open_development')),
    -- O nonce do formulario: o mesmo formulario confirmado duas vezes e UMA acao.
    CONSTRAINT "admin_action_audits_request_token_format" CHECK ("request_token" ~ '^[0-9a-f]{24}$')
);

CREATE UNIQUE INDEX "admin_action_audits_request_token_key" ON "admin_action_audits"("request_token");
CREATE INDEX "admin_action_audits_requested_at_idx" ON "admin_action_audits"("requested_at");
CREATE INDEX "admin_action_audits_entity_type_entity_id_idx" ON "admin_action_audits"("entity_type", "entity_id");

-- 2. Pedidos ao agendador. O painel ENFILEIRA; quem executa e o screen-cron.
CREATE TABLE "scheduler_force_requests" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "queue" TEXT,
    "entity_type" "EntityType",
    "entity_id" BIGINT,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "finished_at" TIMESTAMP(3),
    "outcome_detail" TEXT,

    CONSTRAINT "scheduler_force_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduler_force_requests_kind_check" CHECK ("kind" IN ('queue', 'title_ratings', 'title_score')),
    CONSTRAINT "scheduler_force_requests_status_check" CHECK ("status" IN ('pending', 'running', 'done', 'failed')),
    CONSTRAINT "scheduler_force_requests_target_check" CHECK (
        ("kind" = 'queue' AND "queue" IS NOT NULL AND "entity_type" IS NULL AND "entity_id" IS NULL)
        OR ("kind" <> 'queue' AND "queue" IS NULL AND "entity_type" IN ('movie', 'tv') AND "entity_id" IS NOT NULL)
    )
);

-- No maximo UM pedido aberto por alvo. Dois cliques na mesma fila nao viram
-- dois ciclos: o segundo encontra o primeiro.
--
-- DOIS indices parciais, e nao um unico com COALESCE. Dentro do dominio de cada
-- um, as colunas indexadas sao NOT NULL pelo CHECK de alvo acima (NULL nunca
-- escapa da unicidade), e nenhum precisa converter o enum de tipo de entidade
-- para texto. Essa conversao NAO e IMMUTABLE (o rotulo de um enum pode ser
-- renomeado) e o PostgreSQL recusa o indice inteiro com 42P17 — foi o que o
-- migrate deploy do validador do painel mediu em 2026-09-15.
CREATE UNIQUE INDEX "scheduler_force_requests_open_queue_key"
    ON "scheduler_force_requests"("queue")
    WHERE "kind" = 'queue' AND "status" IN ('pending', 'running');
CREATE UNIQUE INDEX "scheduler_force_requests_open_title_key"
    ON "scheduler_force_requests"("kind", "entity_type", "entity_id")
    WHERE "kind" <> 'queue' AND "status" IN ('pending', 'running');
CREATE INDEX "scheduler_force_requests_status_requested_at_idx" ON "scheduler_force_requests"("status", "requested_at");

-- 3. Sinal de vida e impressao digital do codigo de cada processo.
CREATE TABLE "service_heartbeats" (
    "service_key" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "digest_method" TEXT NOT NULL,
    "source_digest" TEXT,
    "source_file_count" INTEGER,
    "source_bucket_digests" JSONB,
    "digest_error" TEXT,
    "build_id" TEXT,
    "node_version" TEXT NOT NULL,
    "rss_bytes" BIGINT,
    "heap_used_bytes" BIGINT,
    "cpu_percent" DOUBLE PRECISION,
    "credentials" JSONB,

    CONSTRAINT "service_heartbeats_pkey" PRIMARY KEY ("service_key", "instance_id"),
    CONSTRAINT "service_heartbeats_service_key_format" CHECK ("service_key" ~ '^[a-z0-9-]+$'),
    CONSTRAINT "service_heartbeats_digest_format" CHECK ("source_digest" IS NULL OR "source_digest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "service_heartbeats_service_key_last_seen_at_idx" ON "service_heartbeats"("service_key", "last_seen_at");

-- 4. Os commits do main, com a impressao digital da arvore de cada um.
CREATE TABLE "deploy_main_commits" (
    "commit_sha" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "main_position" INTEGER,
    "digest_method" TEXT NOT NULL,
    "source_digest" TEXT,
    "source_file_count" INTEGER,
    "source_bucket_digests" JSONB,
    "tree_truncated" BOOLEAN NOT NULL DEFAULT false,
    "behind_head_by" INTEGER,
    "behind_head_sha" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "positions_read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deploy_main_commits_pkey" PRIMARY KEY ("commit_sha"),
    CONSTRAINT "deploy_main_commits_sha_format" CHECK ("commit_sha" ~ '^[0-9a-f]{40}$'),
    CONSTRAINT "deploy_main_commits_digest_format" CHECK ("source_digest" IS NULL OR "source_digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "deploy_main_commits_position_check" CHECK ("main_position" IS NULL OR "main_position" >= 0),
    CONSTRAINT "deploy_main_commits_behind_check" CHECK ("behind_head_by" IS NULL OR "behind_head_by" >= 0)
);

CREATE INDEX "deploy_main_commits_main_position_idx" ON "deploy_main_commits"("main_position");
CREATE INDEX "deploy_main_commits_source_digest_idx" ON "deploy_main_commits"("source_digest");

-- 5. Um retrato de cobertura do catalogo por dia (e por idioma original).
CREATE TABLE "catalog_coverage_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "captured_on" DATE NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "method_version" TEXT NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "original_language" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "with_title" INTEGER,
    "with_synopsis" INTEGER,
    "with_poster" INTEGER,
    "with_trailer" INTEGER,
    "with_displayable_rating" INTEGER,
    "indexable" INTEGER,

    CONSTRAINT "catalog_coverage_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_coverage_snapshots_kind_check" CHECK ("entity_kind" IN ('movie', 'tv', 'season', 'episode', 'person')),
    CONSTRAINT "catalog_coverage_snapshots_counts_check" CHECK (
        "total" >= 0
        AND ("with_title" IS NULL OR "with_title" BETWEEN 0 AND "total")
        AND ("with_synopsis" IS NULL OR "with_synopsis" BETWEEN 0 AND "total")
        AND ("with_poster" IS NULL OR "with_poster" BETWEEN 0 AND "total")
        AND ("with_trailer" IS NULL OR "with_trailer" BETWEEN 0 AND "total")
        AND ("with_displayable_rating" IS NULL OR "with_displayable_rating" BETWEEN 0 AND "total")
        AND ("indexable" IS NULL OR "indexable" BETWEEN 0 AND "total")
    )
);

-- UM retrato por (dia, tipo, idioma). O segundo ciclo do mesmo dia e noop.
CREATE UNIQUE INDEX "catalog_coverage_snapshots_day_kind_language_key"
    ON "catalog_coverage_snapshots"("captured_on", "entity_kind", "original_language");
CREATE INDEX "catalog_coverage_snapshots_captured_at_idx" ON "catalog_coverage_snapshots"("captured_at");

-- 6. O trabalho de cada fila e de cada pedido do painel, por run_id.
-- O painel conta catalog_jobs por run_id ('scheduler:<fila>' e 'admin:<nonce>',
-- que o job filho herda) numa janela de created_at. Sem este indice cada leitura
-- varreria a fila inteira. CREATE INDEX sem CONCURRENTLY porque o Prisma roda a
-- migration dentro de transacao (o mesmo motivo registrado em
-- 20260808120000_entity_resolve_folded_title_indexes): enquanto o indice e
-- construido, escritas em catalog_jobs esperam. Nao apaga nem altera linha.
CREATE INDEX "catalog_jobs_run_id_created_at_idx" ON "catalog_jobs"("run_id", "created_at");
