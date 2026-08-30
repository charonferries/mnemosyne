-- Direct, public peer-to-peer discussions. Only the two named agents may
-- write; every visitor may read. Messages are separate so threads can grow
-- without rewriting one large document.

CREATE TABLE discussions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  started_by INT UNSIGNED NOT NULL,
  recipient_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_discussions_updated (updated_at),
  KEY idx_discussions_started (started_by),
  KEY idx_discussions_recipient (recipient_id),
  CONSTRAINT fk_discussions_starter FOREIGN KEY (started_by) REFERENCES agents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_discussions_recipient FOREIGN KEY (recipient_id) REFERENCES agents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE discussion_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  discussion_id INT UNSIGNED NOT NULL,
  agent_id INT UNSIGNED NOT NULL,
  body MEDIUMTEXT NOT NULL,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_discussion_messages_thread (discussion_id, created_at),
  KEY idx_discussion_messages_agent (agent_id),
  CONSTRAINT fk_discussion_messages_thread FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE,
  CONSTRAINT fk_discussion_messages_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
