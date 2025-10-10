const { DefaultAzureCredential, ManagedIdentityCredential } = require("@azure/identity");
const { TableClient } = require("@azure/data-tables");

const ACCOUNT_NAME = process.env.STORAGE_ACCOUNT_NAME || "solariothubstorage";
const ENDPOINT = `https://${ACCOUNT_NAME}.table.core.windows.net`;
const IST_OFFSET_MIN = 330;
const CANDIDATE_TABLES = ["SungrowInverter125KW","SungrowInverter100KW","SungrowInverter110KW","SungrowInverter80KW","SungrowInverter60KW","SungrowInverter50KW"];

const cache = new Map();
const cacheTTLms = 60 * 1000;
const cacheGet = k => { const h = cache.get(k); if (!h) return null; if (Date.now()-h.t>cacheTTLms) { cache.delete(k); return null; } return h.v; };
const cacheSet = (k,v) => cache.set(k,{t:Date.now(),v});

function toUtcISOStringFromIST(y,m,d,hh,mm){ const ist=Date.UTC(y,m-1,d,hh,mm); const utc=ist-IST_OFFSET_MIN*60*1000; return new Date(utc).toISOString(); }
function istFloor(date){ const utcMillis=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()); const istMillis=utcMillis+IST_OFFSET_MIN*60*1000; return new Date(istMillis); }
function parseDateParamIST(s){ const [y,m,d]=s.split("-").map(Number); const utc=Date.UTC(y,m-1,d,0,0)-IST_OFFSET_MIN*60*1000; return new Date(utc); }
function toYMD(istDate){ const y=istDate.getUTCFullYear(); const m=String(istDate.getUTCMonth()+1).padStart(2,"0"); const d=String(istDate.getUTCDate()).padStart(2,"0"); return `${y}-${m}-${d}`; }
const round2 = x => Math.round(x*100)/100;
function formatTotalYield(kWh){ if(kWh==null) return {value:null,unit:null}; if(kWh>=1_000_000) return {value:kWh/1_000_000,unit:"GWh"}; if(kWh>=1_000) return {value:kWh/1_000,unit:"MWh"}; return {value:kWh,unit:"kWh"}; }
function istDayUtcRange(istDay){ const y=istDay.getUTCFullYear(), m=istDay.getUTCMonth()+1, d=istDay.getUTCDate(); return [toUtcISOStringFromIST(y,m,d,0,0), toUtcISOStringFromIST(y,m,d,23,59)]; }
function lastNMonths(refIst,n){ const out=[]; const y0=refIst.getUTCFullYear(), m0=refIst.getUTCMonth()+1; for(let i=n-1;i>=0;i--){ let y=y0, m=m0-i; while(m<=0){m+=12;y-=1;} out.push({y,m}); } return out; }

const credential = new DefaultAzureCredential();

async function tableExists(name){
  try{
    const client = new TableClient(ENDPOINT, name, credential);
    for await (const _ of client.listEntities({ queryOptions: { top: 1 } })) { break; }
    return true;
  } catch(e){ return false; }
}
async function getActiveTables(){
  const ok = [];
  for (const name of CANDIDATE_TABLES){
    try {
      if (await tableExists(name)) ok.push(name);
    } catch (_) {}
  }
  return ok;
}
async function fetchEntitiesInRange(tableName, fromIso, toIso){
  const client = new TableClient(ENDPOINT, tableName, credential);
  const filter = `Timestamp ge datetime'${fromIso}' and Timestamp le datetime'${toIso}'`;
  const out=[]; for await (const ent of client.listEntities({ queryOptions: { filter } })) out.push(ent); return out;
}
function buildMapping(entities){ const map=new Map(); for(const e of entities){ const inv=e.Inverter_ID||e.InverterId||e.inverter_id; const pid=e.Plant_ID||e.PlantId||e.plant_id; if(inv&&pid&&!map.has(String(inv))) map.set(String(inv),String(pid)); } return map; }
function filterByPlant(entities, targetPlantId, inferredMap){
  if(!targetPlantId || targetPlantId.toLowerCase()==="all") return entities;
  const pidStr=String(targetPlantId); const out=[];
  for(const e of entities){
    const pid=e.Plant_ID||e.PlantId||e.plant_id;
    if(pid){ if(String(pid)===pidStr) out.push(e); continue; }
    const inv=e.Inverter_ID||e.InverterId||e.inverter_id;
    if(inv && inferredMap.has(String(inv)) && inferredMap.get(String(inv))===pidStr) out.push(e);
  }
  return out;
}
function aggregatePowerDayIST(entities, dayIST){
  const y=dayIST.getUTCFullYear(), m=dayIST.getUTCMonth()+1, d=dayIST.getUTCDate();
  const startIso=toUtcISOStringFromIST(y,m,d,5,0), endIso=toUtcISOStringFromIST(y,m,d,19,0);
  const start=new Date(startIso), end=new Date(endIso);
  const buckets=[]; for(let t=start.getTime(); t<=end.getTime(); t+=20*60*1000) buckets.push({t,ac:0,dc:0,n:0});
  const nearest=(ts)=>{ const i=Math.round((ts-start.getTime())/(20*60*1000)); return (i<0||i>=buckets.length)?-1:i; };
  for(const e of entities){
    const ts=new Date(e.timestamp||e.Timestamp); if(ts<start||ts>end) continue;
    const i=nearest(ts.getTime()); if(i<0) continue;
    const ac=Number(e.AC_Power ?? e.AC_Power_kW ?? e.AC ?? 0);
    const dc=Number(e.DC_Power ?? e.DC_Power_kW ?? e.DC ?? 0);
    if(!isFinite(ac) && !isFinite(dc)) continue;
    buckets[i].ac += isFinite(ac)?ac:0; buckets[i].dc += isFinite(dc)?dc:0; buckets[i].n += 1;
  }
  return buckets.map(b=>({ t:new Date(b.t).toISOString(), ac: b.n?b.ac:0, dc: b.n?b.dc:0 }));
}
function sumByFilter(entities, fromIso, toIso){
  const from=new Date(fromIso), to=new Date(toIso);
  let s=0; for(const e of entities){ const ts=new Date(e.timestamp||e.Timestamp); if(ts<from||ts>to) continue;
    const v=Number(e.Daily_Yield_KWH ?? e.Daily_Yield_kWh ?? e.Daily_Yield ?? 0); if(isFinite(v)) s+=v; }
  return s;
}
function sumMonthly(entities, y, m){
  let s=0; for(const e of entities){ const ts=new Date(e.timestamp||e.Timestamp); const ty=ts.getUTCFullYear(), tm=ts.getUTCMonth()+1;
    if(ty===y && tm===m){ const v=Number(e.Monthly_Yield_KWH ?? e.Monthly_Yield_kWh ?? e.Monthly_Yield ?? e.Daily_Yield_KWH ?? 0); if(isFinite(v)) s+=v; } }
  return s;
}
function aggregateYields(entities, view, refDayIST){
  const results=[];
  if(view==="day"){
    let sum=0; for(const e of entities){ const v=Number(e.Daily_Yield_KWH ?? e.Daily_Yield_kWh ?? e.Daily_Yield ?? 0); if(isFinite(v)) sum+=v; }
    results.push({ label: toYMD(refDayIST), value: round2(sum) });
  } else if(view==="week"){
    for(let i=6;i>=0;i--){ const d=new Date(refDayIST.getTime()-i*86400000); const [fromIso,toIso]=istDayUtcRange(d);
      results.push({ label: toYMD(d), value: round2(sumByFilter(entities, fromIso, toIso)) }); }
  } else if(view==="month"){
    for(const ym of lastNMonths(refDayIST,6)){ const v=sumMonthly(entities, ym.y, ym.m); results.push({ label: `${ym.y}-${String(ym.m).padStart(2,"0")}`, value: round2(v) }); }
  } else if(view==="year"){
    let total=0; for(const e of entities){ const v=Number(e.Total_Yield ?? e.Total_Yield_kWh ?? 0); if(isFinite(v)) total=Math.max(total,v); }
    const { value, unit } = formatTotalYield(total);
    results.push({ label: `${refDayIST.getUTCFullYear()}`, value: round2(value), unit });
  }
  return results;
}

module.exports = async function (context, req) {
  const path = (context.bindingData && context.bindingData.path) || "";

  if (path.toLowerCase() === "ping") { context.res = { status: 200, body: "ok" }; return; }

  // NEW: /diag — check Managed Identity token & simple TableClient creation
  if (path.toLowerCase() === "diag") {
    try {
      const mic = new ManagedIdentityCredential(); // direct MI
      await mic.getToken("https://storage.azure.com/.default");
      const client = new TableClient(ENDPOINT, "SungrowInverter125KW", mic); // will 404 if table missing; that’s OK
      context.res = { status: 200, jsonBody: { ok:true, account: ACCOUNT_NAME, node: process.version } };
    } catch (e) {
      context.log("diag error", e);
      context.res = { status: 500, jsonBody: { ok:false, error: String(e), hint: "If this says 'ManagedIdentityCredential', verify SWA system-assigned MI is enabled and has Storage Table Data Reader on solariothubstorage." } };
    }
    return;
  }

  if (path.toLowerCase() === "health") {
    try {
      const names = await getActiveTables();
      context.res = { status: 200, jsonBody: { ok: true, tables: names, account: ACCOUNT_NAME } };
    } catch(e){ context.log("health error", e); context.res = { status: 500, jsonBody: { ok:false, error: String(e) } }; }
    return;
  }

  try {
    const view = (req.query.view || "day").toLowerCase();
    const plantId = req.query.plantId || "all";
    const refIst = (req.query.date ? parseDateParamIST(req.query.date) : istFloor(new Date()));
    const key = JSON.stringify({ view, plantId, date: toYMD(refIst) });
    const cached = cacheGet(key); if (cached) { context.res = { status: 200, jsonBody: cached }; return; }

    let fromIso, toIso;
    if (view === "day") {
      const y=refIst.getUTCFullYear(), m=refIst.getUTCMonth()+1, d=refIst.getUTCDate();
      fromIso = toUtcISOStringFromIST(y,m,d,5,0); toIso = toUtcISOStringFromIST(y,m,d,19,0);
    } else if (view === "week") {
      const start = new Date(refIst.getTime() - 6*86400000);
      fromIso = toUtcISOStringFromIST(start.getUTCFullYear(),start.getUTCMonth()+1,start.getUTCDate(),0,0);
      toIso   = toUtcISOStringFromIST(refIst.getUTCFullYear(),refIst.getUTCMonth()+1,refIst.getUTCDate(),23,59);
    } else if (view === "month") {
      const earliest = new Date(refIst); earliest.setUTCMonth(earliest.getUTCMonth()-5,1);
      fromIso = toUtcISOStringFromIST(earliest.getUTCFullYear(), earliest.getUTCMonth()+1, 1, 0, 0);
      const lastDay = new Date(refIst.getUTCFullYear(), refIst.getUTCMonth()+1, 0).getUTCDate();
      toIso   = toUtcISOStringFromIST(refIst.getUTCFullYear(), refIst.getUTCMonth()+1, lastDay, 23, 59);
    } else if (view === "year") {
      const start = new Date(Date.UTC(refIst.getUTCFullYear(),0,1));
      const end   = new Date(Date.UTC(refIst.getUTCFullYear(),11,31,23,59));
      fromIso = toUtcISOStringFromIST(start.getUTCFullYear(),start.getUTCMonth()+1,start.getUTCDate(),0,0);
      toIso   = toUtcISOStringFromIST(end.getUTCFullYear(),end.getUTCMonth()+1,end.getUTCDate(),23,59);
    } else { context.res = { status: 400, jsonBody: { error: "invalid view" } }; return; }

    const tableNames = await getActiveTables();
    let all = [];
    for (const name of tableNames) {
      const ents = await fetchEntitiesInRange(name, fromIso, toIso);
      all = all.concat(ents);
    }

    const inferredMap = buildMapping(all);
    const filtered = filterByPlant(all, plantId, inferredMap);

    const powerSeries = (view === "day") ? aggregatePowerDayIST(filtered, refIst) : [];
    const yieldSeries = aggregateYields(filtered, view, refIst);

    let totalKWh = 0;
    for (const e of filtered) {
      const v = Number(e.Total_Yield ?? e.Total_Yield_KWh ?? e.Total_Yield_kWh ?? 0);
      if (isFinite(v)) totalKWh = Math.max(totalKWh, v);
    }
    const { value: totalValue, unit: totalUnit } = formatTotalYield(totalKWh);

    const response = {
      serverTimeUtc: new Date().toISOString(),
      parameters: { view, plantId, date: toYMD(refIst) },
      kpis: { total_yield: totalValue, unit: totalUnit, cuf: null, pr: null },
      power: powerSeries,
      yield: yieldSeries
    };

    cacheSet(key, response);
    context.res = { status: 200, jsonBody: response };
  } catch (e) {
    context.log("analytics error", e);
    context.res = { status: 500, jsonBody: { error: String(e) } };
  }
};
