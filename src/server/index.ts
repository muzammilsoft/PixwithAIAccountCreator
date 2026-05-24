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
const automation = new PixwithAutomation();

io.on('connection', (socket) => {
    socket.emit('status', { running: isRunning });

    socket.on('start', async (data) => {
        if (isRunning) return;
        isRunning = true;
        io.emit('status', { running: true });

        const { referralLink, proxies } = data;
        const proxyManager = new ProxyManager(proxies);

        logger.log(`بدء العمل برابط الإحالة: ${referralLink}`, LogLevel.INFO);
        if (proxyManager.hasProxies()) {
            logger.log(`تم تحميل ${proxies.length} بروكسي.`, LogLevel.INFO);
        }

        while (isRunning) {
            const proxy = proxyManager.getNextProxy();
            const success = await automation.createAccount(referralLink, proxy);

            if (success) {
                logger.log(`تم إنشاء الحساب بنجاح، جاري بدء العملية التالية...`, LogLevel.SUCCESS);
            } else {
                logger.log(`فشلت المحاولة، سيتم إعادة المحاولة بعد 10 ثوانٍ...`, LogLevel.WARNING);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            if (!isRunning) break;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    });

    socket.on('stop', () => {
        isRunning = false;
        io.emit('status', { running: false });
        logger.log(`تم إيقاف البوت بواسطة المستخدم.`, LogLevel.WARNING);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
