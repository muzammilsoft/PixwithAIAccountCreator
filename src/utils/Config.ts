import dotenv from 'dotenv';
dotenv.config();

export const config = {
    referralLink: process.env.REFERRAL_LINK || 'https://pixwith.ai/referral/default',
    accountCount: parseInt(process.env.ACCOUNT_COUNT || '10'),
    mailProvider: process.env.MAIL_PROVIDER || 'moakt',
    captchaKey: process.env.CAPTCHA_KEY || '',
    proxies: process.env.PROXIES || '',
    headless: process.env.HEADLESS !== 'false',
    delayBetweenAccounts: parseInt(process.env.DELAY_BETWEEN_ACCOUNTS || '10000'),
};
