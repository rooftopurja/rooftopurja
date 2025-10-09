// Test the function logic locally
const testFunction = require('./api/GetPremier300MeterAll/index.js');

const mockContext = {
    log: console.log,
    res: null
};

const mockReq = {};

console.log('Testing function locally...');
testFunction(mockContext, mockReq).then(() => {
    console.log('Function completed');
    console.log('Response:', JSON.stringify(mockContext.res, null, 2));
}).catch(err => {
    console.error('Function error:', err);
});


