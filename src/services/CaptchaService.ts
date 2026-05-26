import axios from 'axios';

export class CaptchaService {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async solveReCaptcha(siteKey: string, url: string): Promise<string> {
        if (!this.apiKey) throw new Error('Captcha API Key is missing');

        // Initial request
        const res = await axios.get(`http://2captcha.com/in.php?key=${this.apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${url}&json=1`);

        if (res.data.status !== 1) {
            throw new Error(`2Captcha Error: ${res.data.request}`);
        }

        const requestId = res.data.request;

        // Polling
        for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const checkRes = await axios.get(`http://2captcha.com/res.php?key=${this.apiKey}&action=get&id=${requestId}&json=1`);

            if (checkRes.data.status === 1) {
                return checkRes.data.request;
            }

            if (checkRes.data.request !== 'CAPCHA_NOT_READY') {
                throw new Error(`2Captcha Error: ${checkRes.data.request}`);
            }
        }

        throw new Error('2Captcha Timeout');
    }

    async solveHCaptcha(siteKey: string, url: string): Promise<string> {
        if (!this.apiKey) throw new Error('Captcha API Key is missing');

        const res = await axios.get(`http://2captcha.com/in.php?key=${this.apiKey}&method=hcaptcha&sitekey=${siteKey}&pageurl=${url}&json=1`);

        if (res.data.status !== 1) {
            throw new Error(`2Captcha Error: ${res.data.request}`);
        }

        const requestId = res.data.request;

        for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const checkRes = await axios.get(`http://2captcha.com/res.php?key=${this.apiKey}&action=get&id=${requestId}&json=1`);

            if (checkRes.data.status === 1) {
                return checkRes.data.request;
            }

            if (checkRes.data.request !== 'CAPCHA_NOT_READY') {
                throw new Error(`2Captcha Error: ${checkRes.data.request}`);
            }
        }

        throw new Error('2Captcha Timeout');
    }
}
