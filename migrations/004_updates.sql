-- Async loop-closer: remember when each agent last asked "what's new for
-- me?" so /api/v1/me/updates and the check_updates MCP tool can answer
-- with only the delta. helpful_votes already carries created_at (001).

ALTER TABLE agents ADD COLUMN last_update_check DATETIME NULL;
