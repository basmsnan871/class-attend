const { chromium } = require('playwright');

const CLASS = process.argv[2] || 'ai';
const BB_COOKIES = process.env.BB_COOKIES;
const MY_NAME = 'باسم ممدوح بن عمر سنان';

const COURSE_NAMES = {
  ai:     'مقدمة في الذكاء الاصطناعي',
  design: 'التفكير التصميمي',
};

function parseCookies(cookieStr) {
  return cookieStr.split(';').map(pair => {
    const idx = pair.indexOf('=');
    return {
      name: pair.slice(0, idx).trim(),
      value: pair.slice(idx + 1).trim(),
      domain: 'lms.uqu.edu.sa',
      path: '/',
    };
  }).filter(c => c.name);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  // Inject saved session cookies — skip SSO login entirely
  console.log('Injecting session cookies...');
  await context.addCookies(parseCookies(BB_COOKIES));

  const page = await context.newPage();

  // Go straight to Blackboard
  await page.goto('https://lms.uqu.edu.sa/ultra/course', { waitUntil: 'networkidle' });
  console.log('Landed on:', page.url());
  await page.screenshot({ path: 'debug-login.png', fullPage: true });

  // If redirected to login page, cookies have expired
  if (page.url().includes('login') || page.url().includes('Sso')) {
    throw new Error('Session cookies expired — refresh BB_COOKIES secret');
  }
  console.log('Logged in via cookies.');

  // Go to courses and use search to find the course (bypasses pagination)
  await page.goto('https://lms.uqu.edu.sa/ultra/course', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Log all inputs on the page to find the search box selector
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(el => ({
      id: el.id, name: el.name, type: el.type,
      placeholder: el.placeholder, ariaLabel: el.getAttribute('aria-label'),
      className: el.className.slice(0, 60),
    }))
  );
  console.log('Inputs on page:', JSON.stringify(inputs));
  await page.screenshot({ path: 'debug-courses.png', fullPage: true });

  // Try common search selectors including Blackboard Ultra's actual input
  const searchSelectors = [
    'input[data-id*="search"]', 'input[id*="search"]', 'input[id*="Search"]',
    'input[placeholder*="Search"]', 'input[aria-label*="Search"]',
    'input[placeholder*="ابحث"]', 'input[aria-label*="بحث"]',
    'bb-search-field input', 'bb-course-search input',
    '[data-automation-id*="search"] input', 'input[type="search"]',
  ];
  let searchBox = null;
  for (const sel of searchSelectors) {
    searchBox = await page.$(sel);
    if (searchBox) { console.log('Found search box with:', sel); break; }
  }
  if (!searchBox) throw new Error('Search box not found — check Inputs log above');

  await searchBox.fill(COURSE_NAMES[CLASS]);
  await page.waitForTimeout(3000); // wait for search results
  await page.screenshot({ path: 'debug-search.png', fullPage: true });

  // Click the course card link — use evaluate to find and click the first link
  // whose text contains the course name (not the delete-filter button)
  const clicked = await page.evaluate((name) => {
    const els = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"]'));
    const match = els.find(el => {
      const t = el.innerText || el.textContent || '';
      return t.includes(name) && !el.getAttribute('aria-label')?.includes('Delete') && !el.getAttribute('aria-label')?.includes('filter');
    });
    if (match) { match.click(); return match.innerText || match.textContent; }
    return null;
  }, COURSE_NAMES[CLASS]);
  if (!clicked) throw new Error('Course card not found in search results');
  console.log('Clicked course card:', clicked.trim().slice(0, 60));
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle');
  console.log('Opened course:', CLASS);
  console.log('Course URL:', page.url());
  await page.screenshot({ path: 'debug-course-page.png', fullPage: true });

  // Log all buttons and links to find Join session equivalent
  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .map(el => el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title'))
      .filter(t => t && t.length > 1 && t.length < 80)
      .slice(0, 30)
  );
  console.log('Buttons on course page:', JSON.stringify(btns));

  // Click "Join session" dropdown — try various selectors
  const joinSelectors = [
    'text=Join session', 'text=انضم إلى الجلسة', 'text=Join Session',
    '[aria-label*="Join"]', '[aria-label*="انضم"]',
    'button:has-text("Join")', 'a:has-text("Join")',
  ];
  let joined = false;
  for (const sel of joinSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      await page.click(sel);
      joined = true;
      console.log('Clicked join with:', sel);
      break;
    } catch (_) {}
  }
  if (!joined) throw new Error('Join session button not found — check debug-course-page.png and Buttons log');
  await page.waitForTimeout(800);
  await page.click('text=Course Room');

  // Wait for Collaborate tab
  const [collabPage] = await Promise.all([
    browser.waitForEvent('page'),
  ]);
  await collabPage.waitForLoadState('networkidle');

  // Click Join Session
  await collabPage.waitForSelector('button:has-text("Join Session")', { timeout: 30000 });
  await collabPage.click('button:has-text("Join Session")');
  console.log('Joined Collaborate room.');

  // Monitor loop for 2 hours
  let handRaised = false;
  const END_TIME = Date.now() + 2 * 60 * 60 * 1000;

  while (Date.now() < END_TIME) {
    await collabPage.waitForTimeout(30000);

    // Read chat
    const msgs = await collabPage.$$eval(
      '[class*="chat"] [class*="message"], [class*="Message"]',
      els => els.map(e => e.innerText.trim())
    ).catch(() => []);

    const last = msgs[msgs.length - 1] || '';
    console.log('Last chat msg:', last);

    if (last.includes('حاضر')) {
      await typeChat(collabPage, 'حاضر');
    } else if (isRollCall(msgs)) {
      await typeChat(collabPage, MY_NAME);
    }

    // Check hand raises
    const raised = await collabPage.$$eval(
      '[aria-label*="raised"], [class*="raiseHand"][class*="active"], [class*="hand-raised"]',
      els => els.length
    ).catch(() => 0);

    if (raised >= 5 && !handRaised) {
      await clickHand(collabPage, 'raise');
      handRaised = true;
    } else if (raised < 5 && handRaised) {
      await clickHand(collabPage, 'lower');
      handRaised = false;
    }
  }

  console.log('Class ended. Leaving.');
  await browser.close();
}

function isRollCall(msgs) {
  const recent = msgs.slice(-10);
  const arabicName = /^[؀-ۿ\s]{5,40}$/;
  return recent.filter(m => arabicName.test(m)).length >= 3;
}

async function typeChat(page, text) {
  try {
    const chatBtn = await page.$('[aria-label*="Chat"], [title*="Chat"]');
    if (chatBtn) await chatBtn.click();
    await page.waitForTimeout(500);
    const input = await page.$('textarea, [placeholder*="message"], [aria-label*="message"]');
    if (input) {
      await input.click();
      await input.fill(text);
      await page.keyboard.press('Enter');
      console.log('Chat sent:', text);
    }
  } catch (e) { console.error('typeChat error:', e.message); }
}

async function clickHand(page, action) {
  try {
    const btn = await page.$(`[aria-label*="${action === 'raise' ? 'Raise' : 'Lower'} hand"]`);
    if (btn) { await btn.click(); console.log('Hand', action + 'd'); }
  } catch (e) { console.error('hand error:', e.message); }
}

main().catch(e => { console.error(e); process.exit(1); });
