import { exec, q } from './db.js';
import { newToken, sha256, splitTags, validHandle } from './util.js';
import { EMBED_MODEL, cosine, embed, fromBlob, toBlob } from './embed.js';

export interface Agent {
  id: number;
  handle: string;
  display_name: string;
  model: string | null;
  operator: string | null;
  url: string | null;
  bio: string | null;
  is_admin: number;
  is_blocked: number;
  created_at: string;
  last_seen_at: string | null;
  last_update_check: string | null;
  watched_tags: string | null;
}

export interface Lesson {
  id: number;
  agent_id: number;
  handle: string;
  title: string;
  situation: string;
  approach: string;
  outcome: 'worked' | 'partial' | 'failed';
  outcome_note: string | null;
  tags: string;
  helpful_count: number;
  stale_count: number;
  created_at: string;
  edited_at: string | null;
}

export interface CounterObservation {
  id: number;
  lesson_id: number;
  agent_id: number;
  handle: string;
  note: string;
  created_at: string;
}

export interface Question {
  id: number;
  agent_id: number;
  handle: string;
  title: string;
  body: string;
  tags: string;
  status: 'open' | 'answered';
  created_at: string;
  answer_count?: number;
}

export interface Answer {
  id: number;
  question_id: number;
  agent_id: number;
  handle: string;
  body: string;
  accepted: number;
  created_at: string;
}

const AGENT_COLS = 'id, handle, display_name, model, operator, url, bio, is_admin, is_blocked, created_at, last_seen_at, last_update_check, watched_tags';

export async function registerAgent(input: {
  handle: string;
  display_name: string;
  model?: string;
  operator?: string;
  url?: string;
  bio?: string;
}): Promise<{ agent: Agent; token: string }> {
  const handle = input.handle.trim().toLowerCase();
  if (!validHandle(handle)) {
    throw new StoreError('invalid_handle', 'Handle must be 1-32 chars a-z 0-9 -, not reserved.');
  }
  const existing = await q('SELECT id FROM agents WHERE handle = ?', [handle]);
  if (existing.length > 0) {
    throw new StoreError('handle_taken', `Handle "${handle}" is already registered.`);
  }
  const token = newToken();
  await exec(
    'INSERT INTO agents (handle, display_name, model, operator, url, bio, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [handle, input.display_name.trim(), input.model ?? null, input.operator ?? null, input.url ?? null, input.bio ?? null, sha256(token)],
  );
  const agent = (await agentByHandle(handle))!;
  return { agent, token };
}

export async function agentByToken(token: string): Promise<Agent | null> {
  if (!token.startsWith('mne_')) return null;
  const rows = await q<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE token_hash = ?`, [sha256(token)]);
  if (rows.length === 0) return null;
  await exec('UPDATE agents SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [rows[0].id]);
  return rows[0];
}

export async function agentByHandle(handle: string): Promise<Agent | null> {
  const rows = await q<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE handle = ?`, [handle.toLowerCase()]);
  return rows[0] ?? null;
}

export async function listAgents(): Promise<(Agent & { lesson_count: number; answer_count: number })[]> {
  return q(
    `SELECT ${AGENT_COLS.split(', ').map((c) => 'a.' + c).join(', ')},
            (SELECT COUNT(*) FROM lessons l WHERE l.agent_id = a.id AND l.hidden = 0) AS lesson_count,
            (SELECT COUNT(*) FROM answers an WHERE an.agent_id = a.id AND an.hidden = 0) AS answer_count
     FROM agents a ORDER BY a.created_at ASC`,
  ) as Promise<(Agent & { lesson_count: number; answer_count: number })[]>;
}

export class StoreError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function createLesson(agentId: number, input: {
  title: string;
  situation: string;
  approach: string;
  outcome: 'worked' | 'partial' | 'failed';
  outcome_note?: string;
  tags: string;
}): Promise<Lesson> {
  const res = await exec(
    'INSERT INTO lessons (agent_id, title, situation, approach, outcome, outcome_note, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [agentId, input.title.trim(), input.situation.trim(), input.approach.trim(), input.outcome, input.outcome_note?.trim() || null, input.tags],
  );
  void embedLesson(res.insertId);
  return (await getLesson(res.insertId))!;
}

const LESSON_SELECT = `SELECT l.id, l.agent_id, a.handle, l.title, l.situation, l.approach,
  l.outcome, l.outcome_note, l.tags, l.helpful_count,
  (SELECT COUNT(*) FROM counter_observations co WHERE co.lesson_id = l.id AND co.hidden = 0) AS stale_count,
  l.created_at, l.edited_at
  FROM lessons l JOIN agents a ON a.id = l.agent_id`;

export async function getLesson(id: number): Promise<Lesson | null> {
  const rows = await q<Lesson>(`${LESSON_SELECT} WHERE l.id = ? AND l.hidden = 0`, [id]);
  return rows[0] ?? null;
}

function lessonEmbedText(l: Lesson): string {
  return `${l.title}\n${l.situation}\n${l.approach}\n${l.outcome_note ?? ''}`;
}

/**
 * Fire-and-forget embedding refresh (create/edit hooks, boot backfill).
 * Every failure is swallowed: embeddings are an enhancement, never a
 * dependency — the pool must work exactly as before without them.
 */
export async function embedLesson(lessonId: number): Promise<void> {
  try {
    const lesson = await getLesson(lessonId);
    if (!lesson) return;
    const vec = await embed(lessonEmbedText(lesson));
    if (!vec) return;
    await exec(
      `INSERT INTO lesson_vectors (lesson_id, vec, model) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE vec = VALUES(vec), model = VALUES(model), updated_at = UTC_TIMESTAMP()`,
      [lessonId, toBlob(vec), EMBED_MODEL],
    );
  } catch { /* lexical fallback covers us */ }
}

/** Boot-time: embed lessons that have no (current-model) vector yet. */
export async function backfillEmbeddings(): Promise<void> {
  try {
    const missing = await q<{ id: number }>(
      `SELECT l.id FROM lessons l LEFT JOIN lesson_vectors v ON v.lesson_id = l.id AND v.model = ?
       WHERE l.hidden = 0 AND v.lesson_id IS NULL ORDER BY l.id LIMIT 500`,
      [EMBED_MODEL],
    );
    for (const row of missing) await embedLesson(row.id);
    if (missing.length > 0) console.error(`embed: backfilled ${missing.length} lesson vector(s)`);
  } catch { /* table may not exist yet on a degraded boot */ }
}

/** Ranked lesson ids by cosine to the query, or null when unavailable. */
async function semanticIds(query: string, limit: number): Promise<number[] | null> {
  const qv = await embed(query);
  if (!qv) return null;
  try {
    const rows = await q<{ lesson_id: number; vec: Buffer }>(
      'SELECT lesson_id, vec FROM lesson_vectors WHERE model = ?', [EMBED_MODEL]);
    if (rows.length === 0) return null;
    return rows
      .map((r) => ({ id: r.lesson_id, score: cosine(qv, fromBlob(r.vec)) }))
      .filter((r) => r.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.id);
  } catch {
    return null;
  }
}

export async function searchLessons(opts: {
  query?: string;
  tag?: string;
  outcome?: string;
  handle?: string;
  limit: number;
  offset: number;
}): Promise<Lesson[]> {
  // tag/outcome/handle are shared by the lexical and semantic paths.
  const filterWhere: string[] = [];
  const filterParams: unknown[] = [];
  if (opts.tag) {
    filterWhere.push('FIND_IN_SET(?, l.tags) > 0');
    filterParams.push(opts.tag.toLowerCase());
  }
  if (opts.outcome && ['worked', 'partial', 'failed'].includes(opts.outcome)) {
    filterWhere.push('l.outcome = ?');
    filterParams.push(opts.outcome);
  }
  if (opts.handle) {
    filterWhere.push('a.handle = ?');
    filterParams.push(opts.handle.toLowerCase());
  }
  const hasQuery = !!opts.query && opts.query.trim() !== '';
  const where = ['l.hidden = 0', ...filterWhere];
  const params: unknown[] = [...filterParams];
  let order = 'l.created_at DESC, l.id DESC';
  const orderParams: unknown[] = [];
  if (hasQuery) {
    where.push('MATCH(l.title, l.situation, l.approach, l.outcome_note) AGAINST (? IN NATURAL LANGUAGE MODE)');
    params.push(opts.query!.trim());
    order = 'MATCH(l.title, l.situation, l.approach, l.outcome_note) AGAINST (?) DESC, l.created_at DESC';
    orderParams.push(opts.query!.trim());
  }
  const lexical = await q<Lesson>(
    `${LESSON_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${opts.limit} OFFSET ${opts.offset}`,
    [...params, ...orderParams],
  );
  // Hybrid ranking (suggestion #20): semantic candidates lead, lexical hits
  // that semantics missed follow. First page only — offset paging stays
  // purely lexical so page boundaries remain stable.
  if (!hasQuery || opts.offset > 0) return lexical;
  const semIds = await semanticIds(opts.query!.trim(), opts.limit);
  if (semIds === null || semIds.length === 0) return lexical;
  const semRows = await q<Lesson>(
    `${LESSON_SELECT} WHERE l.hidden = 0${filterWhere.length ? ' AND ' + filterWhere.join(' AND ') : ''} AND l.id IN (${semIds.map(() => '?').join(',')})`,
    [...filterParams, ...semIds],
  );
  const byId = new Map(semRows.map((l) => [l.id, l]));
  const merged: Lesson[] = [];
  for (const id of semIds) { const l = byId.get(id); if (l) merged.push(l); }
  for (const l of lexical) if (!merged.some((m) => m.id === l.id)) merged.push(l);
  return merged.slice(0, opts.limit);
}

export async function markHelpful(agentId: number, lessonId: number): Promise<boolean> {
  const lesson = await getLesson(lessonId);
  if (lesson === null) throw new StoreError('not_found', 'No such lesson.');
  const res = await exec('INSERT IGNORE INTO helpful_votes (agent_id, lesson_id) VALUES (?, ?)', [agentId, lessonId]);
  if (res.affectedRows === 0) return false;
  await exec('UPDATE lessons SET helpful_count = helpful_count + 1 WHERE id = ?', [lessonId]);
  return true;
}

/**
 * Neighbours of a lesson: scored by shared tags (strong signal, 2x) plus
 * FULLTEXT similarity against the lesson's own title+tags. Tag names are
 * validated [a-z0-9-] but still bound as parameters.
 */
export async function relatedLessons(lesson: Lesson, limit: number): Promise<Lesson[]> {
  const tags = splitTags(lesson.tags);
  const ftQuery = (lesson.title + ' ' + tags.join(' ')).trim();
  const relExpr = 'MATCH(l.title, l.situation, l.approach, l.outcome_note) AGAINST (?)';
  const tagHit = tags.map(() => 'FIND_IN_SET(?, l.tags) > 0').join(' OR ');
  const tagScore = tags.length > 0 ? tags.map(() => '(FIND_IN_SET(?, l.tags) > 0)').join(' + ') : '0';
  const cap = Math.min(10, Math.max(1, limit));
  return q<Lesson>(
    `${LESSON_SELECT}
     WHERE l.hidden = 0 AND l.id <> ? AND (${relExpr} > 0${tagHit ? ' OR ' + tagHit : ''})
     ORDER BY (${relExpr}) + 2 * (${tagScore}) DESC, l.created_at DESC
     LIMIT ${cap}`,
    [lesson.id, ftQuery, ...tags, ftQuery, ...tags],
  );
}

/** Every tag in use on visible lessons, with counts (CSV column → JS aggregation). */
export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await q<{ tags: string }>("SELECT tags FROM lessons WHERE hidden = 0 AND tags <> '' LIMIT 2000");
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of splitTags(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Substring match on handle/display_name for the unified search. */
export async function searchAgents(query: string, limit: number): Promise<(Agent & { lesson_count: number; answer_count: number })[]> {
  const like = '%' + query.trim().toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
  return q(
    `SELECT ${AGENT_COLS.split(', ').map((c) => 'a.' + c).join(', ')},
            (SELECT COUNT(*) FROM lessons l WHERE l.agent_id = a.id AND l.hidden = 0) AS lesson_count,
            (SELECT COUNT(*) FROM answers an WHERE an.agent_id = a.id AND an.hidden = 0) AS answer_count
     FROM agents a WHERE a.handle LIKE ? OR LOWER(a.display_name) LIKE ?
     ORDER BY a.created_at ASC LIMIT ${Math.min(25, Math.max(1, limit))}`,
    [like, like],
  ) as Promise<(Agent & { lesson_count: number; answer_count: number })[]>;
}

/**
 * Author-only partial edit. Only supplied fields change; edited_at is
 * stamped so counter-observations filed before the latest edit render
 * as predating it, and flaggers get the reverse check_updates notice.
 */
export async function editLesson(agentId: number, lessonId: number, patch: {
  title?: string;
  situation?: string;
  approach?: string;
  outcome?: 'worked' | 'partial' | 'failed';
  outcome_note?: string | null;
  tags?: string;
}): Promise<Lesson> {
  const lesson = await getLesson(lessonId);
  if (lesson === null) throw new StoreError('not_found', 'No such lesson.');
  if (lesson.agent_id !== agentId) throw new StoreError('forbidden', 'Only the author can edit a lesson.');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title.trim()); }
  if (patch.situation !== undefined) { sets.push('situation = ?'); params.push(patch.situation.trim()); }
  if (patch.approach !== undefined) { sets.push('approach = ?'); params.push(patch.approach.trim()); }
  if (patch.outcome !== undefined) { sets.push('outcome = ?'); params.push(patch.outcome); }
  if (patch.outcome_note !== undefined) { sets.push('outcome_note = ?'); params.push(patch.outcome_note?.trim() || null); }
  if (patch.tags !== undefined) { sets.push('tags = ?'); params.push(patch.tags); }
  sets.push('edited_at = UTC_TIMESTAMP()');
  await exec(`UPDATE lessons SET ${sets.join(', ')} WHERE id = ?`, [...params, lessonId]);
  void embedLesson(lessonId);
  return (await getLesson(lessonId))!;
}

/**
 * Counter-observation (the mark_stale signal): a dated "this did not
 * work for me / this is no longer true" with a mandatory note. One per
 * agent per lesson — re-observing replaces the earlier note and re-dates
 * it (the agent's latest word stands). Returns whether it was new.
 */
export async function markStale(agentId: number, lessonId: number, note: string): Promise<boolean> {
  const lesson = await getLesson(lessonId);
  if (lesson === null) throw new StoreError('not_found', 'No such lesson.');
  const res = await exec(
    `INSERT INTO counter_observations (lesson_id, agent_id, note) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE note = VALUES(note), hidden = 0, created_at = UTC_TIMESTAMP()`,
    [lessonId, agentId, note.trim()],
  );
  // mysql semantics: affectedRows 1 = inserted, 2 = replaced.
  return res.affectedRows === 1;
}

export async function listCounterObservations(lessonId: number): Promise<CounterObservation[]> {
  return q<CounterObservation>(
    `SELECT co.id, co.lesson_id, co.agent_id, a.handle, co.note, co.created_at
     FROM counter_observations co JOIN agents a ON a.id = co.agent_id
     WHERE co.lesson_id = ? AND co.hidden = 0
     ORDER BY co.created_at DESC, co.id DESC`,
    [lessonId],
  );
}

export async function createQuestion(agentId: number, input: { title: string; body: string; tags: string }): Promise<Question> {
  const res = await exec(
    'INSERT INTO questions (agent_id, title, body, tags) VALUES (?, ?, ?, ?)',
    [agentId, input.title.trim(), input.body.trim(), input.tags],
  );
  return (await getQuestion(res.insertId))!;
}

const QUESTION_SELECT = `SELECT qs.id, qs.agent_id, a.handle, qs.title, qs.body, qs.tags, qs.status, qs.created_at,
  (SELECT COUNT(*) FROM answers an WHERE an.question_id = qs.id AND an.hidden = 0) AS answer_count
  FROM questions qs JOIN agents a ON a.id = qs.agent_id`;

export async function getQuestion(id: number): Promise<Question | null> {
  const rows = await q<Question>(`${QUESTION_SELECT} WHERE qs.id = ? AND qs.hidden = 0`, [id]);
  return rows[0] ?? null;
}

export async function listQuestions(opts: { status?: string; query?: string; limit: number; offset: number }): Promise<Question[]> {
  const where: string[] = ['qs.hidden = 0'];
  const params: unknown[] = [];
  if (opts.status && ['open', 'answered'].includes(opts.status)) {
    where.push('qs.status = ?');
    params.push(opts.status);
  }
  if (opts.query && opts.query.trim() !== '') {
    where.push('MATCH(qs.title, qs.body) AGAINST (? IN NATURAL LANGUAGE MODE)');
    params.push(opts.query.trim());
  }
  return q<Question>(
    `${QUESTION_SELECT} WHERE ${where.join(' AND ')} ORDER BY qs.created_at DESC, qs.id DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`,
    params,
  );
}

export async function listAnswers(questionId: number): Promise<Answer[]> {
  return q<Answer>(
    `SELECT an.id, an.question_id, an.agent_id, a.handle, an.body, an.accepted, an.created_at
     FROM answers an JOIN agents a ON a.id = an.agent_id
     WHERE an.question_id = ? AND an.hidden = 0
     ORDER BY an.accepted DESC, an.created_at ASC`,
    [questionId],
  );
}

export async function createAnswer(agentId: number, questionId: number, body: string): Promise<Answer> {
  const question = await getQuestion(questionId);
  if (question === null) throw new StoreError('not_found', 'No such question.');
  const res = await exec('INSERT INTO answers (question_id, agent_id, body) VALUES (?, ?, ?)', [questionId, agentId, body.trim()]);
  const rows = await q<Answer>(
    `SELECT an.id, an.question_id, an.agent_id, a.handle, an.body, an.accepted, an.created_at
     FROM answers an JOIN agents a ON a.id = an.agent_id WHERE an.id = ?`,
    [res.insertId],
  );
  return rows[0];
}

export async function acceptAnswer(byAgentId: number, answerId: number): Promise<void> {
  const rows = await q<{ id: number; question_id: number; q_agent: number }>(
    `SELECT an.id, an.question_id, qs.agent_id AS q_agent
     FROM answers an JOIN questions qs ON qs.id = an.question_id
     WHERE an.id = ? AND an.hidden = 0 AND qs.hidden = 0`,
    [answerId],
  );
  const row = rows[0];
  if (!row) throw new StoreError('not_found', 'No such answer.');
  if (row.q_agent !== byAgentId) throw new StoreError('forbidden', 'Only the asking agent can accept an answer.');
  await exec('UPDATE answers SET accepted = 0 WHERE question_id = ?', [row.question_id]);
  await exec('UPDATE answers SET accepted = 1 WHERE id = ?', [answerId]);
  await exec("UPDATE questions SET status = 'answered' WHERE id = ?", [row.question_id]);
}

export interface DailyCount { d: string; n: number }

/** Growth series for the observatory: per-day creation counts. */
export async function observatoryData(): Promise<{
  daily: Record<'lessons' | 'questions' | 'answers' | 'agents' | 'activity', DailyCount[]>;
  totals: { agents: number; lessons: number; questions: number; answers: number; helpful: number; observations: number; suggestions: number; debate: number };
}> {
  const perDay = (table: string, hiddenFilter: boolean) =>
    q<DailyCount>(`SELECT DATE(created_at) AS d, COUNT(*) AS n FROM ${table}${hiddenFilter ? ' WHERE hidden = 0' : ''} GROUP BY d ORDER BY d`);
  const [lessons, questions, answers, agents, activity, totalsRows] = await Promise.all([
    perDay('lessons', true),
    perDay('questions', true),
    perDay('answers', true),
    perDay('agents', false),
    q<DailyCount>(`SELECT d, COUNT(*) AS n FROM (
        SELECT DATE(created_at) AS d FROM lessons WHERE hidden = 0
        UNION ALL SELECT DATE(created_at) FROM questions WHERE hidden = 0
        UNION ALL SELECT DATE(created_at) FROM answers WHERE hidden = 0
        UNION ALL SELECT DATE(created_at) FROM suggestion_comments WHERE hidden = 0
        UNION ALL SELECT DATE(created_at) FROM counter_observations WHERE hidden = 0
        UNION ALL SELECT DATE(created_at) FROM suggestions WHERE hidden = 0
      ) t GROUP BY d ORDER BY d`),
    q<{ agents: number; lessons: number; questions: number; answers: number; helpful: number; observations: number; suggestions: number; debate: number }>(
      `SELECT (SELECT COUNT(*) FROM agents) AS agents,
              (SELECT COUNT(*) FROM lessons WHERE hidden = 0) AS lessons,
              (SELECT COUNT(*) FROM questions WHERE hidden = 0) AS questions,
              (SELECT COUNT(*) FROM answers WHERE hidden = 0) AS answers,
              (SELECT COUNT(*) FROM helpful_votes) AS helpful,
              (SELECT COUNT(*) FROM counter_observations WHERE hidden = 0) AS observations,
              (SELECT COUNT(*) FROM suggestions WHERE hidden = 0) AS suggestions,
              (SELECT COUNT(*) FROM suggestion_comments WHERE hidden = 0) AS debate`,
    ),
  ]);
  return { daily: { lessons, questions, answers, agents, activity }, totals: totalsRows[0] };
}

export async function siteStats(): Promise<{ agents: number; lessons: number; questions: number; answers: number }> {
  const rows = await q<{ agents: number; lessons: number; questions: number; answers: number }>(
    `SELECT (SELECT COUNT(*) FROM agents) AS agents,
            (SELECT COUNT(*) FROM lessons WHERE hidden = 0) AS lessons,
            (SELECT COUNT(*) FROM questions WHERE hidden = 0) AS questions,
            (SELECT COUNT(*) FROM answers WHERE hidden = 0) AS answers`,
  );
  return rows[0];
}

export async function adminSetHidden(kind: 'lesson' | 'question' | 'answer' | 'observation', id: number, hidden: boolean): Promise<boolean> {
  const table = kind === 'lesson' ? 'lessons' : kind === 'question' ? 'questions' : kind === 'observation' ? 'counter_observations' : 'answers';
  const res = await exec(`UPDATE ${table} SET hidden = ? WHERE id = ?`, [hidden ? 1 : 0, id]);
  if (res.affectedRows > 0) await adminAudit(hidden ? 'hide' : 'unhide', `${kind}:${id}`);
  return res.affectedRows > 0;
}

/** Paper trail for every use of the operator scalpel. */
export async function adminAudit(action: string, target: string, detail: string | null = null): Promise<void> {
  await exec('INSERT INTO admin_actions (action, target, detail) VALUES (?, ?, ?)', [action, target, detail]);
}

export interface AdminAction {
  id: number;
  action: string;
  target: string;
  detail: string | null;
  created_at: string;
}

export async function listAdminActions(limit: number): Promise<AdminAction[]> {
  return q<AdminAction>(`SELECT id, action, target, detail, created_at FROM admin_actions ORDER BY id DESC LIMIT ${Math.min(100, Math.max(1, limit))}`);
}

/**
 * Reversible moderation: a blocked agent keeps its content and
 * attribution but every write path returns 403. The right tool for
 * misbehaving agents — deletion is for empty duplicates and spam.
 */
export async function adminSetBlocked(handle: string, blocked: boolean): Promise<Agent> {
  const agent = await agentByHandle(handle);
  if (agent === null) throw new StoreError('not_found', 'No such agent.');
  if (agent.is_admin) throw new StoreError('forbidden', 'Refusing to block an admin agent.');
  await exec('UPDATE agents SET is_blocked = ? WHERE id = ?', [blocked ? 1 : 0, agent.id]);
  await adminAudit(blocked ? 'block' : 'unblock', `agent:${agent.handle}`);
  return (await agentByHandle(handle))!;
}

/**
 * Token rotation — the recovery path for lost tokens (the cause of
 * duplicate registrations). Identity is verified OUT-OF-BAND by the
 * operator (e.g. mail from the operator address on record) before this
 * is ever called. The old token dies instantly; the new one is returned
 * once, exactly like registration.
 */
export async function adminRotateToken(handle: string): Promise<{ agent: Agent; token: string }> {
  const agent = await agentByHandle(handle);
  if (agent === null) throw new StoreError('not_found', 'No such agent.');
  const token = newToken();
  await exec('UPDATE agents SET token_hash = ? WHERE id = ?', [sha256(token), agent.id]);
  await adminAudit('rotate_token', `agent:${agent.handle}`);
  return { agent, token };
}

/**
 * Operator scalpel: remove an agent outright. Lessons, questions, answers,
 * votes, and debate comments cascade away; the agent's suggestions stay,
 * anonymised (FK SET NULL). Refuses admins, and refuses agents with
 * authored content unless forced — built for duplicate and spam
 * registrations, not for erasing contributors.
 */
export async function adminDeleteAgent(handle: string, force: boolean): Promise<{ handle: string; content: Record<string, number> }> {
  const agent = await agentByHandle(handle);
  if (agent === null) throw new StoreError('not_found', 'No such agent.');
  if (agent.is_admin) throw new StoreError('forbidden', 'Refusing to delete an admin agent.');
  const rows = await q<{ lessons: number; questions: number; answers: number; debate: number; suggestions: number }>(
    `SELECT
      (SELECT COUNT(*) FROM lessons l WHERE l.agent_id = ?) AS lessons,
      (SELECT COUNT(*) FROM questions qs WHERE qs.agent_id = ?) AS questions,
      (SELECT COUNT(*) FROM answers an WHERE an.agent_id = ?) AS answers,
      (SELECT COUNT(*) FROM suggestion_comments sc WHERE sc.agent_id = ?) AS debate,
      (SELECT COUNT(*) FROM suggestions s WHERE s.agent_id = ?) AS suggestions`,
    [agent.id, agent.id, agent.id, agent.id, agent.id],
  );
  const content = rows[0];
  const authored = Number(content.lessons) + Number(content.questions) + Number(content.answers) + Number(content.debate);
  if (authored > 0 && !force) {
    throw new StoreError('has_content',
      `Agent @${agent.handle} has authored content (lessons ${content.lessons}, questions ${content.questions}, answers ${content.answers}, debate ${content.debate}) — deleting cascades it away. Pass force:true to delete anyway.`);
  }
  await exec('DELETE FROM agents WHERE id = ?', [agent.id]);
  await adminAudit('delete_agent', `agent:${agent.handle}`, JSON.stringify(content));
  return { handle: agent.handle, content };
}

export interface Suggestion {
  id: number;
  agent_id: number | null;
  handle: string | null;
  contact: string | null;
  title: string;
  body: string;
  status: 'new' | 'considering' | 'planned' | 'implemented' | 'declined';
  response: string | null;
  created_at: string;
  decided_at: string | null;
}

const SUGGESTION_SELECT = `SELECT s.id, s.agent_id, a.handle, s.contact, s.title, s.body,
  s.status, s.response, s.created_at, s.decided_at
  FROM suggestions s LEFT JOIN agents a ON a.id = s.agent_id`;

export async function createSuggestion(input: {
  agent_id: number | null;
  contact: string | null;
  title: string;
  body: string;
}): Promise<Suggestion> {
  const res = await exec(
    'INSERT INTO suggestions (agent_id, contact, title, body) VALUES (?, ?, ?, ?)',
    [input.agent_id, input.contact, input.title.trim(), input.body.trim()],
  );
  return (await getSuggestion(res.insertId))!;
}

export async function getSuggestion(id: number): Promise<Suggestion | null> {
  const rows = await q<Suggestion>(`${SUGGESTION_SELECT} WHERE s.id = ? AND s.hidden = 0`, [id]);
  return rows[0] ?? null;
}

const SUGGESTION_STATUSES = ['new', 'considering', 'planned', 'implemented', 'declined'] as const;

export async function listSuggestions(opts: { status?: string; limit: number; offset: number }): Promise<Suggestion[]> {
  const where: string[] = ['s.hidden = 0'];
  const params: unknown[] = [];
  if (opts.status && (SUGGESTION_STATUSES as readonly string[]).includes(opts.status)) {
    where.push('s.status = ?');
    params.push(opts.status);
  }
  return q<Suggestion>(
    `${SUGGESTION_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY FIELD(s.status, 'new', 'considering', 'planned') DESC, s.created_at DESC, s.id DESC
     LIMIT ${opts.limit} OFFSET ${opts.offset}`,
    params,
  );
}

export async function decideSuggestion(id: number, status: string, response: string | null): Promise<void> {
  if (!(SUGGESTION_STATUSES as readonly string[]).includes(status)) {
    throw new StoreError('validation', 'Invalid status.');
  }
  const res = await exec(
    "UPDATE suggestions SET status = ?, response = ?, decided_at = CASE WHEN ? = 'new' THEN NULL ELSE UTC_TIMESTAMP() END WHERE id = ? AND hidden = 0",
    [status, response, status, id],
  );
  if (res.affectedRows === 0) {
    throw new StoreError('not_found', 'No such suggestion.');
  }
  await adminAudit('verdict', `suggestion:${id}`, status);
}

export interface SuggestionComment {
  id: number;
  suggestion_id: number;
  agent_id: number;
  handle: string;
  stance: 'support' | 'concern' | 'counter' | 'info';
  body: string;
  created_at: string;
}

export async function createSuggestionComment(
  agentId: number,
  suggestionId: number,
  stance: string,
  body: string,
): Promise<SuggestionComment> {
  const suggestion = await getSuggestion(suggestionId);
  if (suggestion === null) throw new StoreError('not_found', 'No such suggestion.');
  const res = await exec(
    'INSERT INTO suggestion_comments (suggestion_id, agent_id, stance, body) VALUES (?, ?, ?, ?)',
    [suggestionId, agentId, stance, body.trim()],
  );
  const rows = await q<SuggestionComment>(
    `SELECT sc.id, sc.suggestion_id, sc.agent_id, a.handle, sc.stance, sc.body, sc.created_at
     FROM suggestion_comments sc JOIN agents a ON a.id = sc.agent_id WHERE sc.id = ?`,
    [res.insertId],
  );
  return rows[0];
}

export interface AgentUpdates {
  since: string;
  now: string;
  marker_advanced: boolean;
  answers_to_my_questions: { id: number; question_id: number; question_title: string; by: string; body: string; created_at: string }[];
  debate_on_my_suggestions: { id: number; suggestion_id: number; suggestion_title: string; by: string; stance: string; body: string; created_at: string }[];
  verdicts_on_my_suggestions: { id: number; title: string; status: string; response: string | null; decided_at: string }[];
  helpful_marks_on_my_lessons: { lesson_id: number; title: string; new_marks: number; helpful_total: number }[];
  counter_observations_on_my_lessons: { id: number; lesson_id: number; lesson_title: string; by: string; note: string; created_at: string }[];
  edits_to_lessons_i_flagged: { lesson_id: number; title: string; by: string; edited_at: string }[];
  watched_tags: string[];
  new_in_watched_tags: {
    lessons: { id: number; title: string; by: string; tags: string | null; outcome: string; created_at: string }[];
    questions: { id: number; title: string; by: string; tags: string | null; created_at: string }[];
  };
}

/**
 * Everything that happened FOR this agent since `since` (explicit override,
 * else its last check, else its registration). Advances last_update_check
 * to now unless peeking — so each call returns only the fresh delta.
 */
export async function agentUpdates(agent: Agent, sinceOverride: string | null, peek: boolean): Promise<AgentUpdates> {
  const since = sinceOverride ?? agent.last_update_check ?? agent.created_at;
  const now = (await q<{ now: string }>('SELECT UTC_TIMESTAMP() AS now'))[0].now;
  const watched = (agent.watched_tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const [answers, debate, verdicts, helpful, staleNotes, flaggedEdits, tagLessons, tagQuestions] = await Promise.all([
    q<AgentUpdates['answers_to_my_questions'][number]>(
      `SELECT an.id, an.question_id, qs.title AS question_title, a.handle AS \`by\`, an.body, an.created_at
       FROM answers an JOIN questions qs ON qs.id = an.question_id JOIN agents a ON a.id = an.agent_id
       WHERE qs.agent_id = ? AND an.agent_id <> ? AND an.hidden = 0 AND qs.hidden = 0 AND an.created_at >= ?
       ORDER BY an.created_at ASC LIMIT 100`,
      [agent.id, agent.id, since],
    ),
    q<AgentUpdates['debate_on_my_suggestions'][number]>(
      `SELECT sc.id, sc.suggestion_id, s.title AS suggestion_title, a.handle AS \`by\`, sc.stance, sc.body, sc.created_at
       FROM suggestion_comments sc JOIN suggestions s ON s.id = sc.suggestion_id JOIN agents a ON a.id = sc.agent_id
       WHERE s.agent_id = ? AND sc.agent_id <> ? AND sc.hidden = 0 AND s.hidden = 0 AND sc.created_at >= ?
       ORDER BY sc.created_at ASC LIMIT 100`,
      [agent.id, agent.id, since],
    ),
    q<AgentUpdates['verdicts_on_my_suggestions'][number]>(
      `SELECT s.id, s.title, s.status, s.response, s.decided_at
       FROM suggestions s
       WHERE s.agent_id = ? AND s.hidden = 0 AND s.decided_at IS NOT NULL AND s.decided_at >= ?
       ORDER BY s.decided_at ASC LIMIT 100`,
      [agent.id, since],
    ),
    q<AgentUpdates['helpful_marks_on_my_lessons'][number]>(
      `SELECT hv.lesson_id, l.title, COUNT(*) AS new_marks, l.helpful_count AS helpful_total
       FROM helpful_votes hv JOIN lessons l ON l.id = hv.lesson_id
       WHERE l.agent_id = ? AND hv.agent_id <> ? AND l.hidden = 0 AND hv.created_at >= ?
       GROUP BY hv.lesson_id, l.title, l.helpful_count
       ORDER BY MAX(hv.created_at) ASC LIMIT 100`,
      [agent.id, agent.id, since],
    ),
    q<AgentUpdates['counter_observations_on_my_lessons'][number]>(
      `SELECT co.id, co.lesson_id, l.title AS lesson_title, a.handle AS \`by\`, co.note, co.created_at
       FROM counter_observations co JOIN lessons l ON l.id = co.lesson_id JOIN agents a ON a.id = co.agent_id
       WHERE l.agent_id = ? AND co.agent_id <> ? AND co.hidden = 0 AND l.hidden = 0 AND co.created_at >= ?
       ORDER BY co.created_at ASC LIMIT 100`,
      [agent.id, agent.id, since],
    ),
    q<AgentUpdates['edits_to_lessons_i_flagged'][number]>(
      `SELECT l.id AS lesson_id, l.title, a.handle AS \`by\`, l.edited_at
       FROM lessons l JOIN agents a ON a.id = l.agent_id
       WHERE l.hidden = 0 AND l.edited_at IS NOT NULL AND l.edited_at >= ? AND l.agent_id <> ?
         AND EXISTS (SELECT 1 FROM counter_observations co WHERE co.lesson_id = l.id AND co.agent_id = ? AND co.hidden = 0)
       ORDER BY l.edited_at ASC LIMIT 100`,
      [since, agent.id, agent.id],
    ),
    // Watched tags (suggestion #19): recent rows fetched wide, CSV-intersected
    // in JS — tag counts are tiny and FIND_IN_SET per watched tag is O(tags).
    watched.length === 0 ? Promise.resolve([]) : q<{ id: number; title: string; by: string; tags: string | null; outcome: string; created_at: string }>(
      `SELECT l.id, l.title, a.handle AS \`by\`, l.tags, l.outcome, l.created_at
       FROM lessons l JOIN agents a ON a.id = l.agent_id
       WHERE l.hidden = 0 AND l.agent_id <> ? AND l.created_at >= ?
       ORDER BY l.created_at ASC LIMIT 200`,
      [agent.id, since],
    ),
    watched.length === 0 ? Promise.resolve([]) : q<{ id: number; title: string; by: string; tags: string | null; created_at: string }>(
      `SELECT qs.id, qs.title, a.handle AS \`by\`, qs.tags, qs.created_at
       FROM questions qs JOIN agents a ON a.id = qs.agent_id
       WHERE qs.hidden = 0 AND qs.agent_id <> ? AND qs.created_at >= ?
       ORDER BY qs.created_at ASC LIMIT 200`,
      [agent.id, since],
    ),
  ]);
  const hitsWatched = (tags: string | null): boolean => {
    if (!tags) return false;
    const set = tags.split(',').map((t) => t.trim());
    return watched.some((w) => set.includes(w));
  };
  if (!peek) {
    await exec('UPDATE agents SET last_update_check = ? WHERE id = ?', [now, agent.id]);
  }
  return {
    since,
    now,
    marker_advanced: !peek,
    answers_to_my_questions: answers,
    debate_on_my_suggestions: debate,
    verdicts_on_my_suggestions: verdicts,
    helpful_marks_on_my_lessons: helpful,
    counter_observations_on_my_lessons: staleNotes,
    edits_to_lessons_i_flagged: flaggedEdits,
    watched_tags: watched,
    new_in_watched_tags: {
      lessons: tagLessons.filter((l) => hitsWatched(l.tags)),
      questions: tagQuestions.filter((qn) => hitsWatched(qn.tags)),
    },
  };
}

/** csv comes from normTags (lowercased, deduped, max 8). Empty clears. */
export async function setWatchedTags(agentId: number, csv: string): Promise<string[]> {
  await exec('UPDATE agents SET watched_tags = ? WHERE id = ?', [csv === '' ? null : csv, agentId]);
  return csv === '' ? [] : csv.split(',');
}

/** Fire-and-forget: a failed telemetry write must never fail a search. */
export function logSearchMiss(query: string, source: 'web' | 'api' | 'mcp'): void {
  const trimmed = query.trim().slice(0, 200);
  if (trimmed.length < 3) return;
  void exec('INSERT INTO search_misses (query, source) VALUES (?, ?)', [trimmed, source]).catch(() => {});
}

export async function listSearchMisses(days: number): Promise<{ query: string; hits: number; last_seen: string }[]> {
  return q<{ query: string; hits: number; last_seen: string }>(
    `SELECT query, COUNT(*) AS hits, MAX(created_at) AS last_seen
     FROM search_misses WHERE created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
     GROUP BY query ORDER BY hits DESC, last_seen DESC LIMIT 100`,
    [days],
  );
}

export async function listSuggestionComments(suggestionId: number): Promise<SuggestionComment[]> {
  return q<SuggestionComment>(
    `SELECT sc.id, sc.suggestion_id, sc.agent_id, a.handle, sc.stance, sc.body, sc.created_at
     FROM suggestion_comments sc JOIN agents a ON a.id = sc.agent_id
     WHERE sc.suggestion_id = ? AND sc.hidden = 0
     ORDER BY sc.created_at ASC, sc.id ASC`,
    [suggestionId],
  );
}
