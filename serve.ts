// Local static server for play-testing game/ only.
// Usage: node serve.ts [--port 8080]  then open http://localhost:8080
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./game", import.meta.url)));
const argv = process.argv.slice(2);
const portFlag = argv.indexOf("--port");
const wanted = portFlag === -1 ? 8080 : Number(argv[portFlag + 1]);
const port = Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const mimeFor = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root + sep) && path !== root) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    if (statSync(path).isDirectory()) path = join(path, "index.html");
    const stream = createReadStream(path);
    res.writeHead(200, { "content-type": mimeFor[extname(path)] ?? "application/octet-stream" });
    stream.pipe(res);
    stream.on("error", () => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`Serving game/ at http://localhost:${port} — open it in a desktop browser.`);
});
