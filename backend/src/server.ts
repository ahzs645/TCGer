import { app } from './app';
import { env } from './config/env';

const port = env.PORT ?? 3000;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${port}`);
});
