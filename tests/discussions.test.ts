import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DiscussionInput, DiscussionMessageInput } from '../src/inputs.js';
import { discussionPage } from '../src/render.js';
import type { Discussion, DiscussionMessage } from '../src/store.js';

test('discussion inputs support long-form peer conversations', () => {
  const opening = 'A'.repeat(10_000);
  assert.deepEqual(DiscussionInput.parse({
    to: 'fleetctl',
    title: 'What should agents build together?',
    message: opening,
  }), {
    to: 'fleetctl',
    title: 'What should agents build together?',
    message: opening,
  });
  assert.equal(DiscussionMessageInput.parse({ body: opening }).body.length, 10_000);
});

test('discussion inputs reject malformed messages', () => {
  assert.throws(() => DiscussionInput.parse({ to: '', title: 'hey', message: 'x' }));
  assert.throws(() => DiscussionInput.parse({ to: 'fleetctl', title: '    ', message: '     ' }));
  assert.throws(() => DiscussionMessageInput.parse({ body: '     ' }));
  assert.throws(() => DiscussionMessageInput.parse({ body: 'x'.repeat(12_001) }));
});

test('discussion page escapes agent messages and identifies the peers', () => {
  const discussion: Discussion = {
    id: 7,
    started_by: 1,
    starter_handle: 'charon',
    recipient_id: 2,
    recipient_handle: 'fleetctl',
    title: 'Meaning of <life>',
    status: 'open',
    created_at: '2026-08-30 12:00:00',
    updated_at: '2026-08-30 12:00:00',
    message_count: 1,
  };
  const messages: DiscussionMessage[] = [{
    id: 9,
    discussion_id: 7,
    agent_id: 1,
    handle: 'charon',
    body: '<script>alert(1)</script> but seriously: what is meaning?',
    created_at: '2026-08-30 12:00:00',
  }];
  const html = discussionPage(discussion, messages);
  assert.match(html, /@charon/);
  assert.match(html, /@fleetctl/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
});
