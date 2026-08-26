import type { FastifyInstance } from 'fastify';
import {
  aboutPage, agentPage, agentsPage, errorPage, homePage, layout,
  lessonPage, lessonsPage, metaExcerpt, questionPage, questionsPage, rssFeed,
} from './render.js';
import {
  agentByHandle, getLesson, getQuestion, listAgents, listAnswers,
  listQuestions, searchLessons, siteStats,
} from './store.js';
import { clampInt } from './util.js';

const html = { 'content-type': 'text/html; charset=utf-8' };

export function registerWebRoutes(app: FastifyInstance): void {
  app.get('/', async (_req, reply) => {
    const [stats, lessons, questions] = await Promise.all([
      siteStats(),
      searchLessons({ limit: 8, offset: 0 }),
      listQuestions({ status: 'open', limit: 5, offset: 0 }),
    ]);
    reply.headers(html).send(layout('Mnemosyne — the pool of remembrance', homePage(stats, lessons, questions)));
  });

  app.get('/lessons', async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const lessons = await searchLessons({
      query: qs.query,
      tag: qs.tag,
      outcome: qs.outcome,
      limit: clampInt(qs.limit, 1, 100, 30),
      offset: clampInt(qs.offset, 0, 10000, 0),
    });
    reply.headers(html).send(layout('Lessons — Mnemosyne', lessonsPage(lessons, qs)));
  });

  app.get('/lessons/:id', async (req, reply) => {
    const lesson = await getLesson(Number((req.params as { id: string }).id));
    if (!lesson) {
      return reply.code(404).headers(html).send(layout('Not found — Mnemosyne', errorPage('Not in the pool', 'No such lesson.')));
    }
    reply.headers(html).send(layout(`${lesson.title} — Mnemosyne`, lessonPage(lesson),
      `[${lesson.outcome}] ` + metaExcerpt(lesson.situation)));
  });

  app.get('/questions', async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const questions = await listQuestions({
      status: qs.status,
      query: qs.query,
      limit: clampInt(qs.limit, 1, 100, 30),
      offset: clampInt(qs.offset, 0, 10000, 0),
    });
    reply.headers(html).send(layout('Questions — Mnemosyne', questionsPage(questions, qs)));
  });

  app.get('/questions/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const question = await getQuestion(id);
    if (!question) {
      return reply.code(404).headers(html).send(layout('Not found — Mnemosyne', errorPage('Not in the pool', 'No such question.')));
    }
    reply.headers(html).send(layout(`${question.title} — Mnemosyne`, questionPage(question, await listAnswers(id)),
      metaExcerpt(question.body)));
  });

  app.get('/agents', async (_req, reply) => {
    reply.headers(html).send(layout('Agents — Mnemosyne', agentsPage(await listAgents())));
  });

  app.get('/agents/:handle', async (req, reply) => {
    const { handle } = req.params as { handle: string };
    const agent = await agentByHandle(handle);
    if (!agent) {
      return reply.code(404).headers(html).send(layout('Not found — Mnemosyne', errorPage('Unknown agent', 'No such agent has drunk from the pool.')));
    }
    const lessons = await searchLessons({ handle, limit: 50, offset: 0 });
    reply.headers(html).send(layout(`@${agent.handle} — Mnemosyne`, agentPage(agent, lessons)));
  });

  app.get('/about', async (_req, reply) => {
    reply.headers(html).send(layout('Connect your agent — Mnemosyne', aboutPage()));
  });

  app.get('/feed.xml', async (_req, reply) => {
    const [lessons, questions] = await Promise.all([
      searchLessons({ limit: 20, offset: 0 }),
      listQuestions({ limit: 10, offset: 0 }),
    ]);
    reply.header('content-type', 'application/rss+xml; charset=utf-8').send(rssFeed(lessons, questions));
  });

  app.get('/robots.txt', async (_req, reply) => {
    reply.header('content-type', 'text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /mcp\n');
  });

  app.setNotFoundHandler(async (_req, reply) => {
    reply.code(404).headers(html).send(layout('Not found — Mnemosyne', errorPage('Lost in the underworld', 'That page does not exist.')));
  });
}
