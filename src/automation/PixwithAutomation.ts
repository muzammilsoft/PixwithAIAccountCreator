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
            logger.log(`--- بدء دورة عمل جديدة ---`, LogLevel.INFO);

            // 1. Generate Email
            logger.log(`[1/8] جاري طلب بريد مؤقت من Mail.tm...`, LogLevel.INFO);
            const mailAccount = await this.mailService.createAccount();
            logger.log(`✅ تم الحصول على البريد: ${mailAccount.address}`, LogLevel.SUCCESS);

            // 2. Launch Browser
            logger.log(`[2/8] جاري تشغيل المتصفح (Headless mode)...`, LogLevel.INFO);
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                proxy: proxy ? {
                    server: `${proxy.host}:${proxy.port}`,
                    username: proxy.username,
                    password: proxy.password
                } : undefined
            });

            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();
            logger.log(`✅ المتصفح جاهز للعمل.`, LogLevel.SUCCESS);

            // 3. Go to Referral Link
            logger.log(`[3/8] التوجه إلى رابط الإحالة: ${referralLink}`, LogLevel.INFO);
            await page.goto(referralLink, { waitUntil: 'networkidle', timeout: 60000 });
            logger.log(`✅ تم تحميل الصفحة بنجاح.`, LogLevel.SUCCESS);

            // 4. Click Sign In
            logger.log(`[4/8] البحث عن زر "Sign in" أو "Start for Free" والضغط عليه...`, LogLevel.INFO);
            // Based on the website text, there's a "Start for Free" button which usually opens the login/sign up modal
            const signInButton = page.locator('button:has-text("Sign in"), a:has-text("Sign in"), button:has-text("Start for Free"), a:has-text("Start for Free")').first();
            await signInButton.click({ timeout: 15000 });
            await page.waitForTimeout(3000);
            logger.log(`✅ تم الضغط على زر الدخول.`, LogLevel.SUCCESS);

            // 5. Enter Email and request code
            logger.log(`[5/8] إدخال البريد الإلكتروني في الحقل المخصص...`, LogLevel.INFO);
            await page.fill('input[type="email"]', mailAccount.address);
            await page.waitForTimeout(1000);

            logger.log(`جاري الضغط على زر إرسال الرمز...`, LogLevel.INFO);
            const sendButton = page.locator('button:has-text("Send"), button:has-text("Verification Code"), button:has-text("Send Code")').first();
            await sendButton.click({ timeout: 5000 });

            logger.log(`✅ تم طلب رمز التحقق.`, LogLevel.SUCCESS);
            await page.waitForTimeout(3000);

            // 6. Polling for verification code
            logger.log(`[6/8] انتظار وصول الرسالة إلى صندوق الوارد (Polling)...`, LogLevel.INFO);
            let code: string | null = null;
            for (let i = 1; i <= 30; i++) {
                logger.log(`فحص البريد.. محاولة رقم ${i}/30`, LogLevel.INFO);
                code = await this.mailService.getVerificationCode(mailAccount.token);
                if (code) break;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            if (!code) {
                throw new Error('❌ لم يصل رمز التحقق خلال 90 ثانية. قد يكون النطاق محظوراً أو هناك تأخير في الخدمة.');
            }

            logger.log(`✅ تم استخراج الرمز بنجاح: ${code}`, LogLevel.SUCCESS);

            // 7. Enter Code
            logger.log(`[7/8] إدخال الرمز ${code} في الموقع...`, LogLevel.INFO);
            const codeInput = await page.$('input[placeholder*="Code"], input[name*="code"], input[type="text"]');
            if (codeInput) {
                await codeInput.fill(code);
            } else {
                logger.log(`لم يتم العثور على حقل الإدخال، محاولة الكتابة المباشرة...`, LogLevel.WARNING);
                await page.keyboard.type(code);
            }

            await page.keyboard.press('Enter');
            logger.log(`جاري انتظار معالجة التسجيل...`, LogLevel.INFO);
            await page.waitForTimeout(7000);

            // 8. Verify success and save
            logger.log(`[8/8] التحقق من حالة التسجيل النهائية...`, LogLevel.INFO);
            // Simple heuristic: if we are still on the same page with an error message, it failed
            const errorElement = await page.$('text=error, text=failed, text=invalid');
            if (errorElement) {
                const errorMsg = await errorElement.innerText();
                throw new Error(`خطأ من الموقع: ${errorMsg}`);
            }

            logger.log(`✅ تم إنشاء الحساب بنجاح وتخزينه!`, LogLevel.SUCCESS);
            this.saveAccount(mailAccount.address, 'Password123!');

            return true;
        } catch (error: any) {
            logger.log(`❌ فشل في خطوة ما: ${error.message}`, LogLevel.ERROR);
            return false;
        } finally {
            if (browser) {
                logger.log(`إغلاق المتصفح لتحرير الموارد...`, LogLevel.INFO);
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
