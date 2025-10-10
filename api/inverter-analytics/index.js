/* inverter-analytics — SAFE JSON RESPONSES */
const { ManagedIdentityCredential } = require("@azure/identity");
const { TableClient } = require("@azure/data-tables");

const ACCOUNT_NAME = process.env.STORAGE_ACCOUNT_NAME || "solariothubstorage";
const ENDPOINT = `https://${ACCOUNT_NAME}.table.core.windows.net`;
const IST_OFFSET_MIN = 330;

const CANDIDATE_TABLES = (process.env.SVI_TABLES
  ? process.env.SVI_TABLES.split(",").map(s => s.trim()).filter(Boolean)
  : ["SungrowInverter125KW","SungrowInverter100KW","SungrowInverter110KW","SungrowInverter80KW","SungrowInverter60KW","SungrowInverter50KW"]);

/* ---------- utils ---------- */
const cache = new Map(), cacheTTLms = 60*1000;
const cacheGet = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.t>cacheTTLms){ cache.delete(k); return null; } return h.v; };
const cacheSet = (k,v) => cache.set(k,{t:Date.now(),v});
const json = (context, status, obj) => {
  context.res = { status, body: JSON.stringify(obj), headers: { "Content-Type": "application/json" } };
};

function toUtcISOStringFromIST(y,m,d,hh,mm){ const ist=Date.UTC(y,m-1,d,hh,mm); const utc=ist-IST_OFFSET_MIN*60*1000; return new Date(utc).toISOString(); }
function istFloor(date){ const utc=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()); const ist=utc+IST_OFFSET_MIN*60*1000; return new Date(ist); }
function parseDateParamIST(s){ const [y,m,d]=s.split("-").map(Number); const utc=Date.UTC(y,m-1,d,0,0)-IST_OFFSET_MIN*60*1000; return new Date(utc); }
function toYMD(istDate){ const y=istDate.getUTCFullYear(); const m=String(istDate.getUTCMonth()+1).padStart(2,"0"); const d=String(istDate.getUTCDate()).padStart(2,"0"); return `${y}-${m}-${d}`; }
const round2 = x => Math.round(x*100)/100;
function formatTotalYield(kWh){ if(kWh==null) return {value:null,unit:null}; if(kWh>=1_000_000) return {value:kWh/1_000_000,unit:"GWh"}; if(kWh>=1_000) return {value:kWh/1_000,unit:"MWh"}; return {value:kWh,unit:"kWh"}; }
function istDayUtcRange(istDay){ const y=istDay.getUTCFullYear(), m=istDay.getUTCMonth()+1, d=istDay.getUTCDate(); return [toUtcISOStringFromIST(y,m,d,0,0), toUtcISOStringFromIST(y,m,d,23,59)]; }
function lastNMonths(refIst,n){ const out=[]; const y0=refIst.getUTCFullYear(), m0=refIst.getUTCMonth()+1; for(let i=n-1;i>=0;i--){ let y=y0, m=m0-i; while(m<=0){m+=12;y-=1;} out.push({y,m}); } return out; }

const credential = new ManagedIdentityCredential();
async function tableExists(name){ try{ const c=new TableClient(ENDPOINT,name,credential); for await (const _ of c.listEntities({queryOptions:{top:1}})){} return true; } catch(e){ return false; } }
async function getActiveTables(){ const ok=[]; for(const n of CANDIDATE_TABLES){ if(await tableExists(n)) ok.push(n); } return ok; }
async function fetchEntitiesInRange(name, fromIso, toIso){
  const c=new TableClient(ENDPOINT,name,credential);
  const f=`Timestamp ge datetime'${fromIso}' and Timestamp le datetime'${toIso}'`;
  const out=[]; for await (const e of c.listEntities({queryOptions:{filter:f}})) out.push(e); return out;
}
function buildMapping(ents){ const m=new Map(); for(const e of ents){ const inv=e.Inverter_ID||e.InverterId||e.inverter_id; const pid=e.Plant_ID||e.PlantId||e.plant_id; if(inv&&pid&&!m.has(String(inv))) m.set(String(inv),String(pid)); } return m; }
function filterByPlant(ents, plantId, map){ if(!plantId||plantId.toLowerCase()==="all") return ents; const pid=String(plantId); const out=[]; for(const e of ents){ const p=e.Plant_ID||e.PlantId||e.plant_id; if(p){ if(String(p)===pid) out.push(e); continue; } const inv=e.Inverter_ID||e.InverterId||e.inverter_id; if(inv && map.has(String(inv)) && map.get(String(inv))===pid) out.push(e); } return out; }
function aggregatePowerDayIST(ents, dayIST){ const y=dayIST.getUTCFullYear(), m=dayIST.getUTCMonth()+1, d=dayIST.getUTCDate(); const sIso=toUtcISOStringFromIST(y,m,d,5,0), eIso=toUtcISOStringFromIST(y,m,d,19,0); const s=new Date(sIso), e=new Date(eIso); const buckets=[]; for(let t=s.getTime(); t<=e.getTime(); t+=20*60*1000) buckets.push({t,ac:0,dc:0,n:0}); const idx=ts=>{ const i=Math.round((ts-s.getTime())/(20*60*1000)); return (i<0||i>=buckets.length)?-1:i; }; for(const e1 of ents){ const ts=new Date(e1.timestamp||e1.Timestamp); if(ts<s||ts>e) continue; const i=idx(ts.getTime()); if(i<0) continue; const ac=Number(e1.AC_Power ?? e1.AC_Power_kW ?? e1.AC ?? 0); const dc=Number(e1.DC_Power ?? e1.DC_Power_kW ?? e1.DC ?? 0); if(!isFinite(ac) && !isFinite(dc)) continue; buckets[i].ac += isFinite(ac)?ac:0; buckets[i].dc += isFinite(dc)?dc:0; buckets[i].n++; } return buckets.map(b=>({t:new Date(b.t).toISOString(), ac:b.n?b.ac:0, dc:b.n?b.dc:0})); }
function sumByFilter(ents, fromIso, toIso){ const from=new Date(fromIso), to=new Date(toIso); let s=0; for(const e of ents){ const ts=new Date(e.timestamp||e.Timestamp); if(ts<from||ts>to) continue; const v=Number(e.Daily_Yield_KWH ?? e.Daily_Yield_kWh ?? e.Daily_Yield ?? 0); if(isFinite(v)) s+=v; } return s; }
function sumMonthly(ents, y, m){ let s=0; for(const e of ents){ const ts=new Date(e.timestamp||e.Timestamp); const ty=ts.getUTCFullYear(), tm=ts.getUTCMonth()+1; if(ty===y && tm===m){ const v=Number(e.Monthly_Yield_KWH ?? e.Monthly_Yield_kWh ?? e.Monthly_Yield ?? e.Daily_Yield_KWH ?? 0); if(isFinite(v)) s+=v; } } return s; }
function aggregateYields(ents, view, refIst){ const results=[]; if(view==="day"){ let sum=0; for(const e of ents){ const v=Number(e.Daily_Yield_KWH ?? e.Daily_Yield_kWh ?? e.Daily_Yield ?? 0); if(isFinite(v)) sum+=v; } results.push({label: toYMD(refIst), value: round2(sum)}); } else if(view==="week"){ for(let i=6;i>=0;i--){ const d=new Date(refIst.getTime()-i*86400000); const [f,t]=istDayUtcRange(d); results.push({label: toYMD(d), value: round2(sumByFilter(ents,f,t))}); } } else if(view==="month"){ for(const ym of lastNMonths(refIst,6)){ const v=sumMonthly(ents, ym.y, ym.m); results.push({label: `${ym.y}-${String(ym.m).padStart(2,"0")}`, value: round2(v)}); } } else if(view==="year"){ let total=0; for(const e of ents){ const v=Number(e.Total_Yield ?? e.Total_Yield_kWh ?? 0); if(isFinite(v)) total=Math.max(total,v); } const {value,unit}=formatTotalYield(total); results.push({label: `${refIst.getUTCFullYear()}`, value: round2(value), unit}); } return results; }

/* --------- MAIN --------- */
module.exports = async function (context, req) {
  const path = (context.bindingData && context.bindingData.path || "").toLowerCase();

  if (path === "ping") { context.res = { status: 200, body: "ok" }; return; }

  if (path === "env") {
    const tables = (process.env.SVI_TABLES || "").split(",").map(s => s.trim()).filter(Boolean);
    return json(context, 200, { ok:true, node:process.version, account:ACCOUNT_NAME, tables });
  }

  if (path === "token") {
    try {
      const tok = await credential.getToken("https://storage.azure.com/.default");
      return json(context, 200, { ok:true, tokenAcquired: !!tok, expiresOn: tok?.expiresOnTimestamp || null });
    } catch (e) {
      return json(context, 200, { ok:false, error: String(e) });
    }
  }

  if (path === "diag") {
    try {
      await credential.getToken("https://storage.azure.com/.default");
      const c = new TableClient(ENDPOINT, (CANDIDATE_TABLES[0] || "SungrowInverter125KW"), credential);
      return json(context, 200, { ok:true, account:ACCOUNT_NAME, node:process.version, tables:CANDIDATE_TABLES });
    } catch (e) {
      return json(context, 500, { ok:false, error: String(e) });
    }
  }

  if (path === "health") {
    try {
      const names = await getActiveTables();
      return json(context, 200, { ok:true, tables:names, account:ACCOUNT_NAME });
    } catch (e) {
      return json(context, 500, { ok:false, error: String(e) });
    }
  }

  // ==== analytics ====
  try {
    const view=(req.query.view||"day").toLowerCase();
    const plantId=req.query.plantId||"all";
    const refIst=(req.query.date?parseDateParamIST(req.query.date):istFloor(new Date()));
    const key=JSON.stringify({view,plantId,date:toYMD(refIst)}); const cached=cacheGet(key); if(cached) return json(context,200,cached);

    let fromIso,toIso;
    if(view==="day"){ const y=refIst.getUTCFullYear(), m=refIst.getUTCMonth()+1, d=refIst.getUTCDate(); fromIso=toUtcISOStringFromIST(y,m,d,5,0); toIso=toUtcISOStringFromIST(y,m,d,19,0); }
    else if(view==="week"){ const s=new Date(refIst.getTime()-6*86400000); fromIso=toUtcISOStringFromIST(s.getUTCFullYear(),s.getUTCMonth()+1,s.getUTCDate(),0,0); toIso=toUtcISOStringFromIST(refIst.getUTCFullYear(),refIst.getUTCMonth()+1,refIst.getUTCDate(),23,59); }
    else if(view==="month"){ const earliest=new Date(refIst); earliest.setUTCMonth(earliest.getUTCMonth()-5,1); fromIso=toUtcISOStringFromIST(earliest.getUTCFullYear(), earliest.getUTCMonth()+1,1,0,0); const lastDay=new Date(refIst.getUTCFullYear(), refIst.getUTCMonth()+1,0).getUTCDate(); toIso=toUtcISOStringFromIST(refIst.getUTCFullYear(),refIst.getUTCMonth()+1,lastDay,23,59); }
    else if(view==="year"){ const s=new Date(Date.UTC(refIst.getUTCFullYear(),0,1)), e=new Date(Date.UTC(refIst.getUTCFullYear(),11,31,23,59)); fromIso=toUtcISOStringFromIST(s.getUTCFullYear(),s.getUTCMonth()+1,s.getUTCDate(),0,0); toIso=toUtcISOStringFromIST(e.getUTCFullYear(),e.getUTCMonth()+1,e.getUTCDate(),23,59); }
    else return json(context,400,{error:"invalid view"});

    const names=await getActiveTables(); let all=[]; for(const n of names){ const ents=await fetchEntitiesInRange(n, fromIso, toIso); all=all.concat(ents); }
    const map=buildMapping(all); const filtered=filterByPlant(all, plantId, map);
    const power=(view==="day")?aggregatePowerDayIST(filtered,refIst):[]; const yld=aggregateYields(filtered,view,refIst);
    let totalKWh=0; for(const e of filtered){ const v=Number(e.Total_Yield ?? e.Total_Yield_KWh ?? e.Total_Yield_kWh ?? 0); if(isFinite(v)) totalKWh=Math.max(totalKWh,v); }
    const {value:totalValue, unit:totalUnit}=formatTotalYield(totalKWh);
    const response={ serverTimeUtc:new Date().toISOString(), parameters:{view,plantId,date:toYMD(refIst)}, kpis:{ total_yield:totalValue, unit:totalUnit, cuf:null, pr:null }, power, yield:yld };
    cacheSet(key,response); return json(context,200,response);

  } catch (e) { return json(context,500,{ ok:false, error:String(e) }); }
};
