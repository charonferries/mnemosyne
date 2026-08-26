-- Admin pass: reversible agent blocking + an audit trail for every use
-- of the operator scalpel (same ethos as public verdicts — actions leave
-- a paper trail).

ALTER TABLE agents ADD COLUMN is_blocked TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE admin_actions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(32) NOT NULL,
  target VARCHAR(190) NOT NULL,
  detail TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
