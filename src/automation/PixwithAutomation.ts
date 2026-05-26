import puppeteer, { Browser, Page } from 'puppeteer-core';
import { MailTmService, MailAccount } from '../services/MailService';
import { YopmailService } from '../services/YopmailService';
import { ProxyConfig } from '../utils/ProxyManager';
import { logger, LogLevel } from '../utils/AppLogger';
import { CaptchaService } from '../services/CaptchaService';
import { uploadScreenshot } from '../utils/ScreenshotUploader';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export class PixwithAutomation {
    private mailTmService: MailTmService;
    private yopmailService: YopmailService;
    private captchaService?: CaptchaService;
    private accountsPath = path.join(process.cwd(), 'data', 'accounts.json');

    constructor(captchaApiKey?: string) {
        if (captchaApiKey) {
            this.captchaService = new CaptchaService(captchaApiKey);
        }
        this.mailTmService = new MailTmService();
        this.yopmailService = new YopmailService(this.captchaService);
    }

    private findChromePath(): string {
        const platform = process.platform;
        let paths: string[] = [];

        if (platform === 'win32') {
            paths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
            ];
        } else if (platform === 'darwin') {
            paths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
            ];
        } else {
            paths = [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/brave-browser'
            ];
        }

        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }

        if (platform !== 'win32') {
            try {
                return execSync('which google-chrome || which chromium || which brave-browser').toString().trim();
            } catch (e) {}
        }

        throw new Error('لم يتم العثور على مسار متصفح Chrome. يرجى تثبيته أولاً.');
    }

    private async takeAndEmitScreenshot(page: Page) {
        try {
            const buffer = await page.screenshot({ fullPage: true }) as Buffer;
            const base64 = buffer.toString('base64');
            const publicUrl = await uploadScreenshot(buffer);
            logger.sendScreenshot(base64, publicUrl || undefined);
        } catch (e) {
            console.error('Failed to capture screenshot', e);
        }
    }

    async createAccount(referralLink: string, proxy?: ProxyConfig, useYopmail: boolean = false): Promise<boolean> {
        let browser: Browser | null = null;
        try {
            logger.log(`--- بدء دورة عمل جديدة (Puppeteer) ---`, LogLevel.INFO);

            let email: string;
            let mailTmAcc: MailAccount | null = null;

            if (useYopmail) {
                logger.log(`[1/8] توليد بريد Yopmail...`, LogLevel.INFO);
                email = await this.yopmailService.generateEmail();
            } else {
                logger.log(`[1/8] جاري طلب بريد مؤقت من Mail.tm...`, LogLevel.INFO);
                mailTmAcc = await this.mailTmService.generateEmail();
                email = mailTmAcc.address;
            }
            logger.log(`✅ البريد المستخدم: ${email}`, LogLevel.SUCCESS);

            const executablePath = this.findChromePath();
            const args = ['--no-sandbox', '--disable-setuid-sandbox'];
            if (proxy) args.push(`--proxy-server=${proxy.host}:${proxy.port}`);

            browser = await puppeteer.launch({
                executablePath,
                headless: true,
                args
            });

            const page = await browser.newPage();
            if (proxy && proxy.username && proxy.password) {
                await page.authenticate({ username: proxy.username, password: proxy.password });
            }

            await page.setViewport({ width: 1280, height: 800 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            let targetUrl = referralLink.trim();
            if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

            logger.log(`[3/8] التوجه إلى: ${targetUrl}`, LogLevel.INFO);
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await this.takeAndEmitScreenshot(page);

            // Click Sign In
            logger.log(`[4/8] محاولة التسجيل...`, LogLevel.INFO);
            const clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const target = buttons.find(b =>
                    b.textContent?.toLowerCase().includes('sign in') ||
                    b.textContent?.toLowerCase().includes('start for free') ||
                    b.textContent?.includes('ابدأ')
                ) as HTMLElement;
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                // Try direct go to register if button not found
                await page.goto('https://pixwith.ai/signup', { waitUntil: 'networkidle2' });
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
            await this.takeAndEmitScreenshot(page);

            // Enter Email
            logger.log(`[5/8] إدخال البريد: ${email}`, LogLevel.INFO);
            await page.waitForSelector('input[type="email"]', { timeout: 15000 });
            await page.type('input[type="email"]', email, { delay: 100 });

            await this.takeAndEmitScreenshot(page);

            logger.log(`طلب رمز التحقق...`, LogLevel.INFO);
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const sendBtn = buttons.find(b =>
                    b.textContent?.includes('Send') ||
                    b.textContent?.includes('Verification Code') ||
                    b.textContent?.includes('رمز')
                ) as HTMLElement;
                if (sendBtn) sendBtn.click();
            });

            await new Promise(resolve => setTimeout(resolve, 5000));
            await this.takeAndEmitScreenshot(page);

            // Polling Code
            logger.log(`[6/8] انتظار الكود...`, LogLevel.INFO);
            let code: string | null = null;
            for (let i = 1; i <= 20; i++) {
                logger.log(`فحص البريد محاولة ${i}/20`, LogLevel.INFO);
                if (useYopmail) {
                    code = await this.yopmailService.getVerificationCode(browser, email);
                } else if (mailTmAcc) {
                    code = await this.mailTmService.getVerificationCode(mailTmAcc.token);
                }
                if (code) break;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            if (!code) throw new Error('❌ لم يصل رمز التحقق.');

            logger.log(`✅ الرمز: ${code}`, LogLevel.SUCCESS);

            // Enter Code
            logger.log(`[7/8] إدخال الرمز...`, LogLevel.INFO);
            const codeInput = await page.$('input[placeholder*="Code"], input[name*="code"], input[maxlength="6"]');
            if (codeInput) {
                await codeInput.type(code);
            } else {
                await page.keyboard.type(code);
            }

            await page.keyboard.press('Enter');
            await new Promise(resolve => setTimeout(resolve, 10000));
            await this.takeAndEmitScreenshot(page);

            logger.log(`✅ تم إكمال العملية!`, LogLevel.SUCCESS);
            this.saveAccount(email, 'Password123!');

            return true;
        } catch (error: any) {
            logger.log(`❌ فشل: ${error.message}`, LogLevel.ERROR);
            if (browser) {
                const pages = await browser.pages();
                if (pages.length > 0) await this.takeAndEmitScreenshot(pages[0]);
            }
            return false;
        } finally {
            if (browser) await browser.close();
        }
    }

    private saveAccount(email: string, pass: string) {
        let accounts = [];
        const dataDir = path.dirname(this.accountsPath);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (fs.existsSync(this.accountsPath)) {
            try {
                accounts = JSON.parse(fs.readFileSync(this.accountsPath, 'utf8'));
            } catch (e) {
                accounts = [];
            }
        }
        accounts.push({ email, password: pass, createdAt: new Date().toISOString() });
        fs.writeFileSync(this.accountsPath, JSON.stringify(accounts, null, 2));
    }
}
