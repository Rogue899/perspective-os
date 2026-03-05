import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    geolocation: { latitude: 33.8938, longitude: 35.5018 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();

  const out = [];
  const ok = (name, msg = 'OK') => out.push(`✅ ${name}: ${msg}`);
  const fail = (name, msg) => out.push(`❌ ${name}: ${msg}`);

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 45000 });
    ok('App load');

    await page.waitForTimeout(3000);

    const storyCount = await page.locator('article').count();
    if (storyCount > 0) ok('Feed back', `${storyCount} story cards`);
    else fail('Feed back', 'No story cards found');

    const mapButton = page.getByRole('button', { name: /Map/i });
    if (await mapButton.count()) {
      await mapButton.first().click();
      await page.waitForTimeout(1200);
      ok('Tab switch map');
    } else {
      fail('Tab switch map', 'Map button not found');
    }

    const feedButton = page.getByRole('button', { name: /Feed/i });
    if (await feedButton.count()) {
      await feedButton.first().click();
      await page.waitForTimeout(800);
      ok('Tab switch feed');
    } else {
      fail('Tab switch feed', 'Feed button not found');
    }

    const conflictFilter = page.getByRole('button', { name: /^Conflict$/i });
    if (await conflictFilter.count()) {
      await conflictFilter.first().click();
      await page.waitForTimeout(1000);
      ok('Filter click', 'Conflict filter clicked');
    } else {
      fail('Filter click', 'Conflict filter not found');
    }

    const anyStoriesAfterFilter = await page.locator('article').count();
    ok('Filter result', `${anyStoriesAfterFilter} cards after filter`);

    const allFilter = page.getByRole('button', { name: /^All$/i });
    if (await allFilter.count()) {
      await allFilter.first().click();
      await page.waitForTimeout(800);
    }

    if ((await page.locator('article').count()) > 0) {
      await page.locator('article').first().click();
      await page.waitForTimeout(1200);

      if (await page.getByText('Perspective Engine', { exact: false }).count()) {
        ok('Perspective open');
      } else {
        fail('Perspective open', 'Panel not visible after story click');
      }

      const analyzeBtn = page.getByRole('button', { name: /Analyze/i });
      if (await analyzeBtn.count()) {
        await analyzeBtn.first().click();
        await page.waitForTimeout(3500);
        ok('AI analysis trigger', 'Analyze button clicked');
      } else {
        ok('AI analysis trigger', 'Already analyzed / button not shown');
      }
    } else {
      fail('Perspective open', 'No stories to click');
    }

    const closePerspective = page.locator('button').filter({ has: page.locator('svg') }).first();
    if (await closePerspective.count()) {
      await closePerspective.click().catch(() => {});
    }

    if (await mapButton.count()) {
      await mapButton.first().click();
      await page.waitForTimeout(1800);

      const geoBtn = page.locator('button[title*="Locate"], button[title*="location"], button[title*="Re-center"]');
      if (await geoBtn.count()) {
        await geoBtn.first().click();
        await page.waitForTimeout(2200);
        ok('Geolocation button');
      } else {
        fail('Geolocation button', 'Locate button not found');
      }

      const markers = page.locator('.cluster-marker');
      const markerCount = await markers.count();
      if (markerCount > 0) {
        await markers.first().click({ force: true });
        await page.waitForTimeout(1200);
        if (await page.getByText(/Brief/i).count()) ok('City bubble', 'Floating brief opened');
        else fail('City bubble', 'No floating brief after marker click');

        const videoTab = page.getByRole('button', { name: /^Video$/i });
        if (await videoTab.count()) {
          await videoTab.first().click();
          await page.waitForTimeout(500);
          const yt = page.locator('a[href*="youtube.com/results"]');
          const rumble = page.locator('a[href*="rumble.com/search"]');
          if ((await yt.count()) && (await rumble.count())) ok('YouTube/Rumble links');
          else fail('YouTube/Rumble links', 'One or both links missing');
        } else {
          fail('Video tab', 'Video tab not found in floating brief');
        }
      } else {
        fail('City bubble', 'No map markers found');
      }
    }

  } catch (e) {
    fail('Smoke run', e.message || String(e));
  }

  console.log('\nPLAYWRIGHT SMOKE RESULTS');
  out.forEach(v => console.log(v));

  await browser.close();
})();
