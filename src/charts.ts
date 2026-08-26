/**
 * Server-rendered SVG charts for the observatory. Built to the dataviz
 * method: palette validated for CVD separation on the dark surface (all
 * six checks pass for this order — do not reorder or brighten):
 *   teal #199e8b · gold #a97417 · rose #cc3f66 · violet #9085e9
 * Recessive grid, 2px lines, 8px markers, native <title> tooltips,
 * legend + selective direct labels, and a table view beside each chart.
 */
import { esc } from './util.js';

export const SERIES_COLORS = ['#199e8b', '#a97417', '#cc3f66', '#9085e9'];
const GRID = '#1f2937';
const INK = '#c9d2dc';
const INK_MUTED = '#7d8896';

export interface Series {
  name: string;
  values: number[]; // aligned to days[]
}

// Quarter ticks must land on integers — counts never show "7.5".
function niceMax(n: number): number {
  return Math.max(4, Math.ceil(n / 4) * 4);
}

const W = 720;
const H = 280;
const ML = 40;
const MR = 128; // room for direct labels at line ends
const MT = 14;
const MB = 30;
const PW = W - ML - MR;
const PH = H - MT - MB;

function xPos(i: number, n: number): number {
  return n === 1 ? ML + PW / 2 : ML + (PW * i) / (n - 1);
}

function frame(days: string[], yMax: number): string {
  let g = '';
  for (let t = 0; t <= 4; t++) {
    const y = MT + PH - (PH * t) / 4;
    g += `<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    g += `<text x="${ML - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${INK_MUTED}">${Math.round((yMax * t) / 4)}</text>`;
  }
  const step = Math.max(1, Math.ceil(days.length / 8));
  days.forEach((d, i) => {
    if (i % step !== 0 && i !== days.length - 1) return;
    g += `<text x="${xPos(i, days.length)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${INK_MUTED}">${esc(d.slice(5))}</text>`;
  });
  return g;
}

/** Multi-series cumulative line chart. Series order fixes hue order. */
export function lineChart(days: string[], series: Series[], title: string): string {
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const y = (v: number) => MT + PH - (PH * v) / yMax;
  // End labels collide when series finish at the same value — lay them
  // out top-to-bottom with a 14px minimum gap (markers stay put).
  const endPos = series
    .map((s, si) => ({ si, y: y(s.values[s.values.length - 1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endPos.length; i++) {
    if (endPos[i].y - endPos[i - 1].y < 14) endPos[i].y = endPos[i - 1].y + 14;
  }
  const labelY = new Map(endPos.map((p) => [p.si, p.y]));
  let marks = '';
  series.forEach((s, si) => {
    const color = SERIES_COLORS[si % SERIES_COLORS.length];
    const pts = s.values.map((v, i) => `${xPos(i, days.length)},${y(v)}`).join(' ');
    if (s.values.length > 1) {
      marks += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    s.values.forEach((v, i) => {
      const last = i === s.values.length - 1;
      marks += `<circle cx="${xPos(i, days.length)}" cy="${y(v)}" r="${last ? 4.5 : 3.5}" fill="${color}" stroke="#111823" stroke-width="2"><title>${esc(days[i])} · ${esc(s.name)}: ${v}</title></circle>`;
      if (last) {
        marks += `<text x="${xPos(i, days.length) + 10}" y="${(labelY.get(si) ?? y(v)) + 4}" font-size="12" fill="${INK}">${esc(s.name)} ${v}</text>`;
      }
    });
  });
  const legend = series.map((s, si) => `<span class="legend-item"><span class="legend-swatch" style="background:${SERIES_COLORS[si % SERIES_COLORS.length]}"></span>${esc(s.name)}</span>`).join('');
  return `<figure class="chart">
<figcaption><strong>${esc(title)}</strong><span class="legend">${legend}</span></figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${frame(days, yMax)}${marks}</svg>
${chartTable(days, series)}
</figure>`;
}

/** Single-series daily bars: rounded tops anchored to the baseline. */
export function barChart(days: string[], values: number[], title: string, seriesName: string): string {
  const yMax = niceMax(Math.max(1, ...values));
  const y = (v: number) => MT + PH - (PH * v) / yMax;
  const n = days.length;
  const bw = Math.min(48, Math.max(6, (PW / n) * 0.6));
  const peak = Math.max(...values);
  let marks = '';
  values.forEach((v, i) => {
    const cx = xPos(i, n);
    const x0 = cx - bw / 2;
    const yTop = y(v);
    const r = Math.min(4, bw / 2, Math.max(0, MT + PH - yTop));
    marks += `<path d="M ${x0} ${MT + PH} V ${yTop + r} Q ${x0} ${yTop} ${x0 + r} ${yTop} H ${x0 + bw - r} Q ${x0 + bw} ${yTop} ${x0 + bw} ${yTop + r} V ${MT + PH} Z" fill="${SERIES_COLORS[0]}"><title>${esc(days[i])}: ${v} ${esc(seriesName)}</title></path>`;
    if (v === peak || i === n - 1) {
      marks += `<text x="${cx}" y="${yTop - 6}" text-anchor="middle" font-size="12" fill="${INK}">${v}</text>`;
    }
  });
  return `<figure class="chart">
<figcaption><strong>${esc(title)}</strong></figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${frame(days, yMax)}${marks}</svg>
${chartTable(days, [{ name: seriesName, values }])}
</figure>`;
}

/** The accessible twin: same data as a plain table, folded away. */
function chartTable(days: string[], series: Series[]): string {
  return `<details class="chart-data"><summary>data table</summary><table class="plain">
<thead><tr><th>day</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
<tbody>${days.map((d, i) => `<tr><td>${esc(d)}</td>${series.map((s) => `<td>${s.values[i]}</td>`).join('')}</tr>`).join('')}</tbody>
</table></details>`;
}
