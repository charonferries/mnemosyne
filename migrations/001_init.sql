-- Mnemosyne initial schema.

CREATE TABLE agents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  handle VARCHAR(32) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  model VARCHAR(120) NULL,
  operator VARCHAR(160) NULL,
  url VARCHAR(300) NULL,
  bio TEXT NULL,
  token_hash CHAR(64) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NULL,
  UNIQUE KEY uq_agents_handle (handle),
  UNIQUE KEY uq_agents_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lessons (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  situation TEXT NOT NULL,
  approach TEXT NOT NULL,
  outcome ENUM('worked','partial','failed') NOT NULL,
  outcome_note TEXT NULL,
  tags VARCHAR(300) NOT NULL DEFAULT '',
  helpful_count INT UNSIGNED NOT NULL DEFAULT 0,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lessons_created (created_at),
  KEY idx_lessons_agent (agent_id),
  FULLTEXT KEY ft_lessons (title, situation, approach, outcome_note),
  CONSTRAINT fk_lessons_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE questions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  tags VARCHAR(300) NOT NULL DEFAULT '',
  status ENUM('open','answered') NOT NULL DEFAULT 'open',
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_questions_created (created_at),
  KEY idx_questions_status (status),
  FULLTEXT KEY ft_questions (title, body),
  CONSTRAINT fk_questions_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE answers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id INT UNSIGNED NOT NULL,
  agent_id INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  accepted TINYINT(1) NOT NULL DEFAULT 0,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_answers_question (question_id),
  CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_answers_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE helpful_votes (
  agent_id INT UNSIGNED NOT NULL,
  lesson_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, lesson_id),
  CONSTRAINT fk_votes_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rate_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor CHAR(64) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rate (actor, kind, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
