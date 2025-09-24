module.exports = async function (context, req) {
    context.log('GetPremier300MeterAll function processed a request.');

    try {
        // Return mock data
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
            body: {
                success: true,
                data: items,
                count: items.length,
                message: "GetPremier300MeterAll function working correctly!"
            },
            headers: {
                'Content-Type': 'application/json'
            }
        };

    } catch (error) {
        context.log.error('Error in GetPremier300MeterAll:', error);
        
        context.res = {
            status: 500,
            body: {
                success: false,
                error: error.message
            },
            headers: {
                'Content-Type': 'application/json'
            }
        };
    }
};
