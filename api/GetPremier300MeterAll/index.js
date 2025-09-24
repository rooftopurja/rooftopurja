module.exports = async function (context, req) {
    context.log('No-dependencies GetPremier300MeterAll started');
    
    try {
        // Return mock data without Azure dependencies
        const items = [
            { 
                Meter_ID: "MTR001", 
                Meter_Serial_No: "SN12345",
                Meter_Make: "Secure",
                Meter_Model: "Premier300",
                Meter_Type: "DLMS",
                Total_Yield: 1500,
                Yield_Unit: "MWh",
                Incremental_Daily_Yield_KWH: 250,
                Date_Time: "2024-01-15T10:30:00",
                Plant_ID: 1
            },
            { 
                Meter_ID: "MTR002",
                Meter_Serial_No: "SN12346", 
                Meter_Make: "Secure",
                Meter_Model: "Premier300",
                Meter_Type: "DLMS",
                Total_Yield: 1800,
                Yield_Unit: "MWh",
                Incremental_Daily_Yield_KWH: 300,
                Date_Time: "2024-01-15T10:30:00",
                Plant_ID: 2
            }
        ];
        
        context.res = {
            status: 200, 
            headers: {'content-type':'application/json'},
            body: {items}
        };
        context.log('No-dependencies function completed successfully');
        
    } catch (error) {
        context.log.error('Error in no-dependencies function:', error);
        context.res = {
            status: 500, 
            headers: {'content-type':'application/json'},
            body: {error: error.message}
        };
    }
};
