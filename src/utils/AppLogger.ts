import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';

export enum LogLevel {
    INFO = 'blue',
    SUCCESS = 'green',
    ERROR = 'red',
    WARNING = 'yellow'
}

export class AppLogger {
    private io: Server | null = null;
    private logFilePath = path.join(process.cwd(), 'data', 'logs.log');

    setIo(io: Server) {
        this.io = io;
    }

    log(message: string, level: LogLevel = LogLevel.INFO) {
        const timestamp = new Date().toLocaleString();
        const logEntry = `[${timestamp}] ${message}`;

        console.log(logEntry);

        // Send to WebSocket
        if (this.io) {
            this.io.emit('log', { message: logEntry, level });
        }

        // Save to file
        const logDir = path.dirname(this.logFilePath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(this.logFilePath, logEntry + '\n');
    }

    sendScreenshot(base64Data: string, publicUrl?: string) {
        if (this.io) {
            this.io.emit('screenshot', { data: base64Data, publicUrl });
        }
        if (publicUrl) {
            this.log(`📸 Screenshot available at: ${publicUrl}`, LogLevel.INFO);
        }
    }
}

export const logger = new AppLogger();
