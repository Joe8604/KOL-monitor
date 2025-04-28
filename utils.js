/**
 * 工具函数集合
 */

/**
 * 延迟执行函数
 * @param {number} ms - 延迟的毫秒数
 * @returns {Promise} - 返回一个Promise对象
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

import dns from 'dns';
import net from 'net';
import https from 'https';
import http from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import logger from './logger.js';

// 配置代理
const proxyUrl = process.env.PROXY_URL;
let agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

// 测试DNS解析
export async function testDNS(hostname) {
    try {
        logger.info(`\n测试DNS解析 ${hostname}...`);
        const addresses = await dns.promises.resolve4(hostname);
        logger.info(`DNS解析结果: ${addresses.join(', ')}`);
        return addresses;
    } catch (error) {
        logger.error(`DNS解析失败: ${error.message}`);
        return null;
    }
}

// 测试TCP连接
export async function testTCP(hostname, port = 443) {
    const MAX_RETRIES = 3;
    const TIMEOUT = 5000;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                
                socket.setTimeout(TIMEOUT);
                
                socket.on('connect', () => {
                    const localPort = socket.localPort;
                    socket.destroy();
                    logger.info(`TCP连接成功，本地端口: ${localPort}`);
                    resolve(true);
                });
                
                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('连接超时'));
                });
                
                socket.on('error', (error) => {
                    socket.destroy();
                    reject(error);
                });
                
                socket.connect(port, hostname);
            });
        } catch (error) {
            logger.error(`TCP连接失败 (第 ${i + 1} 次): ${error.message}`);
            if (i < MAX_RETRIES - 1) {
                await sleep(2000);
            } else {
                throw error;
            }
        }
    }
}

// 测试HTTPS连接
export async function testHTTPS(hostname) {
    const MAX_RETRIES = 3;
    const TIMEOUT = 5000;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const options = {
                    hostname: hostname,
                    port: 443,
                    path: '/',
                    method: 'GET',
                    timeout: TIMEOUT,
                    rejectUnauthorized: false,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': '*/*',
                        'Connection': 'keep-alive'
                    }
                };

                // 如果设置了代理，使用代理连接
                if (process.env.PROXY_URL) {
                    const proxyUrl = new URL(process.env.PROXY_URL);
                    logger.info(`通过代理 ${proxyUrl.hostname}:${proxyUrl.port} 连接...`);
                    options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
                }

                const req = https.request(options, (res) => {
                    logger.info(`HTTPS状态码: ${res.statusCode}`);
                    logger.info(`HTTPS响应头: ${JSON.stringify(res.headers, null, 2)}`);
                    
                    if (res.statusCode === 302 || res.statusCode === 301) {
                        const location = res.headers.location;
                        logger.info(`检测到重定向: ${location}`);
                        const redirectHost = new URL(location).hostname;
                        logger.info(`测试重定向目标: ${redirectHost}`);
                        testHTTPS(redirectHost).then(resolve).catch(reject);
                    } else {
                        resolve(true);
                    }
                });

                req.on('error', (error) => {
                    logger.error(`HTTPS请求错误: ${error.message}`);
                    reject(error);
                });

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('HTTPS请求超时'));
                });

                req.end();
            });
        } catch (error) {
            logger.error(`HTTPS连接失败 (第 ${i + 1} 次): ${error.message}`);
            if (i < MAX_RETRIES - 1) {
                await sleep(2000);
            } else {
                throw error;
            }
        }
    }
}

// 测试HTTP连接
export async function testHTTP(hostname) {
    return new Promise((resolve) => {
        const options = {
            hostname: hostname,
            port: 80,
            path: '/',
            method: 'HEAD',
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            logger.info(`HTTP状态码: ${res.statusCode}`);
            resolve(res.statusCode === 200);
        });

        req.on('error', (error) => {
            logger.error(`HTTP请求错误: ${error.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            logger.error('HTTP请求超时');
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}

// 测试网络延迟
export async function testLatency(hostname) {
    const MAX_RETRIES = 3;
    const TIMEOUT = 5000;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const start = Date.now();
                const socket = new net.Socket();
                
                socket.setTimeout(TIMEOUT);
                
                socket.on('connect', () => {
                    const latency = Date.now() - start;
                    socket.destroy();
                    logger.info(`网络延迟: ${latency}ms`);
                    resolve(latency);
                });
                
                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('连接超时'));
                });
                
                socket.on('error', (error) => {
                    socket.destroy();
                    reject(error);
                });
                
                socket.connect(443, hostname);
            });
        } catch (error) {
            logger.error(`测量网络延迟失败 (第 ${i + 1} 次): ${error.message}`);
            if (i < MAX_RETRIES - 1) {
                await sleep(2000);
            } else {
                throw error;
            }
        }
    }
}

// 测试代理连接
export async function testProxy(proxyUrl) {
    try {
        logger.info(`\n测试代理连接 ${proxyUrl}...`);
        const url = new URL(proxyUrl);
        
        // 测试代理服务器DNS解析
        logger.info(`测试代理服务器DNS解析 ${url.hostname}...`);
        const addresses = await dns.promises.resolve4(url.hostname);
        logger.info(`代理服务器IP: ${addresses.join(', ')}`);
        
        // 测试代理服务器TCP连接
        logger.info(`测试代理服务器TCP连接 ${url.hostname}:${url.port}...`);
        const tcpConnected = await testTCP(url.hostname, parseInt(url.port));
        logger.info(`代理服务器TCP连接: ${tcpConnected ? '✅ 成功' : '❌ 失败'}`);
        
        return tcpConnected;
    } catch (error) {
        logger.error(`代理测试失败: ${error.message}`);
        return false;
    }
}

// 测试网络连接
export async function testNetworkConnection(endpoint) {
    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const url = new URL(endpoint);
            const hostname = url.hostname;

            // 测试DNS解析
            logger.info(`\n测试DNS解析 ${hostname}...`);
            const addresses = await dns.promises.resolve4(hostname);
            logger.info(`DNS解析结果: ${addresses.join(', ')}`);

            // 测试网络延迟
            logger.info(`测试网络延迟...`);
            await testLatency(hostname);

            // 测试TCP连接
            logger.info(`尝试TCP连接到 ${hostname}:443...`);
            await testTCP(hostname);

            // 测试HTTPS连接
            logger.info(`测试HTTPS连接...`);
            await testHTTPS(hostname);

            return true;
        } catch (error) {
            logger.error(`网络连接测试失败 (第 ${i + 1} 次): ${error.message}`);
            if (i < MAX_RETRIES - 1) {
                await sleep(2000);
            } else {
                throw error;
            }
        }
    }
}

// 验证Bot Token格式
export function validateBotToken(token) {
    if (!token) {
        throw new Error('Bot Token不能为空');
    }
    
    // 检查Token格式
    const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!tokenRegex.test(token)) {
        throw new Error('Bot Token格式不正确，应为数字:字母数字组合');
    }
    
    // 检查Token长度
    const parts = token.split(':');
    if (parts.length !== 2) {
        throw new Error('Bot Token格式不正确，应包含一个冒号');
    }
    
    // 检查Bot ID
    const botId = parts[0];
    if (!/^\d+$/.test(botId)) {
        throw new Error('Bot ID必须为数字');
    }
    
    // 检查Token哈希
    const tokenHash = parts[1];
    if (tokenHash.length < 30) {
        throw new Error('Token哈希长度不足');
    }
    
    return true;
}

// 检查Token状态
export async function checkTokenStatus(token) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            logger.info(`\n检查Token状态 (第 ${attempt} 次尝试)...`);
            
            // 首先测试网络连接
            const networkStatus = await testNetworkConnection('https://api.telegram.org');
            if (!networkStatus) {
                throw new Error('网络连接测试失败');
            }

            // 配置fetch选项
            const fetchOptions = {
                method: 'GET',
                timeout: 10000, // 增加超时时间
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            };

            // 尝试不同的API端点
            const endpoints = [
                'https://api.telegram.org',
                'https://api1.telegram.org',
                'https://api2.telegram.org'
            ];

            for (const endpoint of endpoints) {
                try {
                    logger.info(`尝试使用端点: ${endpoint}`);
                    const response = await fetch(`${endpoint}/bot${token}/getMe`, fetchOptions);
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        logger.error(`端点 ${endpoint} 返回错误: ${JSON.stringify(errorData)}`);
                        continue;
                    }
                    
                    const data = await response.json();
                    if (data.ok) {
                        logger.info('Token状态: ✅ 有效');
                        logger.info(`Bot信息: ${JSON.stringify(data.result, null, 2)}`);
                        return true;
                    }
                } catch (error) {
                    logger.error(`端点 ${endpoint} 请求失败: ${error.message}`);
                    continue;
                }
            }
            
            throw new Error('所有API端点均不可用');
        } catch (error) {
            logger.error(`Token状态检查失败 (第 ${attempt} 次): ${error.message}`);
            if (error.message.includes('fetch failed')) {
                logger.error('网络请求失败，请检查网络连接或代理设置');
            }
            
            if (attempt < MAX_RETRIES) {
                logger.info(`等待 ${RETRY_DELAY/1000} 秒后重试...`);
                await sleep(RETRY_DELAY);
            } else {
                logger.error('Token状态检查失败，已达到最大重试次数');
                return false;
            }
        }
    }
} 