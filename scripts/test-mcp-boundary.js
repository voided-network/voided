#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'voided-mcp-boundary-'));
const outside = join(tmpdir(), `voided-mcp-outside-${randomUUID()}.txt`);
const serverPath = resolve('website/downloads/voided-mcp.mjs');
let child;
try {
  const noRootEnvironment = { ...process.env };
  delete noRootEnvironment.VOIDED_ROOT;
  const missingRoot = spawnSync(process.execPath, [serverPath], {
    env: noRootEnvironment, encoding: 'utf8', timeout: 3000,
  });
  assert.notEqual(missingRoot.status, 0, 'MCP must not select an implicit checkout');
  assert.match(missingRoot.stderr, /VOIDED_ROOT must be an absolute path/);

  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'README.md'), 'safe public knowledge\n');
  await writeFile(join(root, '.env'), 'PRIVATE_SENTINEL\n');
  await writeFile(outside, 'OUTSIDE_SENTINEL\n');
  await symlink(outside, join(root, 'docs', 'escape.md'));

  child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, VOIDED_ROOT: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const response = JSON.parse(line);
      const pending = responses.get(response.id);
      if (pending) {
        responses.delete(response.id);
        pending.resolve(response);
      }
    } catch {
      // A malformed server response is surfaced by the request timeout.
    }
  });
  let nextId = 1;
  const callTool = (name, args) => new Promise((resolveCall, rejectCall) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      responses.delete(id);
      rejectCall(new Error(`MCP response timed out for ${name}`));
    }, 5000);
    responses.set(id, {
      resolve: response => {
        clearTimeout(timer);
        resolveCall(response.result);
      },
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name, arguments: args },
    }) + '\n');
  });
  const call = path => callTool('voided_read_file', { path });

  const publicRead = await call('README.md');
  assert.equal(publicRead.isError, false, 'public README must remain readable');
  assert.equal(publicRead.structuredContent.excerpt, 'safe public knowledge\n');

  for (const path of ['.env', 'docs/escape.md']) {
    const result = await call(path);
    assert.equal(result.isError, true, `${path} must be denied`);
  }
  const search = await callTool('voided_search_knowledge', {
    query: 'OUTSIDE_SENTINEL', area: 'docs',
  });
  assert.equal(search.isError, false);
  assert.deepEqual(search.structuredContent.matches, []);
  console.log('[mcp-boundary] public source readable; hidden and symlink paths denied');
} finally {
  if (child) child.kill();
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { force: true })]);
}
