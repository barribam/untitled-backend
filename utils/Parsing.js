const safeJSONParse = (data, defaultValue = []) => {
    if (Array.isArray(data)) return data;
    try {
        return typeof data === 'string' ? JSON.parse(data) : defaultValue;
    } catch (error) {
        console.error('JSON Parse error:', error);
        return defaultValue;
    }
};

module.exports = { safeJSONParse }