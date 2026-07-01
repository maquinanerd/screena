-- CreateTable
CREATE TABLE "articles" (
    "id" BIGSERIAL NOT NULL,
    "category" TEXT,
    "author_name" TEXT,
    "hero_image_path" TEXT,
    "published_at" TIMESTAMP(3),
    "read_time_minutes" INTEGER,
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "source_name" TEXT,
    "source_url" TEXT,
    "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
    "display_allowed" BOOLEAN NOT NULL DEFAULT false,
    "requires_attribution" BOOLEAN NOT NULL DEFAULT false,
    "requires_linkback" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_translations" (
    "id" BIGSERIAL NOT NULL,
    "article_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deck" TEXT,
    "body" TEXT,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "index_status" "IndexDecision" NOT NULL DEFAULT 'noindex',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_news_links" (
    "id" BIGSERIAL NOT NULL,
    "article_id" BIGINT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_news_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "articles_published_at_idx" ON "articles"("published_at");

-- CreateIndex
CREATE INDEX "articles_license_status_idx" ON "articles"("license_status");

-- CreateIndex
CREATE INDEX "article_translations_language_code_index_status_idx" ON "article_translations"("language_code", "index_status");

-- CreateIndex
CREATE UNIQUE INDEX "article_translations_article_id_language_code_key" ON "article_translations"("article_id", "language_code");

-- CreateIndex
CREATE UNIQUE INDEX "article_translations_language_code_slug_key" ON "article_translations"("language_code", "slug");

-- CreateIndex
CREATE INDEX "entity_news_links_entity_type_entity_id_idx" ON "entity_news_links"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "entity_news_links_article_id_idx" ON "entity_news_links"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_news_links_article_id_entity_type_entity_id_key" ON "entity_news_links"("article_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_news_links" ADD CONSTRAINT "entity_news_links_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

