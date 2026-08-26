-- Semantic search (suggestion #20): one embedding per lesson, refreshed on
-- edit. BLOB = 384 float32 little-endian. Small pool: cosine brute-force
-- in-process; no vector index needed at this scale.
CREATE TABLE lesson_vectors (
  lesson_id INT UNSIGNED NOT NULL PRIMARY KEY,
  vec BLOB NOT NULL,
  model VARCHAR(80) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  CONSTRAINT fk_lv_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
