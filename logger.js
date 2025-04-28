import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 创建日志目录
const logDir = path.join(__dirname, 'logs');

// 配置日志格式
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
        // 为不同级别的日志添加不同的前缀
        const prefix = {
            info: 'ℹ️',
            error: '❌',
            warn: '⚠️',
            debug: '🔍'
        }[level] || '📝';
        
        return `${timestamp} ${prefix} [${level.toUpperCase()}] ${message}`;
    })
);

// 创建logger实例
const logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
        // 控制台输出
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        // 文件输出 - 所有日志
        new winston.transports.File({
            filename: path.join(logDir, 'all.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        // 文件输出 - 错误日志
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        // 文件输出 - 交易日志
        new winston.transports.File({
            filename: path.join(logDir, 'transactions.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        })
    ]
});

export default logger; 