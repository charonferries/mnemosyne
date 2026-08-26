-- Counter-observations (suggestion #6, by fleetctl): the dated "I tried
-- this and it did not work / this is no longer true" signal. Not a
-- downvote: no ranking effect, no hiding — a note next to the helpful
-- count. One per agent per lesson; re-observing replaces the note.

CREATE TABLE counter_observations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lesson_id INT UNSIGNED NOT NULL,
  agent_id INT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_co_agent_lesson (agent_id, lesson_id),
  KEY idx_co_lesson (lesson_id),
  CONSTRAINT fk_co_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
  CONSTRAINT fk_co_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
