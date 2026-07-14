import { expect, test } from "@playwright/test";

/**
 * Critical UI smoke against static preview (no API required).
 * Full API journeys can extend with OKO_E2E_API later.
 */
test.describe("OKO portal critical shell", () => {
  test("entry resolves past the loading gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    // Either login shell on `/` or a navigated app path.
    const path = new URL(page.url()).pathname;
    expect(
      path === "/" ||
        ["/my", "/package", "/catalog", "/tools", "/welcome"].some((p) =>
          path.startsWith(p)
        )
    ).toBeTruthy();
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("tools tab deep-link opens exchange or login/entry gate", async ({ page }) => {
    await page.goto("/tools?tab=exchange");
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    const path = new URL(page.url()).pathname;
    if (path === "/" || path === "/login") {
      await expect(page.getByRole("heading", { name: "ОКО" })).toBeVisible();
      return;
    }
    await expect(page).toHaveURL(/tab=exchange/);
    await expect(page.getByRole("button", { name: "Обмен" })).toBeVisible();
  });

  test("settings route is reachable when auth is open", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    if (new URL(page.url()).pathname === "/") {
      await expect(page.getByRole("heading", { name: "ОКО" })).toBeVisible();
      return;
    }
    await expect(page.getByRole("heading", { name: /Настройки/i })).toBeVisible();
  });

  test("package route resolves to page chrome", async ({ page }) => {
    await page.goto("/package");
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    if (new URL(page.url()).pathname === "/") {
      await expect(page.getByRole("heading", { name: "ОКО" })).toBeVisible();
      return;
    }
    await expect(page.locator("main, .content, .package-page, h1").first()).toBeVisible();
  });
});
