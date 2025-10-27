const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DateTime } = require("luxon");

const CONN = process.env.TABLES_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const SUMMARY_TABLE = "InverterDailySummary";
const CACHE_TABLE = "InverterQueryCache";
const CURVE_CONTAINER = process.env.CURVE_CONTAINER || "invertercurves";

/* --- Helpers --- */
const parseList = s => s ? s.split(",").map(x => x.trim()).filter(Boolean) : [];
const fmt = v => { let u="kWh"; if(v>=1e6){v/=1e6;u="GWh";} else if(v>=1e3){v/=1e3;u="MWh";} return {value:+v.toFixed(2),unit:u}; };
const safeAdd = (o,k,v)=>o[k]=(o[k]||0)+(+v||0);

/* Yield summarization */
function summarize(rows, period) {
  if (!rows.length) return [];
  const map={}; rows.forEach(r=>safeAdd(map,r.Date||r.rowKey,r.Daily_Yield_KWH));
  const sorted=Object.entries(map).sort(([a],[b])=>a.localeCompare(b));
  if(period==="week") return sorted.slice(-7).map(([l,v])=>({label:l,valueKWh:v}));
  if(period==="month"){const m={};sorted.forEach(([d,v])=>safeAdd(m,d.slice(0,7),v));return Object.entries(m).slice(-6).map(([l,v])=>({label:l,valueKWh:v}));}
  if(period==="year"){const y={};sorted.forEach(([d,v])=>safeAdd(y,d.slice(0,4),v));return Object.entries(y).slice(-5).map(([l,v])=>({label:l,valueKWh:v}));}
  if(period==="lifetime"){const tot=sorted.reduce((a,[,v])=>a+v,0);return[{label:"Lifetime",valueKWh:tot}];}
  return sorted.slice(-1).map(([l,v])=>({label:l,valueKWh:v}));
}

/* Blob utilities */
async function readCurve(blobSvc,inv,date){
  try{
    const blob=blobSvc.getContainerClient(CURVE_CONTAINER).getBlobClient(`${inv}_${date}.json`);
    const res=await blob.download();
    const txt=await streamToString(res.readableStreamBody);
    return JSON.parse(txt);
  }catch{return [];}
}
const streamToString=r=>new Promise((res,rej)=>{const c=[];r.on("data",d=>c.push(d.toString()));r.on("end",()=>res(c.join("")));r.on("error",rej);});
function combineCurves(curves){
  const map=new Map();
  for(const arr of curves)for(const p of arr){
    const t=p.Time||p.time;if(!t)continue;
    const rec=map.get(t)||{Time:t,DC:0,AC:0};
    rec.DC+=+p.DC||0; rec.AC+=+p.AC||0; map.set(t,rec);
  }
  return [...map.values()].sort((a,b)=>a.Time.localeCompare(b.Time));
}

/* Cache helpers */
async function getCache(cacheClient,key){
  try{
    const e=await cacheClient.getEntity("cache",key);
    const payload=JSON.parse(e.Payload||"{}");
    const ts=DateTime.fromISO(e.CachedUtc).setZone("UTC");
    if(DateTime.utc().diff(ts,"hours").hours<1) return payload;
  }catch{} return null;
}
async function setCache(cacheClient,key,payload){
  try{
    await cacheClient.upsertEntity({
      partitionKey:"cache",
      rowKey:key,
      Payload:JSON.stringify(payload),
      CachedUtc:new Date().toISOString()
    });
  }catch(err){console.warn("Cache save failed:",err.message);}
}

/* --- MAIN --- */
module.exports = async function(context,req){
  const start=Date.now();
  try{
    const period=(req.query.period||"day").toLowerCase();
    const nav=+req.query.nav||0;
    const plants=parseList(req.query.plants);
    const inverters=parseList(req.query.inverters);
    const now=DateTime.now().setZone(TIMEZONE);
    const targetDate=now.plus({days:nav}).toISODate();

    const summary=TableClient.fromConnectionString(CONN,SUMMARY_TABLE);
    const cacheClient=TableClient.fromConnectionString(CONN,CACHE_TABLE);
    const blobSvc=BlobServiceClient.fromConnectionString(CONN);

    /* 1️⃣ Try cache first (for day/week only) */
    const cacheKey=`${period}_${nav}_${plants.join(",")}_${inverters.join(",")}`;
    if(["day","week"].includes(period)){
      const cached=await getCache(cacheClient,cacheKey);
      if(cached){context.log(`⚡ Cache hit for ${period}`);context.res={status:200,body:cached};return;}
    }

    /* 2️⃣ Stream summary table efficiently */
    const rows=[];
    const pager=summary.listEntities().byPage({maxPageSize:500});
    for await(const page of pager){
      for(const e of page){
        const pid=String(e.Plant_ID||"");
        const inv=String(e.Inverter_ID||e.partitionKey||"");
        if(plants.length&&!plants.includes(pid))continue;
        if(inverters.length&&!inverters.includes(inv))continue;
        rows.push(e);
      }
      if(period==="day"&&rows.length>2000)break;
    }

    /* 3️⃣ Summaries + totals */
    const yieldTrend=summarize(rows,period);
    const totalKWh=yieldTrend.reduce((a,b)=>a+(b.valueKWh||0),0);
    const {value:totalYield,unit:yieldUnit}=fmt(totalKWh);

    /* 4️⃣ Power curve */
    const targetRows=rows.filter(r=>r.Date===targetDate);
    const invIds=[...new Set(targetRows.map(r=>r.Inverter_ID))];
    const limit=8, allCurves=[];
    for(let i=0;i<invIds.length;i+=limit){
      const chunk=invIds.slice(i,i+limit);
      const res=await Promise.all(chunk.map(id=>readCurve(blobSvc,id,targetDate)));
      allCurves.push(...combineCurves(res));
    }

    const payload={
      powerCurve:allCurves,
      yieldTrend,
      totalYield,
      yieldUnit,
      window:{
        period,
        start:yieldTrend[0]?.label||targetDate,
        end:yieldTrend.at(-1)?.label||targetDate
      }
    };

    /* 5️⃣ Write cache */
    if(["day","week"].includes(period)) await setCache(cacheClient,cacheKey,payload);

    context.log(`✅ GetInverterData(${period}) done in ${Date.now()-start}ms`);
    context.res={status:200,body:payload};
  }catch(err){
    context.log.error("❌ GetInverterData error:",err);
    context.res={status:500,body:{error:err.message}};
  }
};
