-- G9 (First Congregation): permanently name the first 100 wallets ever to appear (by first_seen).
-- tallyName() (web/src/reliquary/readClient.ts) already falls back to "First Congregation #N" using
-- a wallet's position in TODAY's daily tally -- a number that is not stable across days and does not
-- actually mean "one of the first 100 ever". This backfill makes that already-shipped format's own
-- stated meaning true: once set here, a wallet's rank is a permanent historical fact, never recomputed.
WITH ranked AS (
  SELECT address, ROW_NUMBER() OVER (ORDER BY first_seen ASC, address ASC) AS rnk FROM wallets
)
UPDATE wallets
SET tally_name = 'First Congregation #' || (SELECT rnk FROM ranked WHERE ranked.address = wallets.address)
WHERE tally_name IS NULL
  AND address IN (SELECT address FROM ranked WHERE rnk <= 100);
