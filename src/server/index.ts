import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { logger, LogLevel } from '../utils/AppLogger';
import { PixwithAutomation } from '../automation/PixwithAutomation';
import { ProxyManager } from '../utils/ProxyManager';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(process.cwd(), 'public')));

logger.setIo(io);

let isRunning = false;

io.on('connection', (socket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    socket.emit('log', {
        message: `[${new Date().toLocaleString()}] تم الاتصال بنجاح.`,
        level: LogLevel.SUCCESS
    });

    socket.emit('status', { running: isRunning });

    socket.on('start', async (data) => {
        if (isRunning) return;

        try {
            isRunning = true;
            io.emit('status', { running: true });

            const { referralLink, proxies, captchaKey, useYopmail } = data;
            const proxyManager = new ProxyManager(proxies);
            const automation = new PixwithAutomation(captchaKey);

            logger.log(`تم استلام طلب البدء. استخدام Yopmail: ${useYopmail ? 'نعم' : 'لا'}`, LogLevel.INFO);

            while (isRunning) {
                const proxy = proxyManager.getNextProxy();
                const success = await automation.createAccount(referralLink, proxy, useYopmail);

                if (!isRunning) break;

                logger.log(`الانتظار 10 ثوانٍ قبل المحاولة التالية...`, LogLevel.INFO);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        } catch (err: any) {
            logger.log(`خطأ: ${err.message}`, LogLevel.ERROR);
            isRunning = false;
            io.emit('status', { running: false });
        }
    });

    socket.on('stop', () => {
        isRunning = false;
        io.emit('status', { running: false });
        logger.log(`🛑 تم طلب إيقاف البوت...`, LogLevel.WARNING);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
