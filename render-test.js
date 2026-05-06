const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const fileUrl = `file://${path.resolve(__dirname, "index.html").replace(/\\/g, "/")}`;

  await page.goto(fileUrl);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(__dirname, "desktop-preview.png"), fullPage: true });

  const desktop = await page.evaluate(() => ({
    title: document.title,
    heroImage: document.querySelector(".hero-media img")?.complete,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    contactVisible: !!document.querySelector("#contato"),
  }));

  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(__dirname, "mobile-preview.png"), fullPage: true });

  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    heroHeight: Math.round(document.querySelector(".hero")?.getBoundingClientRect().height || 0),
    navItems: document.querySelectorAll(".nav a").length,
  }));

  console.log(JSON.stringify({ desktop, mobile }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
