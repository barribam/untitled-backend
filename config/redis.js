const Redis = require('ioredis');

// Create a Redis client
const redisConfig = {
    // Connection
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined, // Enable TLS if needed
    password: process.env.REDIS_PASSWORD,

    // Retry Strategy
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000); // Exponential backoff with max 2sec delay
        return delay;
    },

    // Reconnect Strategy
    reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
            return true; // Reconnect for READONLY error
        }
        return false;
    },

    // Connection options
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
    lazyConnect: false, // Set to true if you want to delay connection until first command

    // Timeouts
    connectTimeout: 10000, // 10 seconds
    commandTimeout: 5000,  // 5 seconds
    keepAlive: 30000,     // 30 seconds
};

const redis = new Redis(redisConfig)

redis.ping()
    .then(result => console.log('Connected to Redis:', result))
    .catch(err => console.error('Redis error:', err));

module.exports = redis
