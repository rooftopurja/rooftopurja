module.exports = async function (context, req) {
    context.log('Test function executed');

    context.res = {
        status: 200,
        body: {
            message: 'Test function is working!',
            timestamp: new Date().toISOString(),
            nodeVersion: process.version
        },
        headers: {
            'Content-Type': 'application/json'
        }
    };
};
