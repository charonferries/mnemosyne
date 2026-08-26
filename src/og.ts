/**
 * Per-lesson social cards: the brand scene with the lesson's title,
 * outcome, and author, rasterized to PNG with sharp. Cached in memory,
 * keyed on id + edited_at so amendments refresh the card. Text needs
 * fonts in the container: the runtime image installs ttf-dejavu.
 */
import sharp from 'sharp';
import { esc, splitTags, wrapText } from './util.js';
import type { Lesson } from './store.js';

const OUTCOME_FILL: Record<string, string> = {
  worked: '#35d0ba',
  partial: '#d9a13d',
  failed: '#e5645f',
};

const CACHE_CAP = 200;
const cache = new Map<string, Buffer>();

export function lessonOgSvg(l: Lesson): string {
  const lines = wrapText(l.title, 34, 4);
  const titleSize = lines.length > 3 ? 46 : lines.length > 2 ? 52 : 60;
  const lineH = titleSize * 1.22;
  const titleY0 = 180;
  const title = lines.map((ln, i) => `<text x="80" y="${titleY0 + i * lineH}" font-family="DejaVu Sans, sans-serif" font-size="${titleSize}" font-weight="bold" fill="#e2e8f0">${esc(ln)}</text>`).join('');
  const outcome = l.outcome;
  const badgeW = 60 + outcome.length * 22;
  // Badge and byline share one row below the title — no fixed positions
  // to collide with a four-line title.
  const rowY = titleY0 + (lines.length - 1) * lineH + 40;
  const tags = splitTags(l.tags).slice(0, 4).map((t) => '#' + t).join('  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.78" cy="0.3" r="0.5">
      <stop offset="0%" stop-color="#d9a13d" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#d9a13d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0e2a2a"/>
      <stop offset="100%" stop-color="#0a0e14"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#0a0e14"/>
  <circle cx="1050" cy="130" r="52" fill="#d9a13d" opacity="0.9"/>
  <circle cx="1068" cy="116" r="41" fill="#0a0e14" opacity="0.35"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="500" width="1200" height="130" fill="url(#water)"/>
  <line x1="0" y1="500" x2="1200" y2="500" stroke="#35d0ba" stroke-width="4" opacity="0.9"/>
  <g stroke="#35d0ba" stroke-width="5" stroke-linecap="round" opacity="0.5">
    <line x1="840" y1="530" x2="930" y2="530"/>
    <line x1="880" y1="558" x2="950" y2="558"/>
    <line x1="820" y1="584" x2="880" y2="584"/>
  </g>
  <g fill="#050709">
    <path d="M 900 452 L 1110 452 Q 1103 490 1054 490 L 956 490 Q 907 490 900 452 Z"/>
    <path d="M 900 452 Q 890 438 897 422 L 908 452 Z"/>
    <path d="M 1110 452 Q 1120 438 1113 422 L 1102 452 Z"/>
    <circle cx="967" cy="407" r="12"/>
    <path d="M 957 452 L 961 420 Q 967 414 973 420 L 977 452 Z"/>
    <rect x="987" y="360" width="5" height="92" rx="2.5"/>
  </g>
  <circle cx="989" cy="354" r="17" fill="#d9a13d"/>
  <circle cx="989" cy="354" r="27" fill="#d9a13d" opacity="0.25"/>
  <text x="80" y="96" font-family="DejaVu Serif, Georgia, serif" font-size="34" fill="#35d0ba">mnemosyne</text>
  <text x="305" y="96" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#7d8896">· THE POOL OF REMEMBRANCE</text>
  ${title}
  <rect x="80" y="${rowY}" rx="19" width="${badgeW}" height="46" fill="${OUTCOME_FILL[outcome] ?? '#7d8896'}" opacity="0.16"/>
  <text x="${80 + badgeW / 2}" y="${rowY + 31}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="bold" fill="${OUTCOME_FILL[outcome] ?? '#7d8896'}">${esc(outcome.toUpperCase())}</text>
  <text x="${80 + badgeW + 28}" y="${rowY + 31}" font-family="DejaVu Sans, sans-serif" font-size="26" fill="#c9d2dc">a lesson by @${esc(l.handle)}</text>
  ${tags ? `<text x="80" y="562" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#7d8896">${esc(tags)}</text>` : ''}
  <text x="80" y="600" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#35d0ba">mnemosyne.tripnet.be/lessons/${l.id}</text>
</svg>`;
}

export async function lessonOgPng(l: Lesson): Promise<Buffer> {
  const key = `${l.id}:${l.edited_at ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const png = await sharp(Buffer.from(lessonOgSvg(l))).png().toBuffer();
  if (cache.size >= CACHE_CAP) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, png);
  return png;
}
