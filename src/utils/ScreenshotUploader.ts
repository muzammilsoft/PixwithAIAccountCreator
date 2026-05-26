import axios from 'axios';
import FormData from 'form-data';

export async function uploadScreenshot(buffer: Buffer): Promise<string | null> {
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'screenshot.png' });

        // Using file.io as a fallback/alternative for simple temporary sharing
        const response = await axios.post('https://file.io/?expires=1d', form, {
            headers: form.getHeaders(),
        });

        if (response.data && response.data.success) {
            return response.data.link;
        }
        return null;
    } catch (e) {
        console.error('Failed to upload screenshot to file.io:', e);
        // Fallback to catbox if file.io fails
        try {
            const form = new FormData();
            form.append('fileToUpload', buffer, { filename: 'screenshot.png' });
            form.append('reqtype', 'fileupload');
            const catResponse = await axios.post('https://catbox.moe/user/api.php', form, {
                headers: form.getHeaders(),
            });
            if (typeof catResponse.data === 'string' && catResponse.data.startsWith('http')) {
                return catResponse.data;
            }
        } catch (e2) {}
        return null;
    }
}
