import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PostgresStore } from "../src/storage/postgres/postgres-store.js";

function profileRow(beginnerFriendly) {
  return {
    season_context_id: "set17-live",
    profile_key: `profile-${String(beginnerFriendly)}`,
    difficulty: null,
    beginner_friendly: beginnerFriendly,
    pivot_difficulty: null,
    position_difficulty: null,
    contest_tolerance: null,
    econ_difficulty: null,
    notes_json: [],
    enabled: true,
    source: "migration-test",
    created_at: new Date("2026-08-07T00:00:00.000Z"),
    updated_at: new Date("2026-08-07T00:00:00.000Z")
  };
}

test("PostgresStore normalizes legacy integer comp profile booleans", async () => {
  const pool = {
    async query() {
      return { rows: [profileRow(0), profileRow(1), profileRow(null), profileRow(true)] };
    }
  };
  const profiles = await new PostgresStore({ pool }).listCompProfiles({ seasonContextId: "set17-live" });
  assert.deepEqual(profiles.map((profile) => profile.beginnerFriendly), [false, true, null, true]);
});

test("migration converts comp profile beginner friendliness to PostgreSQL boolean", async () => {
  const migration = await readFile(
    new URL("../src/storage/postgres/migrations/003_comp_profile_beginner_friendly_boolean.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /ALTER COLUMN beginner_friendly TYPE boolean/u);
  assert.match(migration, /beginner_friendly NOT IN \(0, 1\)/u);
  assert.match(migration, /WHEN beginner_friendly = 1 THEN true/u);
});
