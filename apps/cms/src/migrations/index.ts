import * as migration_20260728_224559_initial from './20260728_224559_initial';
import * as migration_20260729_011649_outbox_lease_and_scopes from './20260729_011649_outbox_lease_and_scopes';
import * as migration_20260729_145607_auto_publish_scope_and_author_policy from './20260729_145607_auto_publish_scope_and_author_policy';
import * as migration_20260729_145858_auto_publication_article_fields from './20260729_145858_auto_publication_article_fields';
import * as migration_20260729_170140_automation_audit_fields from './20260729_170140_automation_audit_fields';
import * as migration_20260729_180427_auto_publish_quota_counters from './20260729_180427_auto_publish_quota_counters';
import * as migration_20260729_180503_drop_legacy_contract_hash from './20260729_180503_drop_legacy_contract_hash';
import * as migration_20260729_184812_content_type_review from './20260729_184812_content_type_review';
import * as migration_20260729_223310_human_publication_trail from './20260729_223310_human_publication_trail';
import * as migration_20260804_031515_paragraph_inline_marks from './20260804_031515_paragraph_inline_marks';
import * as migration_20260805_013000_articles_slug_unique_per_language from './20260805_013000_articles_slug_unique_per_language';
import * as migration_20260805_175144_publish_collapse_trail from './20260805_175144_publish_collapse_trail';
import * as migration_20260805_224024_list_block from './20260805_224024_list_block';
import * as migration_20260805_225957_embed_gallery from './20260805_225957_embed_gallery';
import * as migration_20260805_231638_media_thumbnail from './20260805_231638_media_thumbnail';

export const migrations = [
  {
    up: migration_20260728_224559_initial.up,
    down: migration_20260728_224559_initial.down,
    name: '20260728_224559_initial',
  },
  {
    up: migration_20260729_011649_outbox_lease_and_scopes.up,
    down: migration_20260729_011649_outbox_lease_and_scopes.down,
    name: '20260729_011649_outbox_lease_and_scopes',
  },
  {
    up: migration_20260729_145607_auto_publish_scope_and_author_policy.up,
    down: migration_20260729_145607_auto_publish_scope_and_author_policy.down,
    name: '20260729_145607_auto_publish_scope_and_author_policy',
  },
  {
    up: migration_20260729_145858_auto_publication_article_fields.up,
    down: migration_20260729_145858_auto_publication_article_fields.down,
    name: '20260729_145858_auto_publication_article_fields',
  },
  {
    up: migration_20260729_170140_automation_audit_fields.up,
    down: migration_20260729_170140_automation_audit_fields.down,
    name: '20260729_170140_automation_audit_fields',
  },
  {
    up: migration_20260729_180427_auto_publish_quota_counters.up,
    down: migration_20260729_180427_auto_publish_quota_counters.down,
    name: '20260729_180427_auto_publish_quota_counters',
  },
  {
    up: migration_20260729_180503_drop_legacy_contract_hash.up,
    down: migration_20260729_180503_drop_legacy_contract_hash.down,
    name: '20260729_180503_drop_legacy_contract_hash',
  },
  {
    up: migration_20260729_184812_content_type_review.up,
    down: migration_20260729_184812_content_type_review.down,
    name: '20260729_184812_content_type_review',
  },
  {
    up: migration_20260729_223310_human_publication_trail.up,
    down: migration_20260729_223310_human_publication_trail.down,
    name: '20260729_223310_human_publication_trail',
  },
  {
    up: migration_20260804_031515_paragraph_inline_marks.up,
    down: migration_20260804_031515_paragraph_inline_marks.down,
    name: '20260804_031515_paragraph_inline_marks',
  },
  {
    up: migration_20260805_013000_articles_slug_unique_per_language.up,
    down: migration_20260805_013000_articles_slug_unique_per_language.down,
    name: '20260805_013000_articles_slug_unique_per_language',
  },
  {
    up: migration_20260805_175144_publish_collapse_trail.up,
    down: migration_20260805_175144_publish_collapse_trail.down,
    name: '20260805_175144_publish_collapse_trail',
  },
  {
    up: migration_20260805_224024_list_block.up,
    down: migration_20260805_224024_list_block.down,
    name: '20260805_224024_list_block',
  },
  {
    up: migration_20260805_225957_embed_gallery.up,
    down: migration_20260805_225957_embed_gallery.down,
    name: '20260805_225957_embed_gallery',
  },
  {
    up: migration_20260805_231638_media_thumbnail.up,
    down: migration_20260805_231638_media_thumbnail.down,
    name: '20260805_231638_media_thumbnail'
  },
];
