import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function test(width, height, label) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
  await page.goto('http://localhost:5208/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));

  const probe = await page.evaluate(() => {
    const tabs = document.querySelector('.list-tabs');
    const mobileLists = document.querySelector('.mobile-lists');
    return {
      tabsExists: !!tabs,
      tabsDisplay: tabs ? getComputedStyle(tabs).display : null,
      tabsRect: tabs?.getBoundingClientRect()?.toJSON(),
      mobileListsRect: mobileLists?.getBoundingClientRect()?.toJSON(),
      mobileListsDisplay: mobileLists ? getComputedStyle(mobileLists).display : null,
      tabsChildCount: tabs?.children.length,
      tabsInnerHTML: tabs?.innerHTML?.slice(0, 200),
      listPillCount: document.querySelectorAll('.list-tab').length,
    };
  });
  console.log(`[${label} ${width}x${height}]`, JSON.stringify(probe, null, 2));
  await page.screenshot({ path: `/tmp/tabs-${label}.png`, fullPage: false });
  await page.close();
}

await test(440, 760, 'mobile-narrow');

await browser.close();
