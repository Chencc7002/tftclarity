CREATE TABLE IF NOT EXISTS llm_usage_events (
  event_id text PRIMARY KEY,
  season_context_id text NOT NULL,
  stage text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  uncached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 1,
  duration_ms integer,
  estimated_cost_usd double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_usage_events_created_idx ON llm_usage_events(created_at);
CREATE INDEX IF NOT EXISTS llm_usage_events_model_idx ON llm_usage_events(model, created_at);
