import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import winston from 'winston';

// 加载环境变量
dotenv.config();

// 配置日志
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'test-email.log' })
    ]
});

// 获取环境变量
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

// 验证环境变量
if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) {
    logger.error('缺少必要的环境变量：EMAIL_USER, EMAIL_PASS 或 EMAIL_TO');
    process.exit(1);
}

// 创建邮件发送器
const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    debug: true,
    logger: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
});

// 测试邮件发送
async function testEmail() {
    try {
        logger.info('开始测试邮件发送...');
        logger.info(`发件人: ${EMAIL_USER}`);
        logger.info(`收件人: ${EMAIL_TO}`);

        const mailOptions = {
            from: EMAIL_USER,
            to: EMAIL_TO,
            subject: '🔔 KOL监控系统 - 测试邮件',
            text: '这是一封测试邮件，用于验证邮件发送功能是否正常工作。',
            html: `
                <h2>KOL监控系统测试邮件</h2>
                <p>这是一封测试邮件，用于验证邮件发送功能是否正常工作。</p>
                <p>发送时间: ${new Date().toLocaleString()}</p>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info('✅ 邮件发送成功');
        logger.info(`邮件 ID: ${info.messageId}`);
        logger.info(`接收地址: ${info.accepted.join(', ')}`);
    } catch (error) {
        logger.error('❌ 邮件发送失败:', error.message);
        logger.error('错误详情:', {
            code: error.code,
            response: error.response,
            responseCode: error.responseCode,
            command: error.command,
            stack: error.stack
        });
        
        if (error.code === 'EAUTH') {
            logger.error('认证失败，请检查邮箱账号和密码是否正确');
            logger.error('如果使用Gmail，请确保：');
            logger.error('1. 启用了"不太安全的应用访问"或');
            logger.error('2. 使用了应用专用密码（App Password）');
        } else if (error.code === 'ECONNECTION') {
            logger.error('连接失败，请检查网络连接和SMTP服务器设置');
        } else if (error.code === 'ETIMEDOUT') {
            logger.error('连接超时，请检查网络连接');
        }
    }
}

// 运行测试
testEmail().catch(error => {
    logger.error('测试程序出错:', error.message);
    process.exit(1);
}); 