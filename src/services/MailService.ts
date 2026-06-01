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
    private readonly headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    async generateEmail(): Promise<MailAccount> {
        const domainResponse = await axios.get(`${this.baseUrl}/domains`, { headers: this.headers });
        const domain = domainResponse.data['hydra:member'][0].domain;
        const randomStr = Math.random().toString(36).substring(2, 10);
        const address = `${randomStr}@${domain}`;
        const password = 'Password123!';

        await axios.post(`${this.baseUrl}/accounts`, {
            address,
            password
        }, { headers: this.headers });

        const tokenResponse = await axios.post(`${this.baseUrl}/token`, {
            address,
            password
        }, { headers: this.headers });

        return {
            address,
            token: tokenResponse.data.token
        };
    }

    async getVerificationCode(token: string): Promise<string | null> {
        try {
            const messagesResponse = await axios.get(`${this.baseUrl}/messages`, {
                headers: {
                    ...this.headers,
                    Authorization: `Bearer ${token}`
                }
            });

            const messages = messagesResponse.data['hydra:member'];
            if (messages.length === 0) return null;

            const messageId = messages[0].id;
            const messageDetail = await axios.get(`${this.baseUrl}/messages/${messageId}`, {
                headers: {
                    ...this.headers,
                    Authorization: `Bearer ${token}`
                }
            });

            const body = messageDetail.data.text || messageDetail.data.intro || messageDetail.data.html[0] || '';
            // Pixwith code is usually 6 digits
            const codeMatch = body.match(/\b(\d{6})\b/);

            return codeMatch ? codeMatch[1] : null;
        } catch (e) {
            return null;
        }
    }
}
