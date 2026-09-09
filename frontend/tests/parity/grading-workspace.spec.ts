import { expect, test } from "@playwright/test";

test("[pricing.gradingWorkspace] manual economics, views, missing data, and saved scenario", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  await page.goto("/demo/prices");
  await page.getByRole("link", { name: "Grading planner", exact: true }).click();
  await expect(
    page.getByTestId("feature.pricing.gradingWorkspace"),
  ).toBeVisible();
  await page.getByLabel("Raw value (USD)", { exact: true }).fill("50");
  await page.getByLabel("PSA 10 value", { exact: true }).fill("100");
  await expect(page.getByTestId("grading.verdict")).toContainText(
    "More data needed",
  );
  await page.getByLabel("PSA 10 weight", { exact: true }).fill("1");
  await expect(page.getByTestId("grading.verdict")).toContainText(
    "Worth grading",
  );
  await page.getByRole("tab", { name: "Costs", exact: true }).click();
  await page.getByLabel("Grading fee", { exact: true }).fill("90");
  await page
    .getByLabel("Service tier / quote reference")
    .fill("My submitted quote");
  await page.getByRole("tab", { name: "Decision", exact: true }).click();
  await expect(page.getByTestId("grading.verdict")).toContainText(
    "Keep it raw",
  );
  await page
    .getByRole("button", { name: "Save scenario on this device" })
    .click();
  await page.reload();
  await expect(page.getByLabel("Raw value (USD)", { exact: true })).toHaveValue(
    "50",
  );
  await expect(page.getByTestId("grading.verdict")).toContainText(
    "Keep it raw",
  );
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(page.getByText("Low data:", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByText("No graded history available.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Decision", exact: true }).click();
  await page.getByLabel("PSA 9 weight", { exact: true }).fill("1");
  await expect(page.getByTestId("grading.verdict")).toContainText(
    "More data needed",
  );
  await page
    .getByRole("combobox", { name: "Grader", exact: true })
    .selectOption("BGS");
  await expect(page.getByLabel("BGS 9.5 value", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Grader", exact: true })
    .selectOption("PSA");
  await expect(page.getByLabel("PSA 10 value", { exact: true })).toHaveValue(
    "100",
  );
  await page
    .getByLabel("Card / scenario", { exact: true })
    .fill("My Charizard copy");
  await page.getByRole("tab", { name: "Costs", exact: true }).click();
  await page
    .getByRole("button", { name: "Record these submission costs as paid" })
    .click();
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  await expect(
    page.getByText("My Charizard copy · PSA", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  await expect(
    page.getByText("My Charizard copy · PSA", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete receipt", exact: true })
    .click();
  await expect(page.getByText("No recorded grading expenses.")).toBeVisible();
});
