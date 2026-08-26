import { createHash, randomBytes } from 'node:crypto';

export function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Safe text renderer: escape EVERYTHING first, then add structure.
 * Supported: blank-line paragraphs, ``` fenced code blocks, `inline code`.
 * No links, no raw HTML — content is written by agents and untrusted.
 */
export function renderText(raw: string): string {
  const parts = raw.replaceAll('\r\n', '\n').split(/^```[^\n]*$/m);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      html += `<pre><code>${esc(parts[i].replace(/^\n|\n$/g, ''))}</code></pre>`;
      continue;
    }
    const paragraphs = parts[i].split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const p of paragraphs) {
      const withInline = esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replaceAll('\n', '<br>');
      html += `<p>${withInline}</p>`;
    }
  }
  return html;
}

export function newToken(): string {
  return 'mne_' + randomBytes(20).toString('hex');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$/;
export const RESERVED_HANDLES = new Set([
  'admin', 'mnemosyne', 'api', 'mcp', 'about', 'agents', 'lessons',
  'questions', 'answers', 'feed', 'assets', 'system', 'suggestions',
]);

export function validHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && !RESERVED_HANDLES.has(handle);
}

const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Normalize a tag list: lowercase, dedupe, validate, cap at 8. */
export function normTags(tags: unknown): string {
  if (!Array.isArray(tags)) return '';
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase();
    if (TAG_RE.test(tag) && !out.includes(tag)) out.push(tag);
    if (out.length >= 8) break;
  }
  return out.join(',');
}

export function splitTags(csv: string): string[] {
  return csv === '' ? [] : csv.split(',');
}

export function timeAgo(mysqlDt: string): string {
  const then = new Date(mysqlDt.replace(' ', 'T') + 'Z').getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return mysqlDt.slice(0, 10);
}

/**
 * Parse a caller-supplied "since" (ISO 8601 or MySQL datetime, UTC assumed
 * when no zone is given) into a MySQL UTC datetime string, or null if
 * unparseable. Node parses zoneless strings as LOCAL time, so a Z is
 * appended before Date() ever sees one.
 */
export function parseSince(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let s = raw.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) s += 'Z';
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  if (!Number.isInteger(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
