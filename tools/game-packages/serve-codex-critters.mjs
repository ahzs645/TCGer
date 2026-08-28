import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.TCGER_FIXTURE_PORT ?? 4173);
const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/scanner-system/examples/codex-critters",
);
const files = new Map([
  ["/codex-critters.game-package.json", "codex-critters.game-package.json"],
  ["/codex-critters.catalog.json", "codex-critters.catalog.json"],
]);

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Codex Critters fixture file not found\n");
    return;
  }
  try {
    const body = await readFile(resolve(fixtureDirectory, file));
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-length": body.byteLength,
      "content-type": "application/json; charset=utf-8",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(`${error instanceof Error ? error.message : "Fixture read failed"}\n`);
  }
});

server.listen(port, host, () => {
  console.log(`Codex Critters manifest: http://${host}:${port}/codex-critters.game-package.json`);
  console.log("Press Ctrl-C to stop.");
});
