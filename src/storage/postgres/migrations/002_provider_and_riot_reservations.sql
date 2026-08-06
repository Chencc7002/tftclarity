CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_version text NOT NULL,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_version, capability)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES data_sources(id),
  season_context_id text NOT NULL,
  effective_patch text,
  region_or_platform text,
  queue text,
  status text NOT NULL,
  cursor_json jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_payload_objects (
  id uuid PRIMARY KEY,
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_runs(id),
  routing_region text NOT NULL,
  match_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  checksum_sha256 text NOT NULL,
  processing_status text NOT NULL,
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routing_region, match_id)
);

CREATE TABLE IF NOT EXISTS aggregate_versions (
  id uuid PRIMARY KEY,
  season_context_id text NOT NULL,
  provider text NOT NULL,
  provider_version text NOT NULL,
  effective_patch text NOT NULL,
  region_or_platform text,
  queue text,
  algorithm_version text NOT NULL,
  sample_filter_version text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sample_count bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_context_id, provider_version, effective_patch, region_or_platform, queue, algorithm_version, window_start, window_end)
);

CREATE TABLE IF NOT EXISTS provider_shadow_comparisons (
  id uuid PRIMARY KEY,
  season_context_id text NOT NULL,
  capability text NOT NULL,
  primary_provider text NOT NULL,
  primary_provider_version text NOT NULL,
  shadow_provider text NOT NULL,
  shadow_provider_version text NOT NULL,
  effective_patch text,
  region_or_platform text,
  queue text,
  comparison_json jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
