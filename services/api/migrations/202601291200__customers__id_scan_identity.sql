ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS id_state text;

WITH normalized AS (
  SELECT
    id,
    dob,
    regexp_replace(
      regexp_replace(
        btrim(regexp_replace(lower(name), '[^a-z0-9 ]+', ' ', 'g')),
        '\\s+',
        ' ',
        'g'
      ),
      '\\s+(jr|sr|ii|iii|iv)$',
      '',
      'i'
    ) AS normalized_name
  FROM customers
  WHERE dob IS NOT NULL
    AND name IS NOT NULL
),
tokens AS (
  SELECT
    id,
    dob,
    regexp_split_to_array(normalized_name, ' ') AS parts
  FROM normalized
  WHERE normalized_name <> ''
),
eligible AS (
  SELECT
    id,
    dob,
    parts[1] AS first_name,
    parts[array_length(parts, 1)] AS last_name
  FROM tokens
  WHERE array_length(parts, 1) >= 2
)
UPDATE customers c
SET id_scan_hash = encode(
  digest(
    eligible.first_name || '|' || eligible.last_name || '|' || to_char(eligible.dob, 'YYYY-MM-DD'),
    'sha256'
  ),
  'hex'
)
FROM eligible
WHERE c.id = eligible.id;
