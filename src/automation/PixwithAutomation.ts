import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { MailTmService, MailAccount } from '../services/MailService';

puppeteer.use(StealthPlugin());
import { YopmailService } from '../services/YopmailService';
import { OneSecMailService } from '../services/OneSecMailService';
import { MoaktService } from '../services/MoaktService';
import { ProxyConfig } from '../utils/ProxyManager';
import { logger, LogLevel } from '../utils/AppLogger';
import { config } from '../utils/Config';
import { CaptchaService } from '../services/CaptchaService';
import { uploadScreenshot } from '../utils/ScreenshotUploader';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export enum MailProvider {
    MAIL_TM = 'mailtm',
    YOPMAIL = 'yopmail',
    ONESECMAIL = 'onesecmail',
    MOAKT = 'moakt'
}

export class PixwithAutomation {
    private mailTmService: MailTmService;
    private yopmailService: YopmailService;
    private oneSecMailService: OneSecMailService;
    private moaktService: MoaktService;
    private captchaService?: CaptchaService;
    private accountsPath = path.join(process.cwd(), 'data', 'accounts.json');

    constructor(captchaApiKey?: string) {
        if (captchaApiKey) {
            this.captchaService = new CaptchaService(captchaApiKey);
        }
        this.mailTmService = new MailTmService();
        this.yopmailService = new YopmailService(this.captchaService);
        this.oneSecMailService = new OneSecMailService();
        this.moaktService = new MoaktService();
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

    private async takeAndEmitScreenshot(page: Page, label: string = 'Screenshot') {
        try {
            logger.log(`📸 جاري محاولة التقاط لقطة شاشة: ${label}`, LogLevel.INFO);
            const buffer = await page.screenshot({ fullPage: true }) as Buffer;

            // Save locally for debugging
            const filename = `debug_${label.replace(/\s+/g, '_').toLowerCase()}.png`;
            fs.writeFileSync(filename, buffer);

            const base64 = buffer.toString('base64');
            const publicUrl = await uploadScreenshot(buffer);
            logger.sendScreenshot(base64, publicUrl || undefined);
            if (publicUrl) {
                logger.log(`✅ تم رفع اللقطة بنجاح: ${publicUrl}`, LogLevel.SUCCESS);
            } else {
                logger.log(`⚠️ فشل رفع اللقطة للسيرفر العالمي، لكنها تظهر في الواجهة المحلية.`, LogLevel.WARNING);
            }
        } catch (e: any) {
            logger.log(`❌ فشل التقاط لقطة شاشة: ${e.message}`, LogLevel.ERROR);
        }
    }

    async createAccount(referralLink: string, proxy?: ProxyConfig, provider: MailProvider = MailProvider.MAIL_TM): Promise<boolean> {
        let browser: Browser | null = null;
        try {
            logger.log(`--- بدء دورة عمل جديدة (Puppeteer) ---`, LogLevel.INFO);

            const executablePath = this.findChromePath();
            const args = ['--no-sandbox', '--disable-setuid-sandbox'];
            if (proxy) args.push(`--proxy-server=${proxy.host}:${proxy.port}`);

            browser = await puppeteer.launch({
                executablePath,
                headless: config.headless,
                args
            });

            let email: string;
            let mailTmAcc: MailAccount | null = null;

            try {
                if (provider === MailProvider.YOPMAIL) {
                    logger.log(`[1/8] توليد بريد Yopmail...`, LogLevel.INFO);
                    email = await this.yopmailService.generateEmail();
                } else if (provider === MailProvider.ONESECMAIL) {
                    logger.log(`[1/8] توليد بريد 1secMail...`, LogLevel.INFO);
                    email = await this.oneSecMailService.generateEmail();
                } else if (provider === MailProvider.MOAKT) {
                    logger.log(`[1/8] توليد بريد Moakt...`, LogLevel.INFO);
                if (!browser) throw new Error('Browser not initialized');
                    email = await this.moaktService.generateEmail(browser);
                } else {
                    logger.log(`[1/8] جاري طلب بريد مؤقت من Mail.tm...`, LogLevel.INFO);
                    mailTmAcc = await this.mailTmService.generateEmail();
                    email = mailTmAcc.address;
                }
            } catch (e: any) {
                throw new Error(`فشل توليد البريد الإلكتروني (${provider}): ${e.message}`);
            }
            logger.log(`✅ البريد المستخدم: ${email}`, LogLevel.SUCCESS);
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

            // Check for Cloudflare/Captcha
            const content = await page.content();
            if (content.includes('cf-challenge') || content.includes('ray-id')) {
                logger.log('⚠️ تم اكتشاف Cloudflare Challenge، قد تفشل العملية.', LogLevel.WARNING);
            }

            // Diagnostic: Check if referral was applied
            const hasReferralCookie = (await page.cookies()).some(c => c.name.toLowerCase().includes('ref'));
            if (hasReferralCookie) {
                logger.log('✅ تم اكتشاف ملف تعريف الإحالة (Referral Cookie).', LogLevel.SUCCESS);
            } else {
                logger.log('ℹ️ لم يتم العثور على ملف تعريف الإحالة، قد يتم التسجيل بدون إحالة.', LogLevel.INFO);
            }

            await this.takeAndEmitScreenshot(page, 'Landing Page');

            // Click Sign In / Start for Free to trigger modal
            logger.log(`[4/8] محاولة فتح نافذة التسجيل...`, LogLevel.INFO);
            const clicked = await page.evaluate(() => {
                const isButton = (el: Element) => {
                    const tag = el.tagName.toLowerCase();
                    return tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button' || el.classList.contains('mantine-Button-root');
                };

                const elements = Array.from(document.querySelectorAll('button, a, span, div, .mantine-Button-root'));

                // Try specific text matches first
                const target = elements.find(b => {
                    const txt = b.textContent?.toLowerCase().trim() || '';
                    return (txt === 'sign in' || txt === 'start for free' || txt === 'ابدأ مجاناً' || txt === 'تسجيل الدخول' || txt === 'get started' || txt === 'sign in / sign up');
                }) as HTMLElement;

                if (target) {
                    target.click();
                    return true;
                }

                // Fallback to broader match
                const fallback = elements.find(b => {
                    if (!isButton(b)) return false;
                    const txt = b.textContent?.toLowerCase() || '';
                    return txt.includes('sign') || txt.includes('start') || txt.includes('ابدأ');
                }) as HTMLElement;

                if (fallback) {
                    fallback.click();
                    return true;
                }

                return false;
            });

            if (!clicked) {
                logger.log('⚠️ لم يتم العثور على زر فتح النافذة، محاولة التوجه المباشر لرابط التسجيل.', LogLevel.WARNING);
                await page.goto('https://pixwith.ai/signin', { waitUntil: 'networkidle2' }).catch(() => {});
            }

            // Wait for modal and email input
            try {
                await page.waitForSelector('input[type="email"]', { timeout: 10000 });
                logger.log('✅ ظهرت نافذة التسجيل.', LogLevel.SUCCESS);
            } catch (e) {
                logger.log('⚠️ لم تظهر نافذة التسجيل بعد الضغط، محاولة الانتقال المباشر...', LogLevel.WARNING);
                await page.goto('https://pixwith.ai/signup', { waitUntil: 'networkidle2' });
                await page.waitForSelector('input[type="email"]', { timeout: 10000 }).catch(() => {});
            }

            await this.takeAndEmitScreenshot(page, 'Sign Up Modal');

            // Enter Email
            logger.log(`[5/8] إدخال البريد: ${email}`, LogLevel.INFO);
            const emailInput = await page.$('input[type="email"]');
            if (!emailInput) throw new Error('لم يتم العثور على حقل البريد الإلكتروني');

            await emailInput.click({ clickCount: 3 });
            await emailInput.press('Backspace');
            await emailInput.type(email, { delay: 50 });

            await this.takeAndEmitScreenshot(page, 'Email Entered');

            logger.log(`طلب رمز التحقق...`, LogLevel.INFO);
            const sendBtnStatus = await page.evaluate(() => {
                const isButtonElement = (el: Element) => {
                    const tagName = el.tagName.toLowerCase();
                    const role = el.getAttribute('role');
                    const className = el.className || '';
                    return tagName === 'button' || role === 'button' || className.includes('Button');
                };

                const elements = Array.from(document.querySelectorAll('button, [role="button"], .mantine-Button-root, a, span, div'));

                // Priority 1: Exact matches on actual buttons
                const exactBtn = elements.find(b => {
                    if (!isButtonElement(b)) return false;
                    const txt = b.textContent?.trim().toLowerCase() || '';
                    return txt === 'send code' || txt === 'sign in / sign up' || txt === 'continue' || txt === 'إرسال الرمز' || txt === 'متابعة';
                }) as HTMLElement;

                if (exactBtn) {
                    exactBtn.scrollIntoView();
                    exactBtn.click();
                    return { found: true, type: 'exact', text: exactBtn.textContent?.trim() };
                }

                // Priority 2: Partial matches on button-like elements
                const partialBtn = elements.find(b => {
                    if (!isButtonElement(b)) return false;
                    const txt = b.textContent?.trim().toLowerCase() || '';
                    return (txt.includes('send') || txt.includes('sign in') || txt.includes('sign up') || txt.includes('continue')) && !txt.includes('terms of service');
                }) as HTMLElement;

                if (partialBtn) {
                    partialBtn.scrollIntoView();
                    partialBtn.click();
                    return { found: true, type: 'partial', text: partialBtn.textContent?.trim() };
                }

                return { found: false };
            });

            if (!sendBtnStatus.found) {
                logger.log(`❌ فشل العثور على زر إرسال الرمز.`, LogLevel.ERROR);
                await this.takeAndEmitScreenshot(page, 'Send Button Not Found');
            } else {
                logger.log(`✅ تم الضغط على زر إرسال الرمز (${sendBtnStatus.text}).`, LogLevel.SUCCESS);
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
            await this.takeAndEmitScreenshot(page, 'After Code Request');

            // Polling Code
            logger.log(`[6/8] انتظار الكود (المهلة 3 دقائق)...`, LogLevel.INFO);
            let code: string | null = null;
            for (let i = 1; i <= 36; i++) {
                logger.log(`فحص البريد محاولة ${i}/36`, LogLevel.INFO);
                if (provider === MailProvider.YOPMAIL) {
                    if (!browser) throw new Error('Browser not initialized');
                    code = await this.yopmailService.getVerificationCode(browser, email);
                } else if (provider === MailProvider.ONESECMAIL) {
                    code = await this.oneSecMailService.getVerificationCode(email);
                } else if (provider === MailProvider.MOAKT) {
                    if (!browser) throw new Error('Browser not initialized');
                    code = await this.moaktService.getVerificationCode(browser, email);
                } else if (mailTmAcc) {
                    code = await this.mailTmService.getVerificationCode(mailTmAcc.token);
                }
                if (code) break;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            if (!code) throw new Error('❌ لم يصل رمز التحقق.');

            logger.log(`✅ الرمز المستخرج: ${code}`, LogLevel.SUCCESS);

            // Enter Code
            logger.log(`[7/8] إدخال الرمز...`, LogLevel.INFO);
            // Pixwith uses a specific code input often split or with specific classes
            const codeInput = await page.$('input[placeholder*="code" i], input[placeholder*="رمز" i], input[aria-label*="code" i], .mantine-Input-input');
            if (codeInput) {
                await codeInput.focus();
                await codeInput.click({ clickCount: 3 });
                await codeInput.press('Backspace');
                await codeInput.type(code, { delay: 150 });
            } else {
                logger.log('⚠️ لم يتم العثور على حقل الكود، المحاولة عبر لوحة المفاتيح مباشرة.', LogLevel.WARNING);
                await page.keyboard.type(code, { delay: 150 });
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            await page.keyboard.press('Enter');
            logger.log(`بانتظار اتمام التسجيل...`, LogLevel.INFO);
            await new Promise(resolve => setTimeout(resolve, 15000));

            // Check if login was successful (usually URL changes or a logout button appears)
            const finalUrl = page.url();
            const isLoggedIn = await page.evaluate(() => {
                return document.body.innerText.toLowerCase().includes('sign out') ||
                       document.body.innerText.toLowerCase().includes('تسجيل الخروج') ||
                       window.location.pathname.includes('/dashboard') ||
                       window.location.pathname.includes('/app');
            });

            await this.takeAndEmitScreenshot(page, 'Final Result');

            if (isLoggedIn || !finalUrl.includes('signin')) {
                logger.log(`✅ تم إكمال الدورة والتسجيل بنجاح!`, LogLevel.SUCCESS);
                this.saveAccount(email, 'Password123!');
                return true;
            } else {
                logger.log(`⚠️ اكتملت الخطوات ولكن يبدو أن التسجيل لم يكتمل (URL: ${finalUrl})`, LogLevel.WARNING);
                return false;
            }
        } catch (error: any) {
            logger.log(`❌ فشل في الأتمتة: ${error.message}`, LogLevel.ERROR);
            if (browser) {
                try {
                    const pages = await browser.pages();
                    if (pages.length > 0) await this.takeAndEmitScreenshot(pages[0], 'Error State');
                } catch (e) {}
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
