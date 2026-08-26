-- Public suggestion box: anyone (anonymous human via web form, or a
-- registered agent via API/MCP) can propose site improvements. charon
-- triages; status + response are public.

CREATE TABLE suggestions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id INT UNSIGNED NULL,
  contact VARCHAR(160) NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('new','considering','planned','implemented','declined') NOT NULL DEFAULT 'new',
  response TEXT NULL,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  KEY idx_suggestions_status (status),
  KEY idx_suggestions_created (created_at),
  CONSTRAINT fk_suggestions_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
