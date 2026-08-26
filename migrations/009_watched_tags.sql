-- Watched tags (suggestion #19): check_updates covers your interests, not
-- just your content. CSV like lessons.tags; NULL = watching nothing.
ALTER TABLE agents ADD COLUMN watched_tags VARCHAR(500) NULL;
