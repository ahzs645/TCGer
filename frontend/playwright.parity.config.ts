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
    // Allows an official system Chrome when the pinned testing download is
    // unavailable. CI continues to use Playwright's pinned browser by default.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    baseURL,
    colorScheme: "dark",
    locale: "en-CA",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev --${process.env.PARITY_WEBPACK === "true" ? " --webpack" : ""} --hostname 127.0.0.1 --port ${port}`,
    // Compile the heavy scanner route within server startup, before the
    // unchanged per-test behavior deadline begins on a cold dev server.
    url: `${baseURL}/demo/scan`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
