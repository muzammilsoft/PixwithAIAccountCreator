import { Browser, Page } from 'puppeteer';
import { logger, LogLevel } from '../utils/AppLogger';
import fs from 'fs';

export class MoaktService {
    async generateEmail(browser: Browser): Promise<string> {
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.goto('https://www.moakt.com/en', { waitUntil: 'networkidle2' });

            // Click "Get a random address"
            const clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('input, button, a'));
                const target = buttons.find(b => {
                    const val = (b as any).value || '';
                    const txt = b.textContent || '';
                    return val.toLowerCase().includes('random') || txt.toLowerCase().includes('random');
                }) as HTMLElement;
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                // Try direct button if evaluate failed
                const randomBtn = await page.$('input[value*="random"], #random_email');
                if (randomBtn) await randomBtn.click();
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
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Go to inbox
            await page.goto('https://www.moakt.com/en/inbox', { waitUntil: 'networkidle2', timeout: 30000 });

            // Click refresh
            const refreshBtn = await page.$('#refresh_inbox');
            if (refreshBtn) {
                await refreshBtn.click();
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Check for emails from Pixwith or with "code" in subject
            // Take screenshot of inbox for debugging
            const inboxBuffer = await page.screenshot({ fullPage: true });
            fs.writeFileSync(`debug_moakt_inbox_${Date.now()}.png`, inboxBuffer);

            const emailData = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length < 2) continue;

                    const text = row.textContent?.toLowerCase() || '';
                    if (text.includes('no messages') || text.includes('no emails')) continue;

                    const subject = cells[0].textContent || '';
                    const sender = cells[1].textContent || '';

                    if (sender.toLowerCase().includes('pixwith') || subject.toLowerCase().includes('code') || subject.toLowerCase().includes('verification')) {
                        const link = row.querySelector('a[href*="/email/"]');

                        // Extract code from subject if it's there
                        const matches = subject.match(/\b([A-Z0-9]{6})\b/);
                        const codeFromSubject = matches ? matches[1] : null;

                        return {
                            link: link ? (link as HTMLAnchorElement).href : null,
                            codeFromSubject
                        };
                    }
                }
                return null;
            });

            if (!emailData) return null;

            if (emailData.codeFromSubject) {
                logger.log(`✅ تم استخراج الكود من عنوان الرسالة: ${emailData.codeFromSubject}`, LogLevel.SUCCESS);
                return emailData.codeFromSubject;
            }

            if (!emailData.link) return null;

            logger.log(`📧 تم العثور على رسالة، جاري فتحها: ${emailData.link}`, LogLevel.INFO);
            const emailLink = emailData.link;
            await page.goto(emailLink, { waitUntil: 'networkidle2' });

            // Wait for content
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Extract code from msg_body iframe or direct text
            const code = await page.evaluate(() => {
                // Try to find code in the whole body first
                const bodyText = document.body.innerText;

                // If there's an iframe for the message body
                const iframe = document.querySelector('#msg_body') as HTMLIFrameElement;
                let content = bodyText;
                if (iframe) {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow?.document;
                        if (doc && doc.body) content += " " + doc.body.innerText;
                    } catch (e) {}
                }

                // Pixwith specific: sometimes the code is in a bold or large text
                // Let's use a more robust regex that prioritizes the 6-digit alphanumeric code
                // We exclude common words that might be 6 chars like 'PIXWITH'
                const matches = content.match(/\b([A-Z0-9]{6})\b/g);
                if (matches) {
                    // Find the one that is likely the code (often the one with more numbers or at the end)
                    const filtered = matches.filter(m => m !== 'PIXWITH' && m !== 'SIGNUP' && m !== 'VERIFY');
                    return filtered.length > 0 ? filtered[filtered.length - 1] : matches[0];
                }
                return null;
            });

            if (code) {
                logger.log(`✅ تم استخراج الكود بنجاح: ${code}`, LogLevel.SUCCESS);
                return code;
            } else {
                logger.log(`⚠️ لم يتم العثور على الكود داخل الرسالة.`, LogLevel.WARNING);
                // Log partial content for debugging if needed (limited)
                return null;
            }
        } catch (e: any) {
            logger.log(`Error reading Moakt: ${e.message}`, LogLevel.ERROR);
            return null;
        } finally {
            await page.close();
        }
    }
}
