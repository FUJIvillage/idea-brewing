const http = require("node:http");

let port = 5173;
const idx = process.argv.indexOf("--port");
if (idx !== -1 && process.argv[idx + 1]) port = Number(process.argv[idx + 1]);

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="ja"><body><h1>フェイクタップアプリ</h1></body></html>');
  })
  .listen(port, () => console.log(`fake tap app on http://localhost:${port}`));
