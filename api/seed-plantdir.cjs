const { TableClient } = require("@azure/data-tables");
const conn = process.env.TABLES_CONN_STRING;
const table = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
(async () => {
  const c = TableClient.fromConnectionString(conn, table);
  await c.createTable().catch(()=>{});
  const rows = [
    { partitionKey:"P1", rowKey:"1", Plant_ID:1, Plant_Name:"Doordarshan_Kendra_Dehradun", Meters:"Meter_1", Inverters:"Inverter_1", PLC_AC:"plcaccontrol_1", Sensors:"Sensors_1" },
    { partitionKey:"P2", rowKey:"2", Plant_ID:2, Plant_Name:"EPFO_Dehradun",               Meters:"Meter_2", Inverters:"Inverter_2", PLC_AC:"plcaccontrol_2", Sensors:"Sensors_2" }
  ];
  for (const e of rows) await c.upsertEntity(e, "Replace");
  console.log("Seeded", rows.length);
})();
