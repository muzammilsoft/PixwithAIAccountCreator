import axios from 'axios';
import { logger, LogLevel } from '../utils/AppLogger';

export class OneSecMailService {
    private readonly baseUrl = 'https://www.1secmail.com/api/v1/';
    private readonly headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    async generateEmail(): Promise<string> {
        let domain = '1secmail.com';
        try {
            const domainsResponse = await axios.get(`${this.baseUrl}?action=getDomainList`, { headers: this.headers });
            const domains = domainsResponse.data;
            if (Array.isArray(domains) && domains.length > 0) {
                domain = domains[Math.floor(Math.random() * domains.length)];
            }
        } catch (e: any) {
            logger.log(`⚠️ فشل جلب قائمة الدومينات من 1secmail، استخدام الدومين الافتراضي.`, LogLevel.WARNING);
            const fallbacks = ['1secmail.com', '1secmail.org', '1secmail.net', 'esiix.com', 'wwjmp.com'];
            domain = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        const login = Math.random().toString(36).substring(2, 12);
        return `${login}@${domain}`;
    }

    async getVerificationCode(email: string): Promise<string | null> {
        try {
            const [login, domain] = email.split('@');
            const response = await axios.get(`${this.baseUrl}?action=getMessages&login=${login}&domain=${domain}`, { headers: this.headers });
            const messages = response.data;

            if (messages.length === 0) return null;

            // Get the latest message
            const messageId = messages[0].id;
            const messageDetail = await axios.get(`${this.baseUrl}?action=readMessage&login=${login}&domain=${domain}&id=${messageId}`, { headers: this.headers });

            const body = messageDetail.data.textBody || messageDetail.data.body || messageDetail.data.htmlBody || '';
            const codeMatch = body.match(/[A-Z0-9]{6}/);

            return codeMatch ? codeMatch[0] : null;
        } catch (error: any) {
            logger.log(`Error checking 1secmail: ${error.message}`, LogLevel.ERROR);
            return null;
        }
    }
}
