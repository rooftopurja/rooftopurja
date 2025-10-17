/**
 * Returns { plants: [{ id, name }] }.
 * If env PLANTS_JSON is set to a JSON array, that is used.
 * Else we return a small safe fallback list so UI keeps working.
 */
export default async function (context, req) {
  try {
    let plants;
    // Optional: allow overriding via environment
    const raw = process.env.PLANTS_JSON;
    if (raw) {
      try { plants = JSON.parse(raw); } catch { /* fall back */ }
    }
    if (!Array.isArray(plants)) {
      plants = [
        { id: "1",  name: "ESIC_Kalaburagi_Hospital" },
        { id: "9",  name: "OLF_Dehradun_Admin" },
        { id: "11", name: "ESIC_Kalaburagi_PRA_Building" }
      ];
    }
    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { plants }
    };
  } catch (e) {
    context.log.error("plants endpoint error:", e?.message || e);
    context.res = { status: 500, body: { error: String(e?.message || e) } };
  }
}
