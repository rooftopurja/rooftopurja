const { TableClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");

// Safe date extraction for "YYYY-MM-DD"
function entityDate(e){
  if (typeof e.Date === "string" && e.Date.length>=10) return e.Date.slice(0,10);
  if (typeof e.Date_Time === "string" && e.Date_Time.length>=10) return e.Date_Time.slice(0,10);
  return null;
}

async function getTableClient(tableName){
  try {
    const isAzure = !!process.env.WEBSITE_SITE_NAME;
    if (isAzure){
      const endpoint = process.env.TABLES_ENDPOINT || `https://${process.env.STORAGE_ACCOUNT_NAME}.table.core.windows.net`;
      const cred = new DefaultAzureCredential();
      return new TableClient(endpoint, tableName, cred);
    }
    const conn = process.env.STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
    return TableClient.fromConnectionString(conn, tableName);
  } catch (error) {
    throw new Error(`Table client error: ${error.message}`);
  }
}

module.exports = async function (context, req) {
  try {
    context.log('GetPremier300MeterAll function started');
    
    // Inputs with defaults
    const start = (req.query.start||"").slice(0,10);
    const end = (req.query.end||"").slice(0,10);
    const top = Math.min(parseInt(req.query.top||"2000",10)||2000, 5000);
    const plantIdsReq = (req.query.plantIds||"").split(",").map(s=>s.trim()).filter(Boolean);

    // Get table client
    const premier = await getTableClient(process.env.PREMIER300_TABLE || "Premier300Meter");
    
    const finalPlants = plantIdsReq.length ? plantIdsReq : null;

    // Gather rows with error handling
    const items = [];
    let count = 0;
    
    try {
      for await (const e of premier.listEntities()){
        if (finalPlants && !finalPlants.includes(String(e.Plant_ID||""))) continue;
        const d = entityDate(e);
        if (start && d && d<start) continue;
        if (end && d && d>end) continue;

        items.push({
          Meter_ID: e.Meter_ID ?? e.partitionKey ?? "",
          Meter_Serial_No: e.Meter_Serial_No ?? "",
          Meter_Make: e.Meter_Make ?? "Secure",
          Meter_Model: e.Meter_Model ?? "Premier300",
          Meter_Type: e.Meter_Type ?? "DLMS",
          Total_Yield: Number(e.Total_Yield ?? 0),
          Yield_Unit: e.Yield_Unit ?? (e.Total_Yield_Unit || "MWh"),
          Incremental_Daily_Yield_KWH: Number(e.Incremental_Daily_Yield_KWH ?? 0),
          Date_Time: e.Date_Time ?? "",
          Plant_ID: e.Plant_ID ?? null
        });

        count++; 
        if (count>=top) break;
      }
    } catch (tableError) {
      context.log.error('Table access error:', tableError);
      // Return empty result instead of failing
      context.res = {status:200, headers:{'content-type':'application/json'}, body:{items: [], error: "Table access issue"}};
      return;
    }

    context.res = {status:200, headers:{'content-type':'application/json'}, body:{items}};
    context.log(`GetPremier300MeterAll function completed: ${items.length} items`);
    
  } catch (err){
    context.log.error("GetPremier300MeterAll error:", err);
    context.res = {status:500, headers:{'content-type':'application/json'}, body:{error: "Function execution failed: " + String(err.message||err)}};
  }
};
