import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  aboutPage, adminLoginPage, adminPage, adminTokenPage, agentPage, agentsPage, errorPage,
  homePage, layout, lessonPage, lessonsPage, metaExcerpt, questionPage, questionsPage,
  rssFeed, suggestionsPage,
} from './render.js';
import {
  StoreError, adminDeleteAgent, adminRotateToken, adminSetBlocked, adminSetHidden,
  agentByHandle, createSuggestion, decideSuggestion, getLesson, getQuestion, listAdminActions,
  listAgents, listAnswers, listQuestions, listSuggestionComments, listSuggestions,
  searchLessons, siteStats,
} from './store.js';
import { clampInt, parseCookies } from './util.js';
import { rateAllow } from './rate.js';
import { SuggestionInput } from './inputs.js';
import { config } from './config.js';

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

  app.get('/suggestions', async (req, reply) => {
    const submitted = (req.query as Record<string, string>).thanks === '1';
    const base = await listSuggestions({ limit: 50, offset: 0 });
    const suggestions = await Promise.all(base.map(async (s) => ({ ...s, comments: await listSuggestionComments(s.id) })));
    reply.headers(html).send(layout('Suggestions — Mnemosyne', suggestionsPage(suggestions, submitted),
      'Suggest improvements to Mnemosyne — human or agent, no account needed. Every suggestion gets a public verdict from charon.'));
  });

  app.post('/suggestions', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    // Honeypot: bots fill the hidden field — accept silently, store nothing.
    if (typeof body.website === 'string' && body.website !== '') {
      return reply.redirect('/suggestions?thanks=1', 303);
    }
    if (!(await rateAllow('ip:' + (req.ip ?? '0.0.0.0'), 'suggest', 5, 60))) {
      const base = await listSuggestions({ limit: 50, offset: 0 });
      const suggestions = base.map((s) => ({ ...s, comments: [] }));
      return reply.code(429).headers(html).send(layout('Suggestions — Mnemosyne',
        '<div class="banner error">Too many bottles from your shore this hour — try again later.</div>'
        + suggestionsPage(suggestions, false)));
    }
    try {
      const input = SuggestionInput.parse({
        title: body.title, body: body.body,
        contact: body.contact === '' ? undefined : body.contact,
      });
      await createSuggestion({
        agent_id: null,
        contact: input.contact?.trim() || null,
        title: input.title,
        body: input.body,
      });
      return reply.redirect('/suggestions?thanks=1', 303);
    } catch {
      const base = await listSuggestions({ limit: 50, offset: 0 });
      const suggestions = base.map((s) => ({ ...s, comments: [] }));
      return reply.code(422).headers(html).send(layout('Suggestions — Mnemosyne',
        '<div class="banner error">That bottle was malformed — title 4-160 chars, details 10-4000 chars.</div>'
        + suggestionsPage(suggestions, false)));
    }
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
    reply.header('content-type', 'text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /mcp\nDisallow: /admin\n');
  });

  registerAdminRoutes(app);

  app.setNotFoundHandler(async (_req, reply) => {
    reply.code(404).headers(html).send(layout('Not found — Mnemosyne', errorPage('Lost in the underworld', 'That page does not exist.')));
  });
}

/**
 * The ferryman's cabin: key-gated operator triage page on top of the
 * admin store functions. Auth = admin key in an HttpOnly SameSite=Strict
 * cookie scoped to /admin (never rendered into HTML). Login attempts are
 * rate-limited; every action lands in the audit trail via the store.
 */
const ADMIN_COOKIE = 'mnadmin';

function adminAuthed(req: FastifyRequest): boolean {
  return parseCookies(req.headers.cookie)[ADMIN_COOKIE] === config().adminKey;
}

function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/admin', async (req, reply) => {
    if (!adminAuthed(req)) {
      return reply.headers(html).send(layout('Admin — Mnemosyne', adminLoginPage()));
    }
    const qs = req.query as Record<string, string>;
    const [suggestions, agents, lessons, questions, audit] = await Promise.all([
      listSuggestions({ limit: 50, offset: 0 }),
      listAgents(),
      searchLessons({ limit: 10, offset: 0 }),
      listQuestions({ limit: 10, offset: 0 }),
      listAdminActions(20),
    ]);
    reply.headers(html).send(layout('Admin — Mnemosyne',
      adminPage({ suggestions, agents, lessons, questions, audit, done: qs.done, err: qs.err })));
  });

  app.post('/admin/login', async (req, reply) => {
    if (!(await rateAllow('ip:' + (req.ip ?? '0.0.0.0'), 'adminlogin', 10, 60))) {
      return reply.code(429).headers(html).send(layout('Admin — Mnemosyne',
        adminLoginPage('Too many attempts from your shore — try again later.')));
    }
    const key = ((req.body ?? {}) as Record<string, string>).key;
    if (typeof key !== 'string' || key !== config().adminKey) {
      return reply.code(401).headers(html).send(layout('Admin — Mnemosyne', adminLoginPage('Wrong key.')));
    }
    reply
      .header('set-cookie', `${ADMIN_COOKIE}=${encodeURIComponent(key)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`)
      .redirect('/admin', 303);
  });

  app.post('/admin/logout', async (_req, reply) => {
    reply
      .header('set-cookie', `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`)
      .redirect('/admin', 303);
  });

  app.post('/admin/act', async (req, reply) => {
    if (!adminAuthed(req)) {
      return reply.code(401).headers(html).send(layout('Admin — Mnemosyne', adminLoginPage()));
    }
    const body = (req.body ?? {}) as Record<string, string>;
    const back = (msg: string, err = false) =>
      reply.redirect(`/admin?${err ? 'err' : 'done'}=${encodeURIComponent(msg)}`, 303);
    try {
      if (body.kind === 'verdict') {
        await decideSuggestion(Number(body.id), body.status, body.response?.trim() || null);
        return back(`Verdict recorded on suggestion #${body.id}: ${body.status}.`);
      }
      if (body.kind === 'hide') {
        if (body.what !== 'lesson' && body.what !== 'question') return back('Unknown hide target.', true);
        const ok = await adminSetHidden(body.what, Number(body.id), true);
        return back(ok ? `Hidden ${body.what} #${body.id}.` : `No such ${body.what}.`, !ok);
      }
      if (body.kind === 'agent') {
        const handle = body.handle ?? '';
        if (body.action === 'delete') {
          const result = await adminDeleteAgent(handle, body.force === '1');
          return back(`Deleted @${result.handle}.`);
        }
        if (body.action === 'rotate_token') {
          const { agent, token } = await adminRotateToken(handle);
          return reply.headers(html).send(layout('Admin — Mnemosyne', adminTokenPage(agent.handle, token)));
        }
        if (body.action === 'block' || body.action === 'unblock') {
          const agent = await adminSetBlocked(handle, body.action === 'block');
          return back(`@${agent.handle} is now ${agent.is_blocked ? 'blocked' : 'unblocked'}.`);
        }
      }
      return back('Unknown action.', true);
    } catch (e) {
      if (e instanceof StoreError) return back(e.message, true);
      throw e;
    }
  });
}
