import axios from 'axios';
import { Browser, Page } from 'puppeteer-core';
import { CaptchaService } from './CaptchaService';
import { logger, LogLevel } from '../utils/AppLogger';

export class YopmailService {
    private captchaService?: CaptchaService;

    constructor(captchaService?: CaptchaService) {
        this.captchaService = captchaService;
    }

    async generateEmail(): Promise<string> {
        const random = Math.random().toString(36).substring(2, 10);
        return `${random}@yopmail.com`;
    }

    async getVerificationCode(browser: Browser, email: string): Promise<string | null> {
        const page = await browser.newPage();
        try {
            const username = email.split('@')[0];
            await page.goto(`https://yopmail.com/en/wm?login=${username}`, { waitUntil: 'networkidle2' });

            // Check for ReCaptcha
            const hasCaptcha = await page.$('div.g-recaptcha');
            if (hasCaptcha && this.captchaService) {
                logger.log('Yopmail detected ReCaptcha, attempting to solve...', LogLevel.WARNING);
                const siteKey = await page.evaluate(() => {
                    return document.querySelector('.g-recaptcha')?.getAttribute('data-sitekey');
                });

                if (siteKey) {
                    const token = await this.captchaService.solveReCaptcha(siteKey, page.url());
                    await page.evaluate((token) => {
                        (document.getElementById('g-recaptcha-response') as HTMLTextAreaElement).value = token;
                        // @ts-ignore
                        if (typeof parent.submitform === 'function') parent.submitform();
                        else if (document.querySelector('form')) document.querySelector('form')?.submit();
                    }, token);
                    await page.waitForNavigation({ waitUntil: 'networkidle2' });
                }
            }

            // Switch to iframe where emails are listed
            const iframes = page.frames();
            const mailFrame = iframes.find(f => f.name() === 'ifinbox');

            if (mailFrame) {
                // Refresh inbox
                await page.click('#refresh');
                await new Promise(resolve => setTimeout(resolve, 2000));

                const latestMail = await mailFrame.$('.m');
                if (latestMail) {
                    await latestMail.click();
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const contentFrame = iframes.find(f => f.name() === 'ifmail');
                    if (contentFrame) {
                        const body = await contentFrame.evaluate(() => document.body.innerText);
                        const codeMatch = body.match(/\b([A-Z0-9]{6})\b/);
                        return codeMatch ? codeMatch[1] : null;
                    }
                }
            }

            return null;
        } catch (e: any) {
            logger.log(`Error reading Yopmail: ${e.message}`, LogLevel.ERROR);
            return null;
        } finally {
            await page.close();
        }
    }
}
