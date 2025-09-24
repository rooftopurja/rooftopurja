module.exports = async function (context, req) {
    context.res = {
        status: 200,
        body: {
            status: "healthy",
            timestamp: new Date().toISOString()
        },
        headers: {
            'Content-Type': 'application/json'
        }
    };
};
