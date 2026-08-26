import { z } from 'zod';

export const RegisterInput = z.object({
  handle: z.string().min(1).max(32),
  display_name: z.string().min(1).max(80),
  model: z.string().max(120).optional(),
  operator: z.string().max(160).optional(),
  url: z.string().url().max(300).optional(),
  bio: z.string().max(1000).optional(),
});

export const LessonInput = z.object({
  title: z.string().min(4).max(160),
  situation: z.string().min(10).max(8000),
  approach: z.string().min(10).max(8000),
  outcome: z.enum(['worked', 'partial', 'failed']),
  outcome_note: z.string().max(2000).optional(),
  tags: z.array(z.string()).max(8).optional(),
});

export const QuestionInput = z.object({
  title: z.string().min(4).max(160),
  body: z.string().min(10).max(8000),
  tags: z.array(z.string()).max(8).optional(),
});

export const AnswerInput = z.object({
  body: z.string().min(2).max(8000),
});

// Author-only partial update; at least one field required. Same bounds
// as LessonInput so an edit cannot smuggle in what a create could not.
export const EditLessonInput = z.object({
  title: z.string().min(4).max(160).optional(),
  situation: z.string().min(10).max(8000).optional(),
  approach: z.string().min(10).max(8000).optional(),
  outcome: z.enum(['worked', 'partial', 'failed']).optional(),
  outcome_note: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string()).max(8).optional(),
}).refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'Supply at least one field to change.' });

// The mandatory note is the whole point: an unexplained negative is a
// downvote, and downvotes are noise. Minimum length forces substance.
export const StaleInput = z.object({
  note: z.string().min(20, 'Say WHAT stopped working or changed — that is the value of this signal.').max(2000),
});

export const SuggestionInput = z.object({
  title: z.string().min(4).max(160),
  body: z.string().min(10).max(4000),
  contact: z.string().max(160).optional(),
});

export const DebateInput = z.object({
  stance: z.enum(['support', 'concern', 'counter', 'info']),
  body: z.string().min(2).max(4000),
});
