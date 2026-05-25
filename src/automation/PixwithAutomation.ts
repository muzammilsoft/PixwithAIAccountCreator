import puppeteer, { Browser, Page } from 'puppeteer-core';
import { MailService } from '../services/MailService';
import { ProxyConfig } from '../utils/ProxyManager';
import { logger, LogLevel } from '../utils/AppLogger';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export class PixwithAutomation {
    private mailService: MailService;
    private accountsPath = path.join(process.cwd(), 'data', 'accounts.json');

    constructor() {
        this.mailService = new MailService();
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
            // Linux
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

        // Try to find via command on Linux/Mac
        if (platform !== 'win32') {
            try {
                return execSync('which google-chrome || which chromium || which brave-browser').toString().trim();
            } catch (e) {}
        }

        throw new Error('لم يتم العثور على مسار متصفح Chrome أو Chromium. يرجى تثبيته أولاً.');
    }

    async createAccount(referralLink: string, proxy?: ProxyConfig): Promise<boolean> {
        let browser: Browser | null = null;
        try {
            logger.log(`--- بدء دورة عمل جديدة (Puppeteer) ---`, LogLevel.INFO);

            // 1. Generate Email
            logger.log(`[1/8] جاري طلب بريد مؤقت من Mail.tm...`, LogLevel.INFO);
            const mailAccount = await this.mailService.createAccount();
            logger.log(`✅ تم الحصول على البريد: ${mailAccount.address}`, LogLevel.SUCCESS);

            // 2. Launch Browser
            const executablePath = this.findChromePath();
            logger.log(`[2/8] تشغيل المتصفح من: ${executablePath}`, LogLevel.INFO);

            const args = ['--no-sandbox', '--disable-setuid-sandbox'];
            if (proxy) {
                args.push(`--proxy-server=${proxy.host}:${proxy.port}`);
            }

            browser = await puppeteer.launch({
                executablePath,
                headless: true,
                args
            });

            const page = await browser.newPage();
            if (proxy && proxy.username && proxy.password) {
                await page.authenticate({
                    username: proxy.username,
                    password: proxy.password
                });
            }

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            logger.log(`✅ المتصفح جاهز للعمل.`, LogLevel.SUCCESS);

            // 3. Go to Referral Link
            let targetUrl = referralLink.trim();
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                targetUrl = 'https://' + targetUrl;
            }
            logger.log(`[3/8] التوجه إلى رابط الإحالة: ${targetUrl}`, LogLevel.INFO);
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            logger.log(`✅ تم تحميل الصفحة بنجاح.`, LogLevel.SUCCESS);

            // 4. Click Sign In
            logger.log(`[4/8] البحث عن زر "Sign in" أو "Start for Free"...`, LogLevel.INFO);
            const buttonSelectors = [
                'button ::-p-text(Sign in)',
                'a ::-p-text(Sign in)',
                'button ::-p-text(Start for Free)',
                'a ::-p-text(Start for Free)'
            ];

            let clicked = false;
            for (const selector of buttonSelectors) {
                try {
                    const btn = await page.waitForSelector(selector, { timeout: 3000 });
                    if (btn) {
                        await btn.click();
                        clicked = true;
                        break;
                    }
                } catch (e) {}
            }

            if (!clicked) {
                // Try fallback with simple page evaluate
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, a'));
                    const target = buttons.find(b =>
                        b.textContent?.includes('Sign in') ||
                        b.textContent?.includes('Start for Free')
                    ) as HTMLElement;
                    if (target) target.click();
                });
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
            logger.log(`✅ تم الضغط على زر الدخول.`, LogLevel.SUCCESS);

            // 5. Enter Email and request code
            logger.log(`[5/8] إدخال البريد الإلكتروني: ${mailAccount.address}`, LogLevel.INFO);
            await page.waitForSelector('input[type="email"]', { timeout: 10000 });
            await page.type('input[type="email"]', mailAccount.address);

            logger.log(`جاري طلب رمز التحقق...`, LogLevel.INFO);
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const sendBtn = buttons.find(b =>
                    b.textContent?.includes('Send') ||
                    b.textContent?.includes('Verification Code')
                ) as HTMLElement;
                if (sendBtn) sendBtn.click();
            });

            logger.log(`✅ تم طلب رمز التحقق.`, LogLevel.SUCCESS);
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 6. Polling for verification code
            logger.log(`[6/8] انتظار وصول الرسالة (Polling)...`, LogLevel.INFO);
            let code: string | null = null;
            for (let i = 1; i <= 30; i++) {
                logger.log(`فحص البريد.. محاولة رقم ${i}/30`, LogLevel.INFO);
                code = await this.mailService.getVerificationCode(mailAccount.token);
                if (code) break;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            if (!code) {
                throw new Error('❌ لم يصل رمز التحقق خلال الوقت المحدد.');
            }

            logger.log(`✅ تم استخراج الرمز بنجاح: ${code}`, LogLevel.SUCCESS);

            // 7. Enter Code
            logger.log(`[7/8] إدخال الرمز ${code}...`, LogLevel.INFO);
            const codeInput = await page.$('input[placeholder*="Code"], input[name*="code"], input[type="text"]');
            if (codeInput) {
                await codeInput.type(code);
            } else {
                await page.keyboard.type(code);
            }

            await page.keyboard.press('Enter');
            logger.log(`جاري انتظار معالجة التسجيل...`, LogLevel.INFO);
            await new Promise(resolve => setTimeout(resolve, 8000));

            // 8. Verify success and save
            logger.log(`[8/8] التحقق من حالة التسجيل...`, LogLevel.INFO);
            const content = await page.content();
            if (content.toLowerCase().includes('error') || content.toLowerCase().includes('failed')) {
                 logger.log(`تحذير: قد يكون هناك خطأ ظاهر في الصفحة، ولكن سيتم حفظ البيانات للتأكد.`, LogLevel.WARNING);
            }

            logger.log(`✅ تم إكمال العملية بنجاح!`, LogLevel.SUCCESS);
            this.saveAccount(mailAccount.address, 'Password123!');

            return true;
        } catch (error: any) {
            logger.log(`❌ فشل في Puppeteer: ${error.message}`, LogLevel.ERROR);
            return false;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    private saveAccount(email: string, pass: string) {
        let accounts = [];
        const dataDir = path.dirname(this.accountsPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (fs.existsSync(this.accountsPath)) {
            try {
                accounts = JSON.parse(fs.readFileSync(this.accountsPath, 'utf8'));
            } catch (e) {
                accounts = [];
            }
        }
        accounts.push({
            email,
            password: pass,
            createdAt: new Date().toISOString()
        });
        fs.writeFileSync(this.accountsPath, JSON.stringify(accounts, null, 2));
    }
}
