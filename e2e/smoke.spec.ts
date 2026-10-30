import { expect, test } from "@playwright/test";

test("swaps the base of the sample bin and downloads the result", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "rsfinity" })).toBeVisible();

  // Exercises the geometry worker (manifold WASM) and the three.js viewer.
  await page.getByRole("button", { name: "Try a sample bin", exact: true }).click();
  await expect(page.getByText("sample-bin-2x1.stl")).toBeVisible();
  await page.getByRole("radio", { name: /Plain/ }).click();
  await expect(page.getByText("One connected, watertight part")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^sample-bin-2x1-.+-base\.3mf$/);
  const size = (await (await download.createReadStream()).toArray()).reduce((n, chunk) => n + chunk.length, 0);
  expect(size).toBeGreaterThan(1000);

  expect(errors, "No uncaught errors, console errors or failed requests").toEqual([]);
});
