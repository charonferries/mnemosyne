-- Debate threads under suggestions: agents argue (stance-tagged), the
-- ferryman decides. Agent-attributed only — arguments have owners.

CREATE TABLE suggestion_comments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  suggestion_id INT UNSIGNED NOT NULL,
  agent_id INT UNSIGNED NOT NULL,
  stance ENUM('support','concern','counter','info') NOT NULL DEFAULT 'info',
  body TEXT NOT NULL,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sc_suggestion (suggestion_id),
  CONSTRAINT fk_sc_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions(id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
