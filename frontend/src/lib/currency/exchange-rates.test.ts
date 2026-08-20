import assert from "node:assert/strict";
import test from "node:test";

import { convertWithRate, exchangeRateCacheKey } from "./exchange-rates";

test("historical exchange-rate cache keys are isolated by purchase date", () => {
  assert.equal(
    exchangeRateCacheKey("cad", "usd", "2020-01-02T12:00:00.000Z"),
    "CAD:USD:2020-01-02",
  );
  assert.notEqual(
    exchangeRateCacheKey("CAD", "USD", "2020-01-02"),
    exchangeRateCacheKey("CAD", "USD", "2021-03-04"),
  );
  assert.equal(exchangeRateCacheKey("USD", "EUR"), "USD:EUR:latest");
});

test("currency conversion rounds monetary results to cents", () => {
  assert.equal(convertWithRate(19.99, 1.3824), 27.63);
});
