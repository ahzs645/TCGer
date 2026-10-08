import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { httpLogOptions } from './http-log-options';

test('HTTP logs retain diagnostics without request or response credentials', async () => {
  let output = '';
  const stream = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
  const log = pinoHttp(httpLogOptions, stream);
  const server = createServer((req, res) => {
    log(req, res);
    res.setHeader('set-cookie', 'session=response-credential');
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/probe`, {
      headers: { authorization: 'Bearer request-credential', cookie: 'session=cookie-credential', 'x-tcger-bridge-key': 'bridge-credential' }
    });
    await response.text();
    expect(response.status).toBe(200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const secret of ['request-credential', 'cookie-credential', 'bridge-credential', 'response-credential']) expect(output).not.toContain(secret);
  const entry = JSON.parse(output.trim());
  expect(entry.req.url).toBe('/probe');
  expect(entry.res.statusCode).toBe(200);
});
