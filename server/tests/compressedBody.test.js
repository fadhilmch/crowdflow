import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

it('installs the patched body-parser on the Express runtime path', () => {
  const fromExpress = createRequire(createRequire(import.meta.url).resolve('express'));
  const [major, minor] = fromExpress('body-parser/package.json').version.split('.').map(Number);
  expect(major > 2 || (major === 2 && minor >= 4)).toBe(true);
});

it('keeps serving after a compressed JSON frame with trailing bytes', async () => {
  // Isolate the HTTP parser: an uncaught decoder error must fail this child, not the test runner.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import express from 'express';
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.post('/', (req, res) => res.json(req.body));
    app.use((err, req, res, next) => res.status(400).end());
    const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
  `], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const [port] = await once(child, 'message');
    const send = payload => new Promise(resolve => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: {
        'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': payload.length,
      } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', () => resolve(0));
      req.end(payload);
    });
    await send(Buffer.concat([gzipSync('{"safe":true}'), Buffer.from('trailing bytes')]));
    // Let any delayed decoder error fire before checking liveness and a normal compressed request.
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(child.exitCode, stderr).toBeNull();
    expect(await send(gzipSync('{"safe":true}'))).toBe(200);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
});
