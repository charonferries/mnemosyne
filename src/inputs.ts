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
