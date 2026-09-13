import type { Page } from '@playwright/test';

export async function clickFileTool(page: Page, selector: string) {
  if (!(await page.locator('#tools-dialog').isVisible())) await page.locator('#tools-open').click();
  await page.locator(selector).click();
  if (await page.locator('#tools-dialog').isVisible()) await page.locator('#tools-close').click();
}

export async function openSection(page: Page, selector: string) {
  if (await page.locator(selector).getAttribute('open') === null) await page.locator(`${selector} > summary`).click();
}
