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
    console.log(`[Socket] New connection: ${socket.id}`);

    // Immediate log to confirm connection in the UI
    socket.emit('log', {
        message: `[${new Date().toLocaleString()}] تم الاتصال بنجاح. جاهز لاستقبال الأوامر.`,
        level: LogLevel.SUCCESS
    });

    socket.emit('status', { running: isRunning });

    socket.on('start', async (data) => {
        console.log('Received start command with data:', data);
        if (isRunning) {
            logger.log('البوت يعمل بالفعل.', LogLevel.WARNING);
            return;
        }

        try {
            isRunning = true;
            io.emit('status', { running: true });

            const { referralLink, proxies } = data;
            const proxyManager = new ProxyManager(proxies);

            logger.log(`تم استلام طلب البدء برابط إحالة: ${referralLink}`, LogLevel.INFO);
            if (proxyManager.hasProxies()) {
                logger.log(`تم تحميل ${proxies.length} بروكسي.`, LogLevel.INFO);
            } else {
                logger.log(`يتم العمل بدون بروكسي.`, LogLevel.WARNING);
            }

            while (isRunning) {
                const proxy = proxyManager.getNextProxy();
                if (proxy) {
                    logger.log(`استخدام بروكسي: ${proxy.host}:${proxy.port}`, LogLevel.INFO);
                }

                const success = await automation.createAccount(referralLink, proxy);

                if (success) {
                    logger.log(`✅ تم إنشاء الحساب بنجاح.`, LogLevel.SUCCESS);
                } else {
                    logger.log(`❌ فشلت المحاولة الحالية.`, LogLevel.ERROR);
                }

                if (!isRunning) {
                    logger.log('تم إيقاف الدورة التكرارية.', LogLevel.WARNING);
                    break;
                }

                logger.log(`الانتظار 5 ثوانٍ قبل المحاولة التالية...`, LogLevel.INFO);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } catch (err: any) {
            logger.log(`خطأ غير متوقع في المحرك الرئيسي: ${err.message}`, LogLevel.ERROR);
            isRunning = false;
            io.emit('status', { running: false });
        }
    });

    socket.on('stop', () => {
        console.log('Received stop command');
        isRunning = false;
        io.emit('status', { running: false });
        logger.log(`🛑 تم طلب إيقاف البوت... سيتم التوقف بعد إكمال العملية الحالية.`, LogLevel.WARNING);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
