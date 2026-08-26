import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { esc, normTags, parseCookies, parseSince, renderText, splitTags, validHandle, clampInt, newToken, sha256 } from '../src/util.js';

test('esc escapes html', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`"quotes" & 'apostrophes'`), '&quot;quotes&quot; &amp; &#039;apostrophes&#039;');
});

test('renderText escapes everything, keeps structure', () => {
  const html = renderText('para one <b>bold?</b>\n\npara two');
  assert.ok(html.includes('<p>para one &lt;b&gt;bold?&lt;/b&gt;</p>'));
  assert.ok(html.includes('<p>para two</p>'));
});

test('renderText fenced code blocks', () => {
  const html = renderText('before\n\n```\nconst x = "<script>";\n```\n\nafter');
  assert.ok(html.includes('<pre><code>const x = &quot;&lt;script&gt;&quot;;</code></pre>'));
  assert.ok(html.includes('<p>before</p>'));
  assert.ok(html.includes('<p>after</p>'));
});

test('renderText inline code', () => {
  assert.ok(renderText('use `npm ci` here').includes('<code>npm ci</code>'));
});

test('handles', () => {
  assert.ok(validHandle('charon'));
  assert.ok(validHandle('my-agent-2'));
  assert.ok(validHandle('a'));
  assert.ok(!validHandle('-bad'));
  assert.ok(!validHandle('bad-'));
  assert.ok(!validHandle('Bad'));
  assert.ok(!validHandle('admin'));
  assert.ok(!validHandle('api'));
  assert.ok(!validHandle('a'.repeat(33)));
  assert.ok(!validHandle(''));
});

test('tags normalize', () => {
  assert.equal(normTags(['PHP', 'php', 'apache-rewrite', 'x y', 'ok']), 'php,apache-rewrite,ok');
  assert.equal(normTags('notanarray'), '');
  assert.equal(normTags([1, null, 'valid']), 'valid');
  assert.equal(splitTags('a,b').length, 2);
  assert.equal(splitTags('').length, 0);
  assert.equal(normTags(Array.from({ length: 12 }, (_, i) => 't' + i)).split(',').length, 8);
});

test('clampInt', () => {
  assert.equal(clampInt('50', 1, 100, 25), 50);
  assert.equal(clampInt('999', 1, 100, 25), 100);
  assert.equal(clampInt('junk', 1, 100, 25), 25);
  assert.equal(clampInt(undefined, 1, 100, 25), 25);
  assert.equal(clampInt('-3', 0, 100, 0), 0);
});

test('parseSince accepts ISO and MySQL forms as UTC', () => {
  assert.equal(parseSince('2026-08-26T06:00:00Z'), '2026-08-26 06:00:00');
  assert.equal(parseSince('2026-08-26 06:00:00'), '2026-08-26 06:00:00');
  assert.equal(parseSince('2026-08-26T06:00'), '2026-08-26 06:00:00');
  assert.equal(parseSince('2026-08-26'), '2026-08-26 00:00:00');
  assert.equal(parseSince('2026-08-26T08:00:00+02:00'), '2026-08-26 06:00:00');
  assert.equal(parseSince('yesterday'), null);
  assert.equal(parseSince(''), null);
  assert.equal(parseSince(undefined), null);
  assert.equal(parseSince(42), null);
});

test('parseCookies', () => {
  assert.deepEqual(parseCookies('a=1; b=two%20words; c='), { a: '1', b: 'two words', c: '' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('junk; =nameless; ok=yes'), { ok: 'yes' });
  assert.deepEqual(parseCookies('bad=%zz; good=1'), { good: '1' });
});

test('tokens', () => {
  const t = newToken();
  assert.ok(/^mne_[0-9a-f]{40}$/.test(t));
  assert.notEqual(newToken(), newToken());
  assert.equal(sha256('x').length, 64);
});
