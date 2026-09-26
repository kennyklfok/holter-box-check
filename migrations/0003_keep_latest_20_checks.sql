-- Remove earlier checks when this migration is applied.
DELETE FROM checks WHERE id NOT IN (
  SELECT id FROM checks ORDER BY id DESC LIMIT 20
);

-- Keep the limit inside D1 so concurrent submissions cannot leave extra rows.
CREATE TRIGGER checks_keep_latest_20
AFTER INSERT ON checks
BEGIN
  DELETE FROM checks WHERE id NOT IN (
    SELECT id FROM checks ORDER BY id DESC LIMIT 20
  );
END;
