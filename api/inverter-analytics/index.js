module.exports = async function (context, req) {
  const path = (context.bindingData && context.bindingData.path) || "";
  if (path.toLowerCase() === "ping") {
    context.res = { status: 200, body: "ok" };
    return;
  }
  const resp = {
    serverTimeUtc: new Date().toISOString(),
    kpis: { total_yield: null, unit: null, cuf: null, pr: null },
    power: [],
    yield: []
  };
  context.res = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(resp) };
};
