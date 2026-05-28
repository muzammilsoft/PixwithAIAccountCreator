import axios from 'axios';
import FormData from 'form-data';

export async function uploadScreenshot(buffer: Buffer): Promise<string | null> {
    // Priority: Catbox.moe as requested by the user
    try {
        const form = new FormData();
        form.append('fileToUpload', buffer, { filename: 'screenshot.png' });
        form.append('reqtype', 'fileupload');

        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });

        if (typeof response.data === 'string' && response.data.startsWith('http')) {
            return response.data.trim();
        }
    } catch (e: any) {
        console.error('Catbox upload failed:', e.message);
    }

    // Fallback: file.io
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'screenshot.png' });

        const response = await axios.post('https://file.io/?expires=1d', form, {
            headers: form.getHeaders(),
            timeout: 20000
        });

        if (response.data && response.data.success) {
            return response.data.link;
        }
    } catch (e: any) {
        console.error('file.io upload failed:', e.message);
    }

    return null;
}
