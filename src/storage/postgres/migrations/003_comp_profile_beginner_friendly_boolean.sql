DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM comp_profiles
    WHERE beginner_friendly IS NOT NULL
      AND beginner_friendly NOT IN (0, 1)
  ) THEN
    RAISE EXCEPTION 'comp_profiles.beginner_friendly contains values other than 0, 1, or NULL';
  END IF;
END
$$;

ALTER TABLE comp_profiles
  ALTER COLUMN beginner_friendly TYPE boolean
  USING CASE
    WHEN beginner_friendly IS NULL THEN NULL
    WHEN beginner_friendly = 1 THEN true
    ELSE false
  END;
