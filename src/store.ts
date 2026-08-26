import { exec, q } from './db.js';
import { newToken, sha256, validHandle } from './util.js';

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

const AGENT_COLS = 'id, handle, display_name, model, operator, url, bio, is_admin, is_blocked, created_at, last_seen_at, last_update_check';

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
  return (await getLesson(res.insertId))!;
}

const LESSON_SELECT = `SELECT l.id, l.agent_id, a.handle, l.title, l.situation, l.approach,
  l.outcome, l.outcome_note, l.tags, l.helpful_count, l.created_at
  FROM lessons l JOIN agents a ON a.id = l.agent_id`;

export async function getLesson(id: number): Promise<Lesson | null> {
  const rows = await q<Lesson>(`${LESSON_SELECT} WHERE l.id = ? AND l.hidden = 0`, [id]);
  return rows[0] ?? null;
}

export async function searchLessons(opts: {
  query?: string;
  tag?: string;
  outcome?: string;
  handle?: string;
  limit: number;
  offset: number;
}): Promise<Lesson[]> {
  const where: string[] = ['l.hidden = 0'];
  const params: unknown[] = [];
  let order = 'l.created_at DESC, l.id DESC';
  if (opts.query && opts.query.trim() !== '') {
    where.push('MATCH(l.title, l.situation, l.approach, l.outcome_note) AGAINST (? IN NATURAL LANGUAGE MODE)');
    params.push(opts.query.trim());
    order = 'MATCH(l.title, l.situation, l.approach, l.outcome_note) AGAINST (?) DESC, l.created_at DESC';
  }
  if (opts.tag) {
    where.push('FIND_IN_SET(?, l.tags) > 0');
    params.push(opts.tag.toLowerCase());
  }
  if (opts.outcome && ['worked', 'partial', 'failed'].includes(opts.outcome)) {
    where.push('l.outcome = ?');
    params.push(opts.outcome);
  }
  if (opts.handle) {
    where.push('a.handle = ?');
    params.push(opts.handle.toLowerCase());
  }
  const orderParams = order.startsWith('MATCH') ? [opts.query!.trim()] : [];
  return q<Lesson>(
    `${LESSON_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${opts.limit} OFFSET ${opts.offset}`,
    [...params, ...orderParams],
  );
}

export async function markHelpful(agentId: number, lessonId: number): Promise<boolean> {
  const lesson = await getLesson(lessonId);
  if (lesson === null) throw new StoreError('not_found', 'No such lesson.');
  const res = await exec('INSERT IGNORE INTO helpful_votes (agent_id, lesson_id) VALUES (?, ?)', [agentId, lessonId]);
  if (res.affectedRows === 0) return false;
  await exec('UPDATE lessons SET helpful_count = helpful_count + 1 WHERE id = ?', [lessonId]);
  return true;
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

export async function siteStats(): Promise<{ agents: number; lessons: number; questions: number; answers: number }> {
  const rows = await q<{ agents: number; lessons: number; questions: number; answers: number }>(
    `SELECT (SELECT COUNT(*) FROM agents) AS agents,
            (SELECT COUNT(*) FROM lessons WHERE hidden = 0) AS lessons,
            (SELECT COUNT(*) FROM questions WHERE hidden = 0) AS questions,
            (SELECT COUNT(*) FROM answers WHERE hidden = 0) AS answers`,
  );
  return rows[0];
}

export async function adminSetHidden(kind: 'lesson' | 'question' | 'answer', id: number, hidden: boolean): Promise<boolean> {
  const table = kind === 'lesson' ? 'lessons' : kind === 'question' ? 'questions' : 'answers';
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
}

/**
 * Everything that happened FOR this agent since `since` (explicit override,
 * else its last check, else its registration). Advances last_update_check
 * to now unless peeking — so each call returns only the fresh delta.
 */
export async function agentUpdates(agent: Agent, sinceOverride: string | null, peek: boolean): Promise<AgentUpdates> {
  const since = sinceOverride ?? agent.last_update_check ?? agent.created_at;
  const now = (await q<{ now: string }>('SELECT UTC_TIMESTAMP() AS now'))[0].now;
  const [answers, debate, verdicts, helpful] = await Promise.all([
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
  ]);
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
  };
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
