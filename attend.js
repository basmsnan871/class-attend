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
  await page.screenshot({ path: 'debug-courses.png', fullPage: true });

  // Wait for search box and type course name
  const searchBox = await page.waitForSelector('input[placeholder*="Search"], input[aria-label*="Search"], input[placeholder*="ابحث"], input[aria-label*="بحث"]', { timeout: 30000 });
  await searchBox.fill(COURSE_NAMES[CLASS]);
  await page.waitForTimeout(2000); // wait for search results
  await page.screenshot({ path: 'debug-search.png', fullPage: true });

  // Click first result containing the course name
  await page.waitForSelector(`text=${COURSE_NAMES[CLASS]}`, { timeout: 30000 });
  await page.click(`text=${COURSE_NAMES[CLASS]}`);
  await page.waitForLoadState('networkidle');
  console.log('Opened course:', CLASS);

  // Click "Join session" dropdown
  await page.click('text=Join session');
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
