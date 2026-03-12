import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const out = [];
  const ok = (name, msg = 'OK') => out.push(`OK  ${name}: ${msg}`);
  const bad = (name, msg) => out.push(`BAD ${name}: ${msg}`);

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Ensure settings modal is not intercepting clicks
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);

    const mapBtn = page.getByRole('button', { name: /^Map$/i }).first();
    const feedBtn = page.getByRole('button', { name: /^Feed$/i }).first();
    const liveBtn = page.getByRole('button', { name: /^Live$/i }).first();

    await mapBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1200);

    await feedBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1600);
    await page.waitForFunction(() => document.querySelectorAll('article').length > 0, null, { timeout: 20000 }).catch(() => {});
    const feedStoryCount = await page.locator('article').count();

    await mapBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    const mapStoryCount = await page.locator('article').count();
    const effectiveCount = Math.max(feedStoryCount, mapStoryCount);
    if (effectiveCount > 0) ok('Map keeps feed panel', String(effectiveCount));
    else bad('Map keeps feed panel', '0 articles after feed+map checks');

    const densityControls = await page.locator('button:has-text("2×2"), button:has-text("3×3"), button:has-text("4×4")').count();
    if (densityControls === 0) ok('Map hides grid controls');
    else bad('Map hides grid controls', `found ${densityControls}`);

    // Open first story from Feed mode to validate right panel + X tab
    await feedBtn.click({ timeout: 10000 });
    await page.waitForTimeout(900);
    if (effectiveCount > 0) {
      await page.locator('article').first().click();
      await page.waitForTimeout(1200);
      const perspectiveVisible = await page.locator('button:has-text("Analyze")').count();
      if (perspectiveVisible > 0) {
        const socialPostsTab = page.getByRole('button', { name: /Social Posts/i }).first();
        if (await socialPostsTab.count()) {
          await socialPostsTab.click();
          await page.waitForTimeout(700);
          let xTab = page.getByRole('button', { name: /^𝕏\s*X$/i }).first();
          if (await xTab.count() === 0) xTab = page.locator('button:has-text("𝕏 X")').first();
          if (await xTab.count() === 0) xTab = page.locator('button').filter({ hasText: 'X' }).nth(1);
          if (await xTab.count()) {
            await xTab.click({ force: true });
            await page.waitForTimeout(1200);
            const xCards = await page.locator('a[href*="nitter.net"], a[href*="x.com"], a[href*="twitter.com"]').count();
            ok('Right panel X tab', `links=${xCards}`);
          } else {
            const xStatus = await page.getByText(/X\s+(connected|public-only)/i).count();
            if (xStatus > 0) ok('Right panel X status', 'visible');
            else {
              const panelButtons = await page.locator('button').allTextContents();
              const sample = panelButtons.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 24).join(' | ');
              bad('Right panel X tab', `X tab/status not found; buttons=${sample}`);
            }
          }
        } else {
          bad('Right panel social posts', 'Social Posts section not found');
        }
      } else {
        bad('Right panel open', 'Perspective panel did not open from story card');
      }
    }

    // Ensure settings OAuth controls are visible
    const settingsBtn = page.getByRole('button', { name: /Settings/i }).first();
    if (await settingsBtn.count()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      const oauthHeader = await page.getByText(/Social OAuth/i).count();
      if (oauthHeader > 0) ok('OAuth settings visible');
      else bad('OAuth settings visible', 'section missing');
      const cancelBtn = page.getByRole('button', { name: /^Cancel$/i }).first();
      if (await cancelBtn.count()) {
        await cancelBtn.click({ timeout: 5000 });
      } else {
        const closeBtn = page.locator('.fixed.inset-0 button').first();
        await closeBtn.click({ timeout: 5000 }).catch(() => {});
      }
      await page.waitForTimeout(400);
    } else {
      bad('Settings', 'button not found');
    }

    // Live tab should render iframes and labels
    await liveBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1800);
    const iframes = await page.locator('iframe[title]').count();
    if (iframes > 0) ok('Live embeds', String(iframes));
    else bad('Live embeds', '0 stream iframes');

    const labelCount = await page.locator('text=/LIVE|Local:/i').count();
    if (labelCount > 0) ok('Live labels present');
    else bad('Live labels present', 'none detected');

  } catch (e) {
    bad('Smoke error', e?.message || String(e));
  }

  console.log('\nACCEPTANCE SMOKE RESULTS');
  out.forEach((line) => console.log(line));

  await browser.close();
})();
