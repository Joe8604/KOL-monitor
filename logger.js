// 简单的日志记录器
const logger = {
    info: (message) => {
        console.log(`[INFO] ${message}`);
    },
    warn: (message) => {
        console.warn(`[WARN] ${message}`);
    },
    error: (message) => {
        console.error(`[ERROR] ${message}`);
    }
};

export default logger; 