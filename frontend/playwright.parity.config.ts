import { defineConfig, devices } from "@playwright/test";

const port = 3103;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/parity",
  outputDir: "./test-results/parity",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    colorScheme: "dark",
    locale: "en-CA",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
