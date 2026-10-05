import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/auth.js', ['auth.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

const server = createServer(async (request, response) => {
  const route = files.get(request.url);
  if (!route || request.method !== 'GET') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': route[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).end(body);
  } catch {
    response.writeHead(500).end('Demo file unavailable');
  }
});

server.listen(4173, '0.0.0.0', () => {
  console.log('Login demo: http://127.0.0.1:4173');
});
