import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { MailService, MailAccount } from '../services/MailService';
import { ProxyConfig } from '../utils/ProxyManager';
import { logger, LogLevel } from '../utils/AppLogger';
import fs from 'fs';
import path from 'path';

export class PixwithAutomation {
    private mailService: MailService;
    private accountsPath = path.join(process.cwd(), 'data', 'accounts.json');

    constructor() {
        this.mailService = new MailService();
    }

    async createAccount(referralLink: string, proxy?: ProxyConfig): Promise<boolean> {
        let browser: Browser | null = null;
        try {
            logger.log(`بدء عملية إنشاء حساب جديد...`, LogLevel.INFO);

            // 1. Generate Email
            logger.log(`جاري توليد بريد مؤقت...`, LogLevel.INFO);
            const mailAccount = await this.mailService.createAccount();
            logger.log(`تم توليد البريد: ${mailAccount.address}`, LogLevel.SUCCESS);

            // 2. Launch Browser
            browser = await chromium.launch({
                headless: true,
                proxy: proxy ? {
                    server: `${proxy.host}:${proxy.port}`,
                    username: proxy.username,
                    password: proxy.password
                } : undefined
            });

            const context = await browser.newContext();
            const page = await context.newPage();

            // 3. Go to Referral Link
            logger.log(`التوجه إلى رابط الإحالة...`, LogLevel.INFO);
            await page.goto(referralLink, { waitUntil: 'networkidle' });

            // 4. Click Sign In
            logger.log(`الضغط على زر Sign in...`, LogLevel.INFO);
            await page.click('text=Sign in');
            await page.waitForTimeout(2000);

            // 5. Enter Email and request code
            logger.log(`إدخال البريد الإلكتروني: ${mailAccount.address}`, LogLevel.INFO);
            await page.fill('input[type="email"]', mailAccount.address);
            await page.click('button:has-text("Send"), button:has-text("Verification Code"), button:has-text("Send Code")');

            // Wait for potential UI change or message
            await page.waitForTimeout(3000);

            // 6. Polling for verification code
            logger.log(`انتظار وصول رمز التحقق...`, LogLevel.INFO);
            let code: string | null = null;
            for (let i = 0; i < 20; i++) {
                code = await this.mailService.getVerificationCode(mailAccount.token);
                if (code) break;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            if (!code) {
                throw new Error('لم يتم استلام رمز التحقق في الوقت المحدد.');
            }

            logger.log(`تم استلام الرمز: ${code}`, LogLevel.SUCCESS);

            // 7. Enter Code
            logger.log(`إدخال رمز التحقق في الموقع...`, LogLevel.INFO);
            const codeInput = await page.$('input[placeholder*="Code"], input[name*="code"], input[type="text"]');
            if (codeInput) {
                await codeInput.fill(code);
            } else {
                await page.keyboard.type(code);
            }

            await page.keyboard.press('Enter');
            await page.waitForTimeout(5000);

            // 8. Verify success and save
            logger.log(`تم إتمام العملية بنجاح!`, LogLevel.SUCCESS);
            this.saveAccount(mailAccount.address, 'Password123!');

            return true;
        } catch (error: any) {
            logger.log(`فشل إنشاء الحساب: ${error.message}`, LogLevel.ERROR);
            return false;
        } finally {
            if (browser) await browser.close();
        }
    }

    private saveAccount(email: string, pass: string) {
        let accounts = [];
        const dataDir = path.dirname(this.accountsPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (fs.existsSync(this.accountsPath)) {
            accounts = JSON.parse(fs.readFileSync(this.accountsPath, 'utf8'));
        }
        accounts.push({
            email,
            password: pass,
            createdAt: new Date().toISOString()
        });
        fs.writeFileSync(this.accountsPath, JSON.stringify(accounts, null, 2));
    }
}
