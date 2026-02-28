const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    console.log('Navigating...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    // Wait for contacts to load
    await new Promise(r => setTimeout(r, 1000));

    // Click the first contact
    console.log('Clicking contact...');
    const contacts = await page.$$('.contact-item');
    if (contacts.length > 0) {
        await contacts[0].click();
    } else {
        console.log('No contacts found');
    }

    // Wait for chat to load
    await new Promise(r => setTimeout(r, 1000));

    // Click Brain icon
    console.log('Clicking brain icon...');
    const brainIcon = await page.$('button[title="View AI Memories"]');
    if (brainIcon) {
        await brainIcon.click();
        console.log('Brain clicked!');
    } else {
        console.log('Could not find brain icon!');
    }

    // Wait for drawer to animate
    await new Promise(r => setTimeout(r, 1000));

    // Take screenshot
    await page.screenshot({ path: 'frontend_debug.png' });
    console.log('Screenshot saved to frontend_debug.png');

    const html = await page.$eval('.right-column', el => el.outerHTML).catch(() => ''); console.log(html); await browser.close();
})();
