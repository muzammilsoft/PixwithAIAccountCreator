import axios from 'axios';

export interface MailAccount {
    address: string;
    token: string;
}

export interface IMailService {
    generateEmail(): Promise<string | MailAccount>;
    getVerificationCode(identifier: any): Promise<string | null>;
}

export class MailTmService implements IMailService {
    private readonly baseUrl = 'https://api.mail.tm';

    async generateEmail(): Promise<MailAccount> {
        const domainResponse = await axios.get(`${this.baseUrl}/domains`);
        const domain = domainResponse.data['hydra:member'][0].domain;
        const randomStr = Math.random().toString(36).substring(2, 10);
        const address = `${randomStr}@${domain}`;
        const password = 'Password123!';

        await axios.post(`${this.baseUrl}/accounts`, {
            address,
            password
        });

        const tokenResponse = await axios.post(`${this.baseUrl}/token`, {
            address,
            password
        });

        return {
            address,
            token: tokenResponse.data.token
        };
    }

    async getVerificationCode(token: string): Promise<string | null> {
        try {
            const messagesResponse = await axios.get(`${this.baseUrl}/messages`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const messages = messagesResponse.data['hydra:member'];
            if (messages.length === 0) return null;

            const messageId = messages[0].id;
            const messageDetail = await axios.get(`${this.baseUrl}/messages/${messageId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const body = messageDetail.data.text || messageDetail.data.intro || messageDetail.data.html[0] || '';
            const codeMatch = body.match(/[A-Z0-9]{6}/);

            return codeMatch ? codeMatch[0] : null;
        } catch (e) {
            return null;
        }
    }
}
