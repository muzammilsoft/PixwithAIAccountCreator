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
            // Moakt direct link to inbox usually follows a pattern or uses session
            // We'll go to the main page and it should remember the session if same browser instance
            await page.goto('https://www.moakt.com/en/inbox', { waitUntil: 'networkidle2' });

            // Refresh button
            const refreshBtn = await page.$('#refresh_inbox, .btn-refresh');
            if (refreshBtn) await refreshBtn.click();

            await new Promise(resolve => setTimeout(resolve, 3000));

            // Look for messages from Pixwith
            const hasMessages = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('table#emails-list tbody tr'));
                return rows.length > 0 && !rows[0].textContent?.includes('No emails');
            });

            if (!hasMessages) return null;

            // Click the first message
            await page.evaluate(() => {
                const firstRow = document.querySelector('table#emails-list tbody tr td a');
                if (firstRow) (firstRow as HTMLElement).click();
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

            // Get content
            const body = await page.evaluate(() => {
                const content = document.querySelector('#email_content') || document.body;
                return content.textContent || '';
            });

            const codeMatch = body.match(/\b([A-Z0-9]{6})\b/);
            return codeMatch ? codeMatch[1] : null;
        } catch (e: any) {
            logger.log(`Error reading Moakt: ${e.message}`, LogLevel.ERROR);
            return null;
        } finally {
            await page.close();
        }
    }
}
