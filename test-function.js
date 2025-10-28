const http = require('http');

// Simple test to see if the function logic works
const mockContext = {
    log: console.log,
    res: null
};

const mockReq = {};

// Load and run the function
const functionCode = require('./api/GetPremier300MeterAll/index.js');
functionCode(mockContext, mockReq).then(() => {
    console.log('Function executed successfully');
    console.log('Response:', mockContext.res);
}).catch(err => {
    console.error('Function error:', err);
});