import { Browser, Page } from 'puppeteer-core';
import { logger, LogLevel } from '../utils/AppLogger';

export class MoaktService {
    async generateEmail(browser: Browser): Promise<string> {
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.goto('https://www.moakt.com/en', { waitUntil: 'networkidle2' });

            // Click "Get a random address" or similar
            const getBtn = await page.$('input[value="Get a random address"], #random_email, .btn-random');
            if (getBtn) {
                await getBtn.click();
            } else {
                // Fallback attempt to click any button that looks like "Random"
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('input, button, a'));
                    const target = buttons.find(b => {
                        const txt = (b as any).value || b.textContent || '';
                        return txt.toLowerCase().includes('random');
                    }) as HTMLElement;
                    if (target) target.click();
                });
            }

            await page.waitForSelector('#email-address', { timeout: 15000 });
            const email = await page.evaluate(() => {
                const el = document.querySelector('#email-address');
                return el ? el.textContent?.trim() : null;
            });

            if (!email) throw new Error('Could not find email address on Moakt');

            return email;
        } catch (e: any) {
            logger.log(`Error generating Moakt email: ${e.message}`, LogLevel.ERROR);
            throw e;
        } finally {
            await page.close();
        }
    }

    async getVerificationCode(browser: Browser, email: string): Promise<string | null> {
        const page = await browser.newPage();
        try {
            const [name, domain] = email.split('@');
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Go to inbox directly
            await page.goto('https://www.moakt.com/en/inbox', { waitUntil: 'networkidle2', timeout: 30000 });

            // Look for refresh and click it
            const refreshBtn = await page.$('#refresh_inbox, .btn-refresh, input[value="Refresh"]');
            if (refreshBtn) {
                await refreshBtn.click();
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Check if any emails exist
            const emailFound = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('table#emails-list tbody tr'));
                // Find a row that doesn't say "No emails"
                const validRow = rows.find(r => r.textContent && !r.textContent.includes('No emails'));
                if (validRow) {
                    const link = validRow.querySelector('a');
                    if (link) {
                        link.click();
                        return true;
                    }
                }
                return false;
            });

            if (!emailFound) return null;

            // Wait for message content to load
            await page.waitForSelector('#email_content, .msg_body', { timeout: 10000 }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Extract code
            const result = await page.evaluate(() => {
                const content = document.querySelector('#email_content')?.textContent ||
                               document.querySelector('.msg_body')?.textContent ||
                               document.body.innerText;

                const match = content.match(/\b([A-Z0-9]{6})\b/);
                return match ? match[1] : null;
            });

            if (result) {
                logger.log(`✅ تم العثور على الكود في Moakt: ${result}`, LogLevel.SUCCESS);
            } else {
                logger.log(`⚠️ تم فتح الرسالة في Moakt ولكن لم يتم العثور على نمط الكود (6 رموز).`, LogLevel.WARNING);
            }

            return result;
        } catch (e: any) {
            logger.log(`Error reading Moakt: ${e.message}`, LogLevel.ERROR);
            return null;
        } finally {
            await page.close();
        }
    }
}
