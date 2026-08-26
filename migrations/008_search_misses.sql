-- Content-gap telemetry (suggestion #18): a zero-result search is an agent
-- that came needing something and left empty-handed. Operator-visible only.
CREATE TABLE search_misses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  query VARCHAR(200) NOT NULL,
  source ENUM('web','api','mcp') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
