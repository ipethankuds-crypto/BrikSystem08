import puppeteer from 'puppeteer';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function getBrowserPath() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (fs.existsSync(chromePath)) return chromePath;
  if (fs.existsSync(edgePath)) return edgePath;
  return undefined;
}

async function inspectStep2() {
  const browser = await puppeteer.launch({
    executablePath: getBrowserPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();
  const url = 'https://www.smsreminder.co/book/007UCqZnjYgVb4dI/ipethan-kuds';
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Selecting slot and clicking Continue to Details...');
  
  // Click first available time slot
  await page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('AM') || b.innerText.includes('PM'));
    if (slots[0]) slots[0].click();
  });

  await new Promise(r => setTimeout(r, 500));

  // Click "Continue to Details →"
  await page.evaluate(() => {
    const continueBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue to Details'));
    if (continueBtn) continueBtn.click();
  });

  await new Promise(r => setTimeout(r, 2500));

  const detailsStep2 = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
      tagName: el.tagName,
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      className: el.className,
      value: el.value,
      ariaLabel: el.getAttribute('aria-label')
    }));

    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText.trim(),
      className: b.className,
      type: b.type
    }));

    return { inputs, buttons, bodyText: document.body.innerText.substring(0, 1500) };
  });

  console.log('\n--- STEP 2 INPUTS ---');
  console.log(JSON.stringify(detailsStep2.inputs, null, 2));

  console.log('\n--- STEP 2 BUTTONS ---');
  console.log(JSON.stringify(detailsStep2.buttons, null, 2));

  console.log('\n--- STEP 2 BODY TEXT ---');
  console.log(detailsStep2.bodyText);

  await page.screenshot({ path: 'smsreminder_step2.png' });
  console.log('Screenshot saved to smsreminder_step2.png');

  await browser.close();
}

inspectStep2().catch(console.error);
