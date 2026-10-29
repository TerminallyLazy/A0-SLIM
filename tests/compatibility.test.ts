import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCapabilities } from '../src/extensions/compatibility.js';
import { companionDescriptor } from '../src/extensions/mcp.js';

test('capability assessments distinguish skill wrappers, UI ports, mixed plugins and exact source ownership', () => {
  const db = {
    id: 'db_hub',
    github: 'https://github.com/TerminallyLazy/a0-db-hub',
    commit: '9f3b9926cdd815034b0f9f635c60909107d1f2da',
  };
  const paths = [
    'tools/db_schema.py',
    'tools/db_status.py',
    'extensions/python/system_prompt/a.py',
    'webui/main.html',
  ];
  assert.equal(assessCapabilities(db, paths, false).adapter?.version, '0.1.0');
  assert.equal(assessCapabilities(db, paths, false).status, 'Verified tools');
  assert.deepEqual(
    assessCapabilities(db, paths, false).capabilities.map((c) => c.kind),
    ['tools', 'lifecycle', 'ui'],
  );
  assert.equal(
    assessCapabilities({ ...db, github: 'https://github.com/other/repo' }, paths, false).adapter,
    undefined,
  );
  assert.equal(
    assessCapabilities({ ...db, commit: 'b'.repeat(40) }, paths, false).adapter,
    undefined,
  );
  assert.equal(assessCapabilities(db, paths, true).status, 'Not assessed');
  assert.equal(assessCapabilities(db, paths, true).adapter, undefined);
  assert.equal(assessCapabilities(db, ['webui/themes.css'], false).status, 'Port required');
  assert.equal(assessCapabilities(db, ['hooks.py', 'helpers/upstream.py'], false).skills.length, 0);
  assert.equal(
    assessCapabilities(db, ['skills/review/SKILL.md'], false).status,
    'Skill import available',
  );
});

test('only the bounded companion descriptor is accepted', () => {
  assert.equal(companionDescriptor({ inputSchema: {} }), undefined);
  assert.throws(() =>
    companionDescriptor({ inputSchema: { 'x-a0-slim-companion': { protocol: 'invented' } } }),
  );
  const descriptor = {
    protocol: 'a0-slim-tools/1',
    fingerprint: 'a'.repeat(64),
    scopeId: 'b'.repeat(64),
  };
  assert.deepEqual(
    companionDescriptor({ inputSchema: { 'x-a0-slim-companion': descriptor } }),
    descriptor,
  );
});
