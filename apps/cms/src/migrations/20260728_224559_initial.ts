import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_editorial_users_role" AS ENUM('administrator', 'editor_in_chief', 'editor', 'reviewer', 'writer');
  CREATE TYPE "public"."enum_service_accounts_purpose" AS ENUM('mnscr', 'internal_tooling');
  CREATE TYPE "public"."enum_media_license_status" AS ENUM('unknown', 'pending', 'approved', 'restricted', 'expired', 'prohibited');
  CREATE TYPE "public"."enum_media_provenance_type" AS ENUM('external_source', 'cinerie_catalog', 'cinerie_editorial', 'licensed_media', 'human_input');
  CREATE TYPE "public"."enum_articles_blocks_paragraph_provenance_origin" AS ENUM('external_source', 'cinerie_catalog', 'cinerie_editorial', 'licensed_media', 'human_input', 'inference');
  CREATE TYPE "public"."enum_articles_blocks_heading_level" AS ENUM('2', '3', '4');
  CREATE TYPE "public"."enum_articles_blocks_video_provider" AS ENUM('youtube', 'vimeo', 'internal');
  CREATE TYPE "public"."enum_articles_blocks_entity_card_entity_kind" AS ENUM('movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise');
  CREATE TYPE "public"."enum_articles_entity_references_entity_kind" AS ENUM('movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise');
  CREATE TYPE "public"."enum_articles_entity_references_relation" AS ENUM('primary_subject', 'secondary_subject', 'mentioned', 'reviewed', 'recommended', 'compared');
  CREATE TYPE "public"."enum_articles_external_sources_role" AS ENUM('primary', 'secondary', 'press_release', 'catalog');
  CREATE TYPE "public"."enum_articles_claims_origin" AS ENUM('external_source', 'cinerie_catalog', 'cinerie_editorial', 'licensed_media', 'human_input', 'inference');
  CREATE TYPE "public"."enum_articles_content_type" AS ENUM('news', 'feature', 'guide', 'list', 'interview', 'evergreen');
  CREATE TYPE "public"."enum_articles_workflow_status" AS ENUM('automation_draft', 'draft', 'needs_review', 'in_review', 'changes_requested', 'human_reviewed', 'ready_to_publish', 'published', 'needs_update', 'blocked', 'archived', 'retracted');
  CREATE TYPE "public"."enum_articles_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__articles_v_blocks_paragraph_provenance_origin" AS ENUM('external_source', 'cinerie_catalog', 'cinerie_editorial', 'licensed_media', 'human_input', 'inference');
  CREATE TYPE "public"."enum__articles_v_blocks_heading_level" AS ENUM('2', '3', '4');
  CREATE TYPE "public"."enum__articles_v_blocks_video_provider" AS ENUM('youtube', 'vimeo', 'internal');
  CREATE TYPE "public"."enum__articles_v_blocks_entity_card_entity_kind" AS ENUM('movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise');
  CREATE TYPE "public"."enum__articles_v_version_entity_references_entity_kind" AS ENUM('movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise');
  CREATE TYPE "public"."enum__articles_v_version_entity_references_relation" AS ENUM('primary_subject', 'secondary_subject', 'mentioned', 'reviewed', 'recommended', 'compared');
  CREATE TYPE "public"."enum__articles_v_version_external_sources_role" AS ENUM('primary', 'secondary', 'press_release', 'catalog');
  CREATE TYPE "public"."enum__articles_v_version_claims_origin" AS ENUM('external_source', 'cinerie_catalog', 'cinerie_editorial', 'licensed_media', 'human_input', 'inference');
  CREATE TYPE "public"."enum__articles_v_version_content_type" AS ENUM('news', 'feature', 'guide', 'list', 'interview', 'evergreen');
  CREATE TYPE "public"."enum__articles_v_version_workflow_status" AS ENUM('automation_draft', 'draft', 'needs_review', 'in_review', 'changes_requested', 'human_reviewed', 'ready_to_publish', 'published', 'needs_update', 'blocked', 'archived', 'retracted');
  CREATE TYPE "public"."enum__articles_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_publication_outbox_event_type" AS ENUM('article.published', 'article.updated', 'article.unpublished', 'article.retracted');
  CREATE TYPE "public"."enum_publication_outbox_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'dead_letter');
  CREATE TABLE "editorial_users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "editorial_users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"display_name" varchar NOT NULL,
  	"role" "enum_editorial_users_role" DEFAULT 'writer' NOT NULL,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "service_accounts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"purpose" "enum_service_accounts_purpose" DEFAULT 'mnscr' NOT NULL,
  	"active" boolean DEFAULT false,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"enable_a_p_i_key" boolean,
  	"api_key" varchar,
  	"api_key_index" varchar
  );
  
  CREATE TABLE "authors" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"bio" varchar,
  	"avatar_id" integer,
  	"role_label" varchar,
  	"public_email" varchar,
  	"active" boolean DEFAULT true,
  	"is_organization" boolean DEFAULT false,
  	"created_by_id" integer,
  	"updated_by_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "authors_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_authors_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_name" varchar NOT NULL,
  	"version_slug" varchar NOT NULL,
  	"version_bio" varchar,
  	"version_avatar_id" integer,
  	"version_role_label" varchar,
  	"version_public_email" varchar,
  	"version_active" boolean DEFAULT true,
  	"version_is_organization" boolean DEFAULT false,
  	"version_created_by_id" integer,
  	"version_updated_by_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_authors_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"caption" varchar,
  	"credit" varchar,
  	"source_name" varchar,
  	"source_url" varchar,
  	"rights_holder" varchar,
  	"license_status" "enum_media_license_status" DEFAULT 'unknown' NOT NULL,
  	"license_reference" varchar,
  	"license_expires_at" timestamp(3) with time zone,
  	"requires_attribution" boolean DEFAULT true,
  	"allowed_for_editorial" boolean DEFAULT false,
  	"allowed_for_hero" boolean DEFAULT false,
  	"allowed_for_social" boolean DEFAULT false,
  	"aspect_ratio" varchar,
  	"focal_point_x" numeric,
  	"focal_point_y" numeric,
  	"content_hash" varchar,
  	"provenance_type" "enum_media_provenance_type" DEFAULT 'external_source' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "media_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "articles_blocks_paragraph_provenance" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"origin" "enum_articles_blocks_paragraph_provenance_origin",
  	"ref" varchar
  );
  
  CREATE TABLE "articles_blocks_paragraph" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"text" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_heading" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"level" "enum_articles_blocks_heading_level",
  	"text" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_image" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"media_id" integer,
  	"alt" varchar,
  	"caption" varchar,
  	"credit" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_video" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"provider" "enum_articles_blocks_video_provider",
  	"external_id" varchar,
  	"url" varchar,
  	"title" varchar,
  	"credit" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"text" varchar,
  	"attribution" varchar,
  	"source_ref" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_entity_card" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"entity_kind" "enum_articles_blocks_entity_card_entity_kind",
  	"entity_id" varchar,
  	"note" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_fact_box_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"value" varchar
  );
  
  CREATE TABLE "articles_blocks_fact_box" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"title" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_related_content" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_source_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_divider" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_entity_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"entity_kind" "enum_articles_entity_references_entity_kind",
  	"entity_id" varchar,
  	"relation" "enum_articles_entity_references_relation",
  	"confidence" numeric,
  	"verified" boolean DEFAULT false
  );
  
  CREATE TABLE "articles_external_sources" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"source_id" varchar,
  	"name" varchar,
  	"url" varchar,
  	"role" "enum_articles_external_sources_role"
  );
  
  CREATE TABLE "articles_claims" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"claim_id" varchar,
  	"text" varchar,
  	"origin" "enum_articles_claims_origin"
  );
  
  CREATE TABLE "articles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"automation_draft_id" varchar,
  	"idempotency_key" varchar,
  	"source_cluster_id" varchar,
  	"source_revision" numeric,
  	"source_payload_hash" varchar,
  	"draft_payload_hash" varchar,
  	"pipeline_version" varchar,
  	"title" varchar,
  	"subtitle" varchar,
  	"slug" varchar,
  	"summary" varchar,
  	"content_type" "enum_articles_content_type" DEFAULT 'news',
  	"language" varchar DEFAULT 'pt-BR',
  	"hero_media_id" integer,
  	"primary_author_id" integer,
  	"section" varchar,
  	"provenance_json" jsonb,
  	"ai_assisted" boolean DEFAULT false,
  	"assigned_to_id" integer,
  	"legal_hold" boolean DEFAULT false,
  	"qa_version" varchar,
  	"qa_passed_at" timestamp(3) with time zone,
  	"workflow_status" "enum_articles_workflow_status" DEFAULT 'draft',
  	"scheduled_for" timestamp(3) with time zone,
  	"published_at" timestamp(3) with time zone,
  	"corrected_at" timestamp(3) with time zone,
  	"correction_note" varchar,
  	"retraction_reason" varchar,
  	"meta_title" varchar,
  	"meta_description" varchar,
  	"canonical_override" varchar,
  	"noindex" boolean DEFAULT false,
  	"social_title" varchar,
  	"social_description" varchar,
  	"social_media_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_articles_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "articles_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "articles_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer,
  	"authors_id" integer,
  	"articles_id" integer
  );
  
  CREATE TABLE "_articles_v_blocks_paragraph_provenance" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"origin" "enum__articles_v_blocks_paragraph_provenance_origin",
  	"ref" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_paragraph" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"text" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_heading" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"level" "enum__articles_v_blocks_heading_level",
  	"text" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_image" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"media_id" integer,
  	"alt" varchar,
  	"caption" varchar,
  	"credit" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_video" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"provider" "enum__articles_v_blocks_video_provider",
  	"external_id" varchar,
  	"url" varchar,
  	"title" varchar,
  	"credit" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"text" varchar,
  	"attribution" varchar,
  	"source_ref" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_entity_card" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"entity_kind" "enum__articles_v_blocks_entity_card_entity_kind",
  	"entity_id" varchar,
  	"note" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_fact_box_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"value" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_fact_box" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"title" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_related_content" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_source_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_divider" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_version_entity_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"entity_kind" "enum__articles_v_version_entity_references_entity_kind",
  	"entity_id" varchar,
  	"relation" "enum__articles_v_version_entity_references_relation",
  	"confidence" numeric,
  	"verified" boolean DEFAULT false,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v_version_external_sources" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"source_id" varchar,
  	"name" varchar,
  	"url" varchar,
  	"role" "enum__articles_v_version_external_sources_role",
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v_version_claims" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"claim_id" varchar,
  	"text" varchar,
  	"origin" "enum__articles_v_version_claims_origin",
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_automation_draft_id" varchar,
  	"version_idempotency_key" varchar,
  	"version_source_cluster_id" varchar,
  	"version_source_revision" numeric,
  	"version_source_payload_hash" varchar,
  	"version_draft_payload_hash" varchar,
  	"version_pipeline_version" varchar,
  	"version_title" varchar,
  	"version_subtitle" varchar,
  	"version_slug" varchar,
  	"version_summary" varchar,
  	"version_content_type" "enum__articles_v_version_content_type" DEFAULT 'news',
  	"version_language" varchar DEFAULT 'pt-BR',
  	"version_hero_media_id" integer,
  	"version_primary_author_id" integer,
  	"version_section" varchar,
  	"version_provenance_json" jsonb,
  	"version_ai_assisted" boolean DEFAULT false,
  	"version_assigned_to_id" integer,
  	"version_legal_hold" boolean DEFAULT false,
  	"version_qa_version" varchar,
  	"version_qa_passed_at" timestamp(3) with time zone,
  	"version_workflow_status" "enum__articles_v_version_workflow_status" DEFAULT 'draft',
  	"version_scheduled_for" timestamp(3) with time zone,
  	"version_published_at" timestamp(3) with time zone,
  	"version_corrected_at" timestamp(3) with time zone,
  	"version_correction_note" varchar,
  	"version_retraction_reason" varchar,
  	"version_meta_title" varchar,
  	"version_meta_description" varchar,
  	"version_canonical_override" varchar,
  	"version_noindex" boolean DEFAULT false,
  	"version_social_title" varchar,
  	"version_social_description" varchar,
  	"version_social_media_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__articles_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean,
  	"autosave" boolean
  );
  
  CREATE TABLE "_articles_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_articles_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer,
  	"authors_id" integer,
  	"articles_id" integer
  );
  
  CREATE TABLE "publication_outbox" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"event_type" "enum_publication_outbox_event_type" NOT NULL,
  	"aggregate_type" varchar DEFAULT 'article' NOT NULL,
  	"aggregate_id" varchar NOT NULL,
  	"aggregate_version" varchar NOT NULL,
  	"payload" jsonb NOT NULL,
  	"status" "enum_publication_outbox_status" DEFAULT 'pending' NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"available_at" timestamp(3) with time zone NOT NULL,
  	"locked_at" timestamp(3) with time zone,
  	"processed_at" timestamp(3) with time zone,
  	"last_error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"editorial_users_id" integer,
  	"service_accounts_id" integer,
  	"authors_id" integer,
  	"media_id" integer,
  	"articles_id" integer,
  	"publication_outbox_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"editorial_users_id" integer,
  	"service_accounts_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "editorial_users_sessions" ADD CONSTRAINT "editorial_users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."editorial_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "authors" ADD CONSTRAINT "authors_avatar_id_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "authors" ADD CONSTRAINT "authors_created_by_id_editorial_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."editorial_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "authors" ADD CONSTRAINT "authors_updated_by_id_editorial_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."editorial_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "authors_texts" ADD CONSTRAINT "authors_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_authors_v" ADD CONSTRAINT "_authors_v_parent_id_authors_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_authors_v" ADD CONSTRAINT "_authors_v_version_avatar_id_media_id_fk" FOREIGN KEY ("version_avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_authors_v" ADD CONSTRAINT "_authors_v_version_created_by_id_editorial_users_id_fk" FOREIGN KEY ("version_created_by_id") REFERENCES "public"."editorial_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_authors_v" ADD CONSTRAINT "_authors_v_version_updated_by_id_editorial_users_id_fk" FOREIGN KEY ("version_updated_by_id") REFERENCES "public"."editorial_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_authors_v_texts" ADD CONSTRAINT "_authors_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_authors_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media_texts" ADD CONSTRAINT "media_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_paragraph_provenance" ADD CONSTRAINT "articles_blocks_paragraph_provenance_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles_blocks_paragraph"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_paragraph" ADD CONSTRAINT "articles_blocks_paragraph_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_heading" ADD CONSTRAINT "articles_blocks_heading_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_image" ADD CONSTRAINT "articles_blocks_image_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles_blocks_image" ADD CONSTRAINT "articles_blocks_image_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_video" ADD CONSTRAINT "articles_blocks_video_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_quote" ADD CONSTRAINT "articles_blocks_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_entity_card" ADD CONSTRAINT "articles_blocks_entity_card_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_fact_box_items" ADD CONSTRAINT "articles_blocks_fact_box_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles_blocks_fact_box"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_fact_box" ADD CONSTRAINT "articles_blocks_fact_box_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_related_content" ADD CONSTRAINT "articles_blocks_related_content_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_source_list" ADD CONSTRAINT "articles_blocks_source_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_divider" ADD CONSTRAINT "articles_blocks_divider_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_entity_references" ADD CONSTRAINT "articles_entity_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_external_sources" ADD CONSTRAINT "articles_external_sources_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_claims" ADD CONSTRAINT "articles_claims_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles" ADD CONSTRAINT "articles_hero_media_id_media_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles" ADD CONSTRAINT "articles_primary_author_id_authors_id_fk" FOREIGN KEY ("primary_author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles" ADD CONSTRAINT "articles_assigned_to_id_editorial_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."editorial_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles" ADD CONSTRAINT "articles_social_media_id_media_id_fk" FOREIGN KEY ("social_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles_texts" ADD CONSTRAINT "articles_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_rels" ADD CONSTRAINT "articles_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_rels" ADD CONSTRAINT "articles_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_rels" ADD CONSTRAINT "articles_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_rels" ADD CONSTRAINT "articles_rels_articles_fk" FOREIGN KEY ("articles_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_paragraph_provenance" ADD CONSTRAINT "_articles_v_blocks_paragraph_provenance_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v_blocks_paragraph"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_paragraph" ADD CONSTRAINT "_articles_v_blocks_paragraph_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_heading" ADD CONSTRAINT "_articles_v_blocks_heading_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_image" ADD CONSTRAINT "_articles_v_blocks_image_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_image" ADD CONSTRAINT "_articles_v_blocks_image_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_video" ADD CONSTRAINT "_articles_v_blocks_video_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_quote" ADD CONSTRAINT "_articles_v_blocks_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_entity_card" ADD CONSTRAINT "_articles_v_blocks_entity_card_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_fact_box_items" ADD CONSTRAINT "_articles_v_blocks_fact_box_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v_blocks_fact_box"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_fact_box" ADD CONSTRAINT "_articles_v_blocks_fact_box_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_related_content" ADD CONSTRAINT "_articles_v_blocks_related_content_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_source_list" ADD CONSTRAINT "_articles_v_blocks_source_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_divider" ADD CONSTRAINT "_articles_v_blocks_divider_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_version_entity_references" ADD CONSTRAINT "_articles_v_version_entity_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_version_external_sources" ADD CONSTRAINT "_articles_v_version_external_sources_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_version_claims" ADD CONSTRAINT "_articles_v_version_claims_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_parent_id_articles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_version_hero_media_id_media_id_fk" FOREIGN KEY ("version_hero_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_version_primary_author_id_authors_id_fk" FOREIGN KEY ("version_primary_author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_version_assigned_to_id_editorial_users_id_fk" FOREIGN KEY ("version_assigned_to_id") REFERENCES "public"."editorial_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_version_social_media_id_media_id_fk" FOREIGN KEY ("version_social_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v_texts" ADD CONSTRAINT "_articles_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_rels" ADD CONSTRAINT "_articles_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_rels" ADD CONSTRAINT "_articles_v_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_rels" ADD CONSTRAINT "_articles_v_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_rels" ADD CONSTRAINT "_articles_v_rels_articles_fk" FOREIGN KEY ("articles_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_editorial_users_fk" FOREIGN KEY ("editorial_users_id") REFERENCES "public"."editorial_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_service_accounts_fk" FOREIGN KEY ("service_accounts_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_articles_fk" FOREIGN KEY ("articles_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publication_outbox_fk" FOREIGN KEY ("publication_outbox_id") REFERENCES "public"."publication_outbox"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_editorial_users_fk" FOREIGN KEY ("editorial_users_id") REFERENCES "public"."editorial_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_service_accounts_fk" FOREIGN KEY ("service_accounts_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "editorial_users_sessions_order_idx" ON "editorial_users_sessions" USING btree ("_order");
  CREATE INDEX "editorial_users_sessions_parent_id_idx" ON "editorial_users_sessions" USING btree ("_parent_id");
  CREATE INDEX "editorial_users_updated_at_idx" ON "editorial_users" USING btree ("updated_at");
  CREATE INDEX "editorial_users_created_at_idx" ON "editorial_users" USING btree ("created_at");
  CREATE UNIQUE INDEX "editorial_users_email_idx" ON "editorial_users" USING btree ("email");
  CREATE INDEX "service_accounts_updated_at_idx" ON "service_accounts" USING btree ("updated_at");
  CREATE INDEX "service_accounts_created_at_idx" ON "service_accounts" USING btree ("created_at");
  CREATE UNIQUE INDEX "authors_slug_idx" ON "authors" USING btree ("slug");
  CREATE INDEX "authors_avatar_idx" ON "authors" USING btree ("avatar_id");
  CREATE INDEX "authors_created_by_idx" ON "authors" USING btree ("created_by_id");
  CREATE INDEX "authors_updated_by_idx" ON "authors" USING btree ("updated_by_id");
  CREATE INDEX "authors_updated_at_idx" ON "authors" USING btree ("updated_at");
  CREATE INDEX "authors_created_at_idx" ON "authors" USING btree ("created_at");
  CREATE INDEX "authors_texts_order_parent" ON "authors_texts" USING btree ("order","parent_id");
  CREATE INDEX "_authors_v_parent_idx" ON "_authors_v" USING btree ("parent_id");
  CREATE INDEX "_authors_v_version_version_slug_idx" ON "_authors_v" USING btree ("version_slug");
  CREATE INDEX "_authors_v_version_version_avatar_idx" ON "_authors_v" USING btree ("version_avatar_id");
  CREATE INDEX "_authors_v_version_version_created_by_idx" ON "_authors_v" USING btree ("version_created_by_id");
  CREATE INDEX "_authors_v_version_version_updated_by_idx" ON "_authors_v" USING btree ("version_updated_by_id");
  CREATE INDEX "_authors_v_version_version_updated_at_idx" ON "_authors_v" USING btree ("version_updated_at");
  CREATE INDEX "_authors_v_version_version_created_at_idx" ON "_authors_v" USING btree ("version_created_at");
  CREATE INDEX "_authors_v_created_at_idx" ON "_authors_v" USING btree ("created_at");
  CREATE INDEX "_authors_v_updated_at_idx" ON "_authors_v" USING btree ("updated_at");
  CREATE INDEX "_authors_v_texts_order_parent" ON "_authors_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_texts_order_parent" ON "media_texts" USING btree ("order","parent_id");
  CREATE INDEX "articles_blocks_paragraph_provenance_order_idx" ON "articles_blocks_paragraph_provenance" USING btree ("_order");
  CREATE INDEX "articles_blocks_paragraph_provenance_parent_id_idx" ON "articles_blocks_paragraph_provenance" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_paragraph_order_idx" ON "articles_blocks_paragraph" USING btree ("_order");
  CREATE INDEX "articles_blocks_paragraph_parent_id_idx" ON "articles_blocks_paragraph" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_paragraph_path_idx" ON "articles_blocks_paragraph" USING btree ("_path");
  CREATE INDEX "articles_blocks_heading_order_idx" ON "articles_blocks_heading" USING btree ("_order");
  CREATE INDEX "articles_blocks_heading_parent_id_idx" ON "articles_blocks_heading" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_heading_path_idx" ON "articles_blocks_heading" USING btree ("_path");
  CREATE INDEX "articles_blocks_image_order_idx" ON "articles_blocks_image" USING btree ("_order");
  CREATE INDEX "articles_blocks_image_parent_id_idx" ON "articles_blocks_image" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_image_path_idx" ON "articles_blocks_image" USING btree ("_path");
  CREATE INDEX "articles_blocks_image_media_idx" ON "articles_blocks_image" USING btree ("media_id");
  CREATE INDEX "articles_blocks_video_order_idx" ON "articles_blocks_video" USING btree ("_order");
  CREATE INDEX "articles_blocks_video_parent_id_idx" ON "articles_blocks_video" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_video_path_idx" ON "articles_blocks_video" USING btree ("_path");
  CREATE INDEX "articles_blocks_quote_order_idx" ON "articles_blocks_quote" USING btree ("_order");
  CREATE INDEX "articles_blocks_quote_parent_id_idx" ON "articles_blocks_quote" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_quote_path_idx" ON "articles_blocks_quote" USING btree ("_path");
  CREATE INDEX "articles_blocks_entity_card_order_idx" ON "articles_blocks_entity_card" USING btree ("_order");
  CREATE INDEX "articles_blocks_entity_card_parent_id_idx" ON "articles_blocks_entity_card" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_entity_card_path_idx" ON "articles_blocks_entity_card" USING btree ("_path");
  CREATE INDEX "articles_blocks_fact_box_items_order_idx" ON "articles_blocks_fact_box_items" USING btree ("_order");
  CREATE INDEX "articles_blocks_fact_box_items_parent_id_idx" ON "articles_blocks_fact_box_items" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_fact_box_order_idx" ON "articles_blocks_fact_box" USING btree ("_order");
  CREATE INDEX "articles_blocks_fact_box_parent_id_idx" ON "articles_blocks_fact_box" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_fact_box_path_idx" ON "articles_blocks_fact_box" USING btree ("_path");
  CREATE INDEX "articles_blocks_related_content_order_idx" ON "articles_blocks_related_content" USING btree ("_order");
  CREATE INDEX "articles_blocks_related_content_parent_id_idx" ON "articles_blocks_related_content" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_related_content_path_idx" ON "articles_blocks_related_content" USING btree ("_path");
  CREATE INDEX "articles_blocks_source_list_order_idx" ON "articles_blocks_source_list" USING btree ("_order");
  CREATE INDEX "articles_blocks_source_list_parent_id_idx" ON "articles_blocks_source_list" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_source_list_path_idx" ON "articles_blocks_source_list" USING btree ("_path");
  CREATE INDEX "articles_blocks_divider_order_idx" ON "articles_blocks_divider" USING btree ("_order");
  CREATE INDEX "articles_blocks_divider_parent_id_idx" ON "articles_blocks_divider" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_divider_path_idx" ON "articles_blocks_divider" USING btree ("_path");
  CREATE INDEX "articles_entity_references_order_idx" ON "articles_entity_references" USING btree ("_order");
  CREATE INDEX "articles_entity_references_parent_id_idx" ON "articles_entity_references" USING btree ("_parent_id");
  CREATE INDEX "articles_external_sources_order_idx" ON "articles_external_sources" USING btree ("_order");
  CREATE INDEX "articles_external_sources_parent_id_idx" ON "articles_external_sources" USING btree ("_parent_id");
  CREATE INDEX "articles_claims_order_idx" ON "articles_claims" USING btree ("_order");
  CREATE INDEX "articles_claims_parent_id_idx" ON "articles_claims" USING btree ("_parent_id");
  CREATE INDEX "articles_automation_draft_id_idx" ON "articles" USING btree ("automation_draft_id");
  CREATE INDEX "articles_idempotency_key_idx" ON "articles" USING btree ("idempotency_key");
  CREATE INDEX "articles_source_cluster_id_idx" ON "articles" USING btree ("source_cluster_id");
  CREATE INDEX "articles_slug_idx" ON "articles" USING btree ("slug");
  CREATE INDEX "articles_hero_media_idx" ON "articles" USING btree ("hero_media_id");
  CREATE INDEX "articles_primary_author_idx" ON "articles" USING btree ("primary_author_id");
  CREATE INDEX "articles_assigned_to_idx" ON "articles" USING btree ("assigned_to_id");
  CREATE INDEX "articles_workflow_status_idx" ON "articles" USING btree ("workflow_status");
  CREATE INDEX "articles_social_media_idx" ON "articles" USING btree ("social_media_id");
  CREATE INDEX "articles_updated_at_idx" ON "articles" USING btree ("updated_at");
  CREATE INDEX "articles_created_at_idx" ON "articles" USING btree ("created_at");
  CREATE INDEX "articles__status_idx" ON "articles" USING btree ("_status");
  CREATE INDEX "articles_texts_order_parent" ON "articles_texts" USING btree ("order","parent_id");
  CREATE INDEX "articles_rels_order_idx" ON "articles_rels" USING btree ("order");
  CREATE INDEX "articles_rels_parent_idx" ON "articles_rels" USING btree ("parent_id");
  CREATE INDEX "articles_rels_path_idx" ON "articles_rels" USING btree ("path");
  CREATE INDEX "articles_rels_media_id_idx" ON "articles_rels" USING btree ("media_id");
  CREATE INDEX "articles_rels_authors_id_idx" ON "articles_rels" USING btree ("authors_id");
  CREATE INDEX "articles_rels_articles_id_idx" ON "articles_rels" USING btree ("articles_id");
  CREATE INDEX "_articles_v_blocks_paragraph_provenance_order_idx" ON "_articles_v_blocks_paragraph_provenance" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_paragraph_provenance_parent_id_idx" ON "_articles_v_blocks_paragraph_provenance" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_paragraph_order_idx" ON "_articles_v_blocks_paragraph" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_paragraph_parent_id_idx" ON "_articles_v_blocks_paragraph" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_paragraph_path_idx" ON "_articles_v_blocks_paragraph" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_heading_order_idx" ON "_articles_v_blocks_heading" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_heading_parent_id_idx" ON "_articles_v_blocks_heading" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_heading_path_idx" ON "_articles_v_blocks_heading" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_image_order_idx" ON "_articles_v_blocks_image" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_image_parent_id_idx" ON "_articles_v_blocks_image" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_image_path_idx" ON "_articles_v_blocks_image" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_image_media_idx" ON "_articles_v_blocks_image" USING btree ("media_id");
  CREATE INDEX "_articles_v_blocks_video_order_idx" ON "_articles_v_blocks_video" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_video_parent_id_idx" ON "_articles_v_blocks_video" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_video_path_idx" ON "_articles_v_blocks_video" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_quote_order_idx" ON "_articles_v_blocks_quote" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_quote_parent_id_idx" ON "_articles_v_blocks_quote" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_quote_path_idx" ON "_articles_v_blocks_quote" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_entity_card_order_idx" ON "_articles_v_blocks_entity_card" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_entity_card_parent_id_idx" ON "_articles_v_blocks_entity_card" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_entity_card_path_idx" ON "_articles_v_blocks_entity_card" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_fact_box_items_order_idx" ON "_articles_v_blocks_fact_box_items" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_fact_box_items_parent_id_idx" ON "_articles_v_blocks_fact_box_items" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_fact_box_order_idx" ON "_articles_v_blocks_fact_box" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_fact_box_parent_id_idx" ON "_articles_v_blocks_fact_box" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_fact_box_path_idx" ON "_articles_v_blocks_fact_box" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_related_content_order_idx" ON "_articles_v_blocks_related_content" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_related_content_parent_id_idx" ON "_articles_v_blocks_related_content" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_related_content_path_idx" ON "_articles_v_blocks_related_content" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_source_list_order_idx" ON "_articles_v_blocks_source_list" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_source_list_parent_id_idx" ON "_articles_v_blocks_source_list" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_source_list_path_idx" ON "_articles_v_blocks_source_list" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_divider_order_idx" ON "_articles_v_blocks_divider" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_divider_parent_id_idx" ON "_articles_v_blocks_divider" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_divider_path_idx" ON "_articles_v_blocks_divider" USING btree ("_path");
  CREATE INDEX "_articles_v_version_entity_references_order_idx" ON "_articles_v_version_entity_references" USING btree ("_order");
  CREATE INDEX "_articles_v_version_entity_references_parent_id_idx" ON "_articles_v_version_entity_references" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_version_external_sources_order_idx" ON "_articles_v_version_external_sources" USING btree ("_order");
  CREATE INDEX "_articles_v_version_external_sources_parent_id_idx" ON "_articles_v_version_external_sources" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_version_claims_order_idx" ON "_articles_v_version_claims" USING btree ("_order");
  CREATE INDEX "_articles_v_version_claims_parent_id_idx" ON "_articles_v_version_claims" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_parent_idx" ON "_articles_v" USING btree ("parent_id");
  CREATE INDEX "_articles_v_version_version_automation_draft_id_idx" ON "_articles_v" USING btree ("version_automation_draft_id");
  CREATE INDEX "_articles_v_version_version_idempotency_key_idx" ON "_articles_v" USING btree ("version_idempotency_key");
  CREATE INDEX "_articles_v_version_version_source_cluster_id_idx" ON "_articles_v" USING btree ("version_source_cluster_id");
  CREATE INDEX "_articles_v_version_version_slug_idx" ON "_articles_v" USING btree ("version_slug");
  CREATE INDEX "_articles_v_version_version_hero_media_idx" ON "_articles_v" USING btree ("version_hero_media_id");
  CREATE INDEX "_articles_v_version_version_primary_author_idx" ON "_articles_v" USING btree ("version_primary_author_id");
  CREATE INDEX "_articles_v_version_version_assigned_to_idx" ON "_articles_v" USING btree ("version_assigned_to_id");
  CREATE INDEX "_articles_v_version_version_workflow_status_idx" ON "_articles_v" USING btree ("version_workflow_status");
  CREATE INDEX "_articles_v_version_version_social_media_idx" ON "_articles_v" USING btree ("version_social_media_id");
  CREATE INDEX "_articles_v_version_version_updated_at_idx" ON "_articles_v" USING btree ("version_updated_at");
  CREATE INDEX "_articles_v_version_version_created_at_idx" ON "_articles_v" USING btree ("version_created_at");
  CREATE INDEX "_articles_v_version_version__status_idx" ON "_articles_v" USING btree ("version__status");
  CREATE INDEX "_articles_v_created_at_idx" ON "_articles_v" USING btree ("created_at");
  CREATE INDEX "_articles_v_updated_at_idx" ON "_articles_v" USING btree ("updated_at");
  CREATE INDEX "_articles_v_latest_idx" ON "_articles_v" USING btree ("latest");
  CREATE INDEX "_articles_v_autosave_idx" ON "_articles_v" USING btree ("autosave");
  CREATE INDEX "_articles_v_texts_order_parent" ON "_articles_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "_articles_v_rels_order_idx" ON "_articles_v_rels" USING btree ("order");
  CREATE INDEX "_articles_v_rels_parent_idx" ON "_articles_v_rels" USING btree ("parent_id");
  CREATE INDEX "_articles_v_rels_path_idx" ON "_articles_v_rels" USING btree ("path");
  CREATE INDEX "_articles_v_rels_media_id_idx" ON "_articles_v_rels" USING btree ("media_id");
  CREATE INDEX "_articles_v_rels_authors_id_idx" ON "_articles_v_rels" USING btree ("authors_id");
  CREATE INDEX "_articles_v_rels_articles_id_idx" ON "_articles_v_rels" USING btree ("articles_id");
  CREATE UNIQUE INDEX "publication_outbox_event_id_idx" ON "publication_outbox" USING btree ("event_id");
  CREATE UNIQUE INDEX "publication_outbox_idempotency_key_idx" ON "publication_outbox" USING btree ("idempotency_key");
  CREATE INDEX "publication_outbox_aggregate_id_idx" ON "publication_outbox" USING btree ("aggregate_id");
  CREATE INDEX "publication_outbox_status_idx" ON "publication_outbox" USING btree ("status");
  CREATE INDEX "publication_outbox_updated_at_idx" ON "publication_outbox" USING btree ("updated_at");
  CREATE INDEX "publication_outbox_created_at_idx" ON "publication_outbox" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_editorial_users_id_idx" ON "payload_locked_documents_rels" USING btree ("editorial_users_id");
  CREATE INDEX "payload_locked_documents_rels_service_accounts_id_idx" ON "payload_locked_documents_rels" USING btree ("service_accounts_id");
  CREATE INDEX "payload_locked_documents_rels_authors_id_idx" ON "payload_locked_documents_rels" USING btree ("authors_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_articles_id_idx" ON "payload_locked_documents_rels" USING btree ("articles_id");
  CREATE INDEX "payload_locked_documents_rels_publication_outbox_id_idx" ON "payload_locked_documents_rels" USING btree ("publication_outbox_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_editorial_users_id_idx" ON "payload_preferences_rels" USING btree ("editorial_users_id");
  CREATE INDEX "payload_preferences_rels_service_accounts_id_idx" ON "payload_preferences_rels" USING btree ("service_accounts_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "editorial_users_sessions" CASCADE;
  DROP TABLE "editorial_users" CASCADE;
  DROP TABLE "service_accounts" CASCADE;
  DROP TABLE "authors" CASCADE;
  DROP TABLE "authors_texts" CASCADE;
  DROP TABLE "_authors_v" CASCADE;
  DROP TABLE "_authors_v_texts" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "media_texts" CASCADE;
  DROP TABLE "articles_blocks_paragraph_provenance" CASCADE;
  DROP TABLE "articles_blocks_paragraph" CASCADE;
  DROP TABLE "articles_blocks_heading" CASCADE;
  DROP TABLE "articles_blocks_image" CASCADE;
  DROP TABLE "articles_blocks_video" CASCADE;
  DROP TABLE "articles_blocks_quote" CASCADE;
  DROP TABLE "articles_blocks_entity_card" CASCADE;
  DROP TABLE "articles_blocks_fact_box_items" CASCADE;
  DROP TABLE "articles_blocks_fact_box" CASCADE;
  DROP TABLE "articles_blocks_related_content" CASCADE;
  DROP TABLE "articles_blocks_source_list" CASCADE;
  DROP TABLE "articles_blocks_divider" CASCADE;
  DROP TABLE "articles_entity_references" CASCADE;
  DROP TABLE "articles_external_sources" CASCADE;
  DROP TABLE "articles_claims" CASCADE;
  DROP TABLE "articles" CASCADE;
  DROP TABLE "articles_texts" CASCADE;
  DROP TABLE "articles_rels" CASCADE;
  DROP TABLE "_articles_v_blocks_paragraph_provenance" CASCADE;
  DROP TABLE "_articles_v_blocks_paragraph" CASCADE;
  DROP TABLE "_articles_v_blocks_heading" CASCADE;
  DROP TABLE "_articles_v_blocks_image" CASCADE;
  DROP TABLE "_articles_v_blocks_video" CASCADE;
  DROP TABLE "_articles_v_blocks_quote" CASCADE;
  DROP TABLE "_articles_v_blocks_entity_card" CASCADE;
  DROP TABLE "_articles_v_blocks_fact_box_items" CASCADE;
  DROP TABLE "_articles_v_blocks_fact_box" CASCADE;
  DROP TABLE "_articles_v_blocks_related_content" CASCADE;
  DROP TABLE "_articles_v_blocks_source_list" CASCADE;
  DROP TABLE "_articles_v_blocks_divider" CASCADE;
  DROP TABLE "_articles_v_version_entity_references" CASCADE;
  DROP TABLE "_articles_v_version_external_sources" CASCADE;
  DROP TABLE "_articles_v_version_claims" CASCADE;
  DROP TABLE "_articles_v" CASCADE;
  DROP TABLE "_articles_v_texts" CASCADE;
  DROP TABLE "_articles_v_rels" CASCADE;
  DROP TABLE "publication_outbox" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_editorial_users_role";
  DROP TYPE "public"."enum_service_accounts_purpose";
  DROP TYPE "public"."enum_media_license_status";
  DROP TYPE "public"."enum_media_provenance_type";
  DROP TYPE "public"."enum_articles_blocks_paragraph_provenance_origin";
  DROP TYPE "public"."enum_articles_blocks_heading_level";
  DROP TYPE "public"."enum_articles_blocks_video_provider";
  DROP TYPE "public"."enum_articles_blocks_entity_card_entity_kind";
  DROP TYPE "public"."enum_articles_entity_references_entity_kind";
  DROP TYPE "public"."enum_articles_entity_references_relation";
  DROP TYPE "public"."enum_articles_external_sources_role";
  DROP TYPE "public"."enum_articles_claims_origin";
  DROP TYPE "public"."enum_articles_content_type";
  DROP TYPE "public"."enum_articles_workflow_status";
  DROP TYPE "public"."enum_articles_status";
  DROP TYPE "public"."enum__articles_v_blocks_paragraph_provenance_origin";
  DROP TYPE "public"."enum__articles_v_blocks_heading_level";
  DROP TYPE "public"."enum__articles_v_blocks_video_provider";
  DROP TYPE "public"."enum__articles_v_blocks_entity_card_entity_kind";
  DROP TYPE "public"."enum__articles_v_version_entity_references_entity_kind";
  DROP TYPE "public"."enum__articles_v_version_entity_references_relation";
  DROP TYPE "public"."enum__articles_v_version_external_sources_role";
  DROP TYPE "public"."enum__articles_v_version_claims_origin";
  DROP TYPE "public"."enum__articles_v_version_content_type";
  DROP TYPE "public"."enum__articles_v_version_workflow_status";
  DROP TYPE "public"."enum__articles_v_version_status";
  DROP TYPE "public"."enum_publication_outbox_event_type";
  DROP TYPE "public"."enum_publication_outbox_status";`)
}
