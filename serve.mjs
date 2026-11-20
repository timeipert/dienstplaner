// Tiny static server for local preview only (127.0.0.1). Not needed to use the app:
// dist/dienstplaner.html also works when opened directly from disk.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const port = Number(process.env.PORT) || 5173;
createServer((req, res) => {
  try {
    const html = readFileSync(new URL('./dist/dienstplaner.html', import.meta.url));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) { res.writeHead(500); res.end('Run "npm run build" first.'); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
