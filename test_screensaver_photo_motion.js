// Run with playwright-core and a Chromium browser (BROWSER_PATH).
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");
const cardDir = path.join(__dirname, "custom_components/family_hub/card");

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://hub.test/", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    const requests = [];
    await page.route("http://hub.test/photo*", route => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="40" height="60" fill="green"/></svg>' });
    });
    await page.goto("http://hub.test/");
    await page.addScriptTag({ path: path.join(cardDir, "screensaver-photo-motion.js") });
    await page.addScriptTag({ path: path.join(cardDir, "family-screensaver-card.js") });
    await page.evaluate(() => {
      const card = document.createElement("family-hub-screensaver-card");
      card.setConfig({ type: "custom:family-hub-screensaver-card" });
      const attrs = { entry_id: "abc", frame_id: 1, displayed_photo_ids: ["a"], slide_interval: 10, entity_picture: "/photo", pause_when_unwatched: true };
      const settings = { sourceType: "camera", cameraEntity: "camera.photos", usersEnabled: { me: true } };
      window.fixture = { card, attrs, settings, beats: 0 };
      card._hass = { user: { id: "me" }, states: { "camera.photos": { attributes: attrs } }, callWS: async () => { fixture.beats++; } };
      card._getSettings = () => ({ screenSaver: settings, screenSaverWidgets: [] });
      card._showScreenSaver();
    });
    const img = page.locator(".screensaver-camera-image");
    await page.waitForFunction(() => document.querySelector(".screensaver-camera-image")?.getAnimations().length);
    const transform = () => img.evaluate(el => getComputedStyle(el).transform);
    const initial = await transform();
    await page.waitForTimeout(250);
    assert.notEqual(await transform(), initial);
    await page.evaluate(() => { fixture.attrs.frame_id++; fixture.card._updateScreenSaverCameraImage(); });
    assert.equal(requests.length, 1);
    assert.equal(await page.evaluate(() => fixture.beats), 1);
    await page.evaluate(() => { fixture.attrs.paused = true; fixture.card._updateScreenSaverCameraImage(); });
    assert.equal(await img.evaluate(el => el.getAnimations()[0].playState), "paused");
    await page.evaluate(() => {
      fixture.attrs.paused = false;
      fixture.attrs.displayed_photo_ids = ["b"];
      fixture.card._updateScreenSaverCameraImage();
    });
    await page.waitForFunction(() => document.querySelector(".screensaver-camera-image").getAnimations().length === 2);
    await page.waitForFunction(() => document.querySelectorAll("[data-family-hub-screensaver] img").length === 1);
    await page.evaluate(() => fixture.card._hideScreenSaver());
    assert.equal(await img.evaluate(el => el.getAnimations().length), 0);
    assert.equal(requests.length, 2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => fixture.card._showScreenSaver());
    await page.waitForFunction(() => document.querySelector(".screensaver-camera-image").getAnimations()[0]?.playState === "paused");
    await page.evaluate(() => { fixture.card._hideScreenSaver(); fixture.settings.kenBurns = false; fixture.card._showScreenSaver(); });
    assert.equal(await img.evaluate(el => el.getAnimations().length), 0);
    console.log("Passed live browser screensaver motion, pause, deduplication, crossfade, wake, reduced motion and opt-out");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
