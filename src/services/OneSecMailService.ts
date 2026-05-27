import axios from 'axios';
import { logger, LogLevel } from '../utils/AppLogger';

export class OneSecMailService {
    private readonly baseUrl = 'https://www.1secmail.com/api/v1/';

    async generateEmail(): Promise<string> {
        const domainsResponse = await axios.get(`${this.baseUrl}?action=getDomainList`);
        const domains = domainsResponse.data;
        const domain = domains[0] || '1secmail.com';
        const login = Math.random().toString(36).substring(2, 10);
        return `${login}@${domain}`;
    }

    async getVerificationCode(email: string): Promise<string | null> {
        try {
            const [login, domain] = email.split('@');
            const response = await axios.get(`${this.baseUrl}?action=getMessages&login=${login}&domain=${domain}`);
            const messages = response.data;

            if (messages.length === 0) return null;

            // Get the latest message
            const messageId = messages[0].id;
            const messageDetail = await axios.get(`${this.baseUrl}?action=readMessage&login=${login}&domain=${domain}&id=${messageId}`);

            const body = messageDetail.data.textBody || messageDetail.data.body || '';
            const codeMatch = body.match(/[A-Z0-9]{6}/);

            return codeMatch ? codeMatch[0] : null;
        } catch (error: any) {
            logger.log(`Error checking 1secmail: ${error.message}`, LogLevel.ERROR);
            return null;
        }
    }
}
