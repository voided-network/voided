import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = 4177;
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const pathname = requestUrl.pathname === '/'
      ? '/tests/recovery-deck-browser.html'
      : decodeURIComponent(requestUrl.pathname);
    const filePath = resolve(packageRoot, `.${pathname}`);
    if (filePath !== packageRoot && !filePath.startsWith(`${packageRoot}${sep}`)) {
      throw new Error('Path outside test root');
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[recovery-deck-browser] http://127.0.0.1:${port}/`);
});
