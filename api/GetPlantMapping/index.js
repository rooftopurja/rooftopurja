const fs = require("fs");
const path = require("path");

module.exports = async function (context, req) {
  try {
    const dataPath = path.join(__dirname, "..", "_data", "plant-mapping.json");
    const raw = fs.readFileSync(dataPath, "utf8").trim();
    const json = JSON.parse(raw);

    // Expected shape: [{ Plant_ID: 1, Plant_Name: "XYZ", ...}, ...]
    // Normalize minimal fields for the UI
    const plants = json.map(p => ({
      Plant_ID: Number(p.Plant_ID ?? p.id ?? p.plant_id ?? 0),
      Plant_Name: String(p.Plant_Name ?? p.name ?? `Plant ${p.Plant_ID ?? ""}`).trim()
    }));

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, data: plants, count: plants.length }
    };
  } catch (err) {
    context.log.error("GetPlantMapping error:", err.message);
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: err.message }
    };
  }
};
