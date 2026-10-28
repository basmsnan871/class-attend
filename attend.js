const { chromium } = require('playwright');

const CLASS = process.argv[2] || 'ai';
const BB_USER = process.env.BB_USER;
const BB_PASS = process.env.BB_PASS;
const MY_NAME = 'باسم ممدوح بن عمر سنان';

const COURSE_SELECTORS = {
  ai:     'text=مقدمة في الذكاء الاصطناعي',
  design: 'text=التفكير التصميمي',
};

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

  const page = await browser.newPage();

  // Login to Blackboard
  console.log('Logging in...');
  await page.goto('https://lms.uqu.edu.sa/', { waitUntil: 'networkidle' });

  // Handle SSO login form
  await page.fill('input[name="username"], input[type="email"], #username', BB_USER);
  await page.fill('input[name="password"], input[type="password"], #password', BB_PASS);
  await page.click('button[type="submit"], input[type="submit"], #submitButton');
  await page.waitForLoadState('networkidle');
  console.log('Logged in.');

  // Go to courses
  await page.goto('https://lms.uqu.edu.sa/ultra/course', { waitUntil: 'networkidle' });

  // Click target course
  await page.click(COURSE_SELECTORS[CLASS]);
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
