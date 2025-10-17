/** Compatibility endpoint for the Meter page.
 * Returns: { plants: [{ id: "1", name: "..." }, ...] }
 */
import fetch from "node-fetch";

export default async function (context, req) {
  try {
    // Call our existing endpoint (works on both custom + default hosts)
    const base = process.env.WEBSITE_HOSTNAME
      ? `https://${process.env.WEBSITE_HOSTNAME}`
      : ""; // SWA will treat relative fetch as same host

    // Prefer relative to avoid CORS issues inside SWA
    const url = base ? `${base}/api/plants` : `/api/plants`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`plants endpoint ${r.status}`);

    const data = await r.json();
    // If the upstream returns already in { plants: [...] } just proxy it.
    // Otherwise, normalize to that shape.
    const plants = Array.isArray(data?.plants)
      ? data.plants
      : (Array.isArray(data) ? data : []);

    context.res = { status: 200, headers: { "content-type": "application/json" }, body: { plants } };
  } catch (err) {
    context.log.error("PlantDirectory error:", err?.message || err);
    context.res = { status: 500, body: { error: String(err?.message || err) } };
  }
}
