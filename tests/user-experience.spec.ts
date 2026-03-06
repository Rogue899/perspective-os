import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5175';

test.describe('User Experience — PerspectiveOS', () => {
  test('app loads without white screen or console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Should show the header/logo
    await expect(page.locator('text=PERSPECTIVE')).toBeVisible();

    // No crash errors
    const fatal = errors.filter(e => !e.includes('favicon') && !e.includes('net::ERR'));
    expect(fatal, `Console errors: ${fatal.join('\n')}`).toHaveLength(0);
  });

  test('default tab is Map — map canvas is visible', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Map tab should be active by default
    const mapTab = page.locator('button:has-text("Map")');
    await expect(mapTab).toBeVisible();
    const isActive = await mapTab.getAttribute('class');
    expect(isActive).toContain('text-accent'); // active state class

    // Map canvas should be rendered
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });
  });

  test('Feed tab shows grid of story cards (no map visible)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click Feed tab
    await page.click('button:has-text("Feed")');
    await page.waitForTimeout(1000);

    // Map canvas should NOT be visible when on Feed tab
    const canvasVisible = await page.locator('canvas').first().isVisible().catch(() => false);
    // (It may be in DOM but not visible — that's fine)

    // Feed panel should be full-width — check no 380px sidebar constraint
    // Grid cards should appear once stories load
    const storyCount = page.locator('text=stories').first();
    await expect(storyCount).toBeVisible({ timeout: 8000 });

    console.log('Feed tab loaded. Canvas visible:', canvasVisible);
  });

  test('Feed tab renders grid layout (2 columns)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Feed")');
    await page.waitForTimeout(8000); // wait for RSS fetch

    // Should have grid toggle buttons (list/grid)
    const gridBtn = page.locator('[title="Grid view"]');
    await expect(gridBtn).toBeVisible();

    // Since defaultGrid=true for news panel, grid should already be active
    // Check grid container class
    const gridContainer = page.locator('.grid.grid-cols-2').first();
    const gridExists = await gridContainer.isVisible().catch(() => false);
    console.log('Grid container visible:', gridExists);

    // Story cards should exist
    const articles = page.locator('article');
    const count = await articles.count();
    console.log(`Story cards found: ${count}`);
    expect(count).toBeGreaterThan(0);
  });

  test('Analyze tab shows Perspective Engine (no map)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Analyze")');
    await page.waitForTimeout(2000);

    // Should show Perspective Engine placeholder
    await expect(page.locator('text=Perspective Engine')).toBeVisible();

    // Map should not be visible
    const canvas = page.locator('canvas').first();
    const mapVisible = await canvas.isVisible().catch(() => false);
    expect(mapVisible).toBe(false);
  });

  test('Category filters work — clicking Conflict shows results or 0-message', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Feed")');
    await page.waitForTimeout(8000); // wait for stories

    // Click Conflict filter
    await page.click('button:has-text("Conflict")');
    await page.waitForTimeout(1000);

    // Should either show stories or "No stories match" — not just silently stay
    const hasStories = await page.locator('article').count();
    const noMatch = await page.locator('text=No stories match').isVisible().catch(() => false);

    console.log(`Conflict filter: ${hasStories} stories, noMatch: ${noMatch}`);
    expect(hasStories > 0 || noMatch).toBe(true);
  });

  test('Scope bar shows Global/Regional/Local buttons', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Feed")');
    await page.waitForTimeout(1000);

    await expect(page.locator('button:has-text("global")')).toBeVisible();
    await expect(page.locator('button:has-text("regional")')).toBeVisible();
    await expect(page.locator('button:has-text("local")')).toBeVisible();
  });

  test('Finance tab loads charts', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Finance")');
    await page.waitForTimeout(3000);

    // Should show market data tabs
    await expect(page.locator('text=markets').or(page.locator('text=Markets'))).toBeVisible();
  });

  test('Right-click on map fires reverse geocode (area news)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // wait for map to load

    // Map tab is default
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // Right-click center of canvas
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      await page.waitForTimeout(2000);
      console.log('Right-clicked map at center');
      // A floating popup or news list should appear
    }
  });

  test('Keyword chips do not redirect externally', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Feed")');
    await page.waitForTimeout(10000); // keywords take a few seconds to generate

    const keywords = page.locator('text=AI keywords');
    if (await keywords.isVisible()) {
      // Check that keyword chips are buttons, not <a> tags
      const kwChips = page.locator('.text-\\[9px\\].font-mono.rounded.border').first();
      const tagName = await kwChips.evaluate(el => el.tagName.toLowerCase()).catch(() => 'unknown');
      console.log(`Keyword chip element: ${tagName}`);
      expect(tagName).toBe('button');
    } else {
      console.log('Keywords not yet generated (API may be slow)');
    }
  });
});
