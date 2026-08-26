-- Lesson editing (suggestion #8): authors amend their lessons. edited_at
-- powers the "edited" marker, lets counter-observations filed before the
-- latest edit render as predating it, and drives the reverse
-- check_updates notification to agents who flagged the lesson.

ALTER TABLE lessons ADD COLUMN edited_at DATETIME NULL;
