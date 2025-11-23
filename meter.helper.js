(function(){
  const $ = (s, r=document)=>r.querySelector(s);

  function ddmmyyyy(d){const p=n=>String(n).padStart(2,"0");return `${p(d.getDate())}-${p(d.getMonth()+1)}-${d.getFullYear()}`}

  function ensureDates(){
    const inputs = Array.from(document.querySelectorAll('input[type="date"], input[placeholder*="dd-mm-yyyy"]'));
    const startEl = $("#start") || inputs[0] || null;
    const endEl   = $("#end")   || inputs[1] || null;
    const today = new Date(), ago = new Date(); ago.setDate(today.getDate()-30);
    if (startEl && !startEl.value) startEl.value = ddmmyyyy(ago);
    if (endEl   && !endEl.value)   endEl.value   = ddmmyyyy(today);
    return { start: startEl ? startEl.value : ddmmyyyy(ago), end: endEl ? endEl.value : ddmmyyyy(today) };
  }

  function ensurePlantSelect(){
    let dd = document.querySelector("#plantSelect, #plants, #PlantSelect") || document.querySelector("select");
    if(!dd){
      const host = document.querySelector(".filters") || document.body;
      const wrap = document.createElement("div");
      wrap.innerHTML = '<label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Plant</label><select id="plantSelect" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;"><option value="">All Plants</option></select>';
      host.insertBefore(wrap, host.firstChild || null);
      dd = wrap.querySelector("select");
    }
    if(!dd.id) dd.id = "plantSelect";
    return dd;
  }

  async function jsonGET(url){
    const r = await fetch(url, {headers:{"Cache-Control":"no-cache"}});
    if(!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function fillPlants(){
    const dd = ensurePlantSelect();
    const data = await jsonGET("/api/PlantDirectory");
    const items = Array.isArray(data?.plants) ? data.plants : data;
    for(const p of (items||[])){
      const o = document.createElement("option");
      o.value = String(p.id ?? p.Plant_ID ?? "");
      o.textContent = String(p.name ?? p.DisplayPlant ?? p.Plant_Name ?? o.value);
      dd.appendChild(o);
    }
  }

  if(typeof window.loadMeters !== "function"){
    window.loadMeters = async function(){
      const d = ensureDates();
      const url = `/api/GetPremier300MeterAll?start=${encodeURIComponent(d.start)}&end=${encodeURIComponent(d.end)}&top=100000&${Date.now()}`;
      const data = await jsonGET(url);
      return Array.isArray(data) ? data : (data?.rows || []);
    };
  } else {
    const _orig = window.loadMeters;
    window.loadMeters = async function(){ ensureDates(); return _orig.apply(this, arguments); };
  }

  function filterByPlants(rows){
    const dd = $("#plantSelect") || $("#plants") || $("#PlantSelect") || document.querySelector("select");
    const sel = dd?.value ? String(dd.value).trim() : "";
    if(!sel) return rows;
    return rows.filter(r => String(r.Plant_ID ?? r.PlantId ?? r.Plant ?? "").trim() === sel);
  }

  async function run(){
    const btn = $("#applyBtn");
    try{
      if(btn) btn.disabled = true;
      const all = await window.loadMeters();
      const sel = filterByPlants(all);
      try{ window.renderKPI && window.renderKPI(sel); }catch(_){}
      try{ window.renderPie && window.renderPie(sel); }catch(_){}
      try{ window.renderBarLine && window.renderBarLine(sel); }catch(_){}
      try{ window.renderTable && window.renderTable(sel); }catch(_){}
    }catch(e){ console.error(e); console.warn("UI notice:", "Failed to load data"); }
    finally{ if(btn) btn.disabled = false; }
  }

  document.addEventListener("DOMContentLoaded", async ()=>{
    try{
      ensureDates();
      await fillPlants();
      const btn = $("#applyBtn"); if(btn) btn.addEventListener("click", run);
      await run();
    }catch(e){ console.error(e); }
  });
})();