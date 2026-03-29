import { createApp } from './app';
import { env } from './config/env';

const port = env.PORT ?? 3000;

async function main() {
  const app = await createApp();

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on port ${port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start backend', error);
  process.exit(1);
});
