(function(){
  // -------- API base (works on both custom domain and default host) -------
  const API_BASE = `${location.origin}/api`;

  // -------- small utils ----------------------------------------------------
  const $ = (s, r=document)=>r.querySelector(s);
  const pad2 = n=>String(n).padStart(2,"0");
  const fmtDMY = d=>`${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()}`;
  function ensureDates(){
    const inputs = Array.from(document.querySelectorAll('input[type="date"], input[placeholder*="dd-mm"]'));
    const startEl = $("#start") || inputs[0] || null;
    const endEl   = $("#end")   || inputs[1] || null;
    const today = new Date(), ago = new Date(); ago.setDate(today.getDate()-30);
    if(startEl && !startEl.value) startEl.value = fmtDMY(ago);
    if(endEl   && !endEl.value)   endEl.value   = fmtDMY(today);
    return { start: startEl?startEl.value:fmtDMY(ago), end: endEl?endEl.value:fmtDMY(today) };
  }
  async function fetchJSON(url){
    const r = await fetch(url,{headers:{"Cache-Control":"no-cache"}});
    if(!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  // -------- Plant Directory (checkbox multi-select) ------------------------
  async function getPlants(){
    const data = await fetchJSON(`${API_BASE}/PlantDirectory`);
    return Array.isArray(data?.plants) ? data.plants : (Array.isArray(data) ? data : []);
  }
  function buildPlantPicker(targetSel="#plantBar"){
    let host = $(targetSel);
    if(!host){
      host = document.createElement("div"); host.id="plantBar"; host.className="sp-plantbar";
      document.body.prepend(host);
    }
    const wrap = document.createElement("div");
    wrap.className = "sp-picker";
    wrap.innerHTML =
      `<button type="button" class="sp-picker-btn" id="spPickBtn">All Plants</button>
       <div class="sp-panel" id="spPanel"><div class="sp-row"><input id="spAll" type="checkbox" checked>
       <label for="spAll"><strong>All Plants</strong></label></div></div>`;
    host.prepend(wrap);

    const btn = $("#spPickBtn"), panel=$("#spPanel"), all=$("#spAll");
    btn.addEventListener("click", ()=>panel.classList.toggle("open"));
    document.addEventListener("click", (e)=>{ if(!wrap.contains(e.target)) panel.classList.remove("open"); });

    const sel = new Set(); // selected Plant_IDs
    function syncBtn(){
      btn.textContent = sel.size ? `${sel.size} selected` : "All Plants";
    }

    return {
      async load(){
        const plants = await getPlants();
        for(const p of plants){
          const id = String(p.id ?? p.Plant_ID ?? "").trim();
          const nm = String(p.name ?? p.DisplayPlant ?? p.Plant_Name ?? id).trim();
          if(!id) continue;
          const row = document.createElement("div"); row.className="sp-row";
          const cb  = document.createElement("input"); cb.type="checkbox"; cb.id=`p_${id}`; cb.dataset.id=id;
          const lb  = document.createElement("label"); lb.htmlFor=cb.id; lb.textContent=nm;
          row.append(cb, lb); panel.appendChild(row);
          cb.addEventListener("change", ()=>{
            if(cb.checked){ sel.add(id); all.checked=false; } else { sel.delete(id); }
            if(sel.size===0) all.checked=true;
            syncBtn();
            document.dispatchEvent(new CustomEvent("plants-changed",{detail:[...sel]}));
          });
        }
        all.addEventListener("change", ()=>{
          if(all.checked){
            [...panel.querySelectorAll('input[type="checkbox"]')].forEach(x=>{ if(x!==all){ x.checked=false; }});
            sel.clear(); syncBtn();
            document.dispatchEvent(new CustomEvent("plants-changed",{detail:[]}));
          }
        });
      },
      selected: ()=>[...sel]
    };
  }

  // expose
  window.SWA = {
    API_BASE, ensureDates, fetchJSON,
    buildPlantPicker,
    // convenience: meter rows call
    async loadMeterRows(){
      const d = ensureDates();
      const url = `${API_BASE}/GetPremier300MeterAll?start=${encodeURIComponent(d.start)}&end=${encodeURIComponent(d.end)}&top=100000&${Date.now()}`;
      const data = await fetchJSON(url);
      return Array.isArray(data) ? data : (data?.rows || []);
    }
  };
})();