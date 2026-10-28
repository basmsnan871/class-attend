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

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Login via UQU SSO
  console.log('Logging in...');
  await page.goto('https://uqu.edu.sa/Sso/Login', { waitUntil: 'networkidle' });
  console.log('Landed on:', page.url());
  await page.screenshot({ path: 'debug-login.png', fullPage: true });
  console.log('Screenshot saved.');

  // Wait for Livewire to boot — poll until a password input exists in DOM
  await page.waitForFunction(() => !!document.querySelector('input[type="password"]'), { timeout: 45000 });

  // Dump all inputs for debugging
  const inputDump = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, id: i.id, visible: i.offsetParent !== null }))
  );
  console.log('Inputs found:', JSON.stringify(inputDump));

  // Fill via native setter so Livewire/Alpine picks up the change
  await page.evaluate(([user, pass]) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    // find any non-password, non-hidden, non-submit input (username field)
    const SKIP = new Set(['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'search']);
    const textInput = [...document.querySelectorAll('input')].find(i => !SKIP.has(i.type));
    const pwInput = document.querySelector('input[type="password"]');
    if (!textInput) throw new Error('username input not found');
    if (!pwInput) throw new Error('password input not found');
    setter.call(textInput, user);
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    textInput.dispatchEvent(new Event('change', { bubbles: true }));
    setter.call(pwInput, pass);
    pwInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwInput.dispatchEvent(new Event('change', { bubbles: true }));
  }, [BB_USER, BB_PASS]);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')].find(b => b.offsetParent !== null);
    if (btn) btn.click();
  });
  await page.waitForURL('**/ultra/**', { timeout: 30000 });
  console.log('Logged in, now at:', page.url());

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
