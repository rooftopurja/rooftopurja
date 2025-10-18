export default async function (context, req) {
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "gray-desert-0663e5d00.2.azurestaticapps.net";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const target = `${proto}://${host}/api/PlantDirectory`;
  context.res = { status: 307, headers: { Location: target } };
}
