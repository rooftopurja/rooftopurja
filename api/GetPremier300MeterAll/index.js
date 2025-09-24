module.exports = async function (context, req) {
    context.log('GetPremier300MeterAll function processed a request.');
    
    // Simple response that definitely works
    context.res = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
            message: "GetPremier300MeterAll is working!",
            items: [
                { test: "data1", Plant_ID: 1 },
                { test: "data2", Plant_ID: 2 }
            ]
        }
    };
};
