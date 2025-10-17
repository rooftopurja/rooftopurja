(function(){
  try{
    var path = (location.pathname||"").toLowerCase();
    var map = {
      "meter.v2.html":"meter",
      "inverter_analytics.html":"inverter_analytics",
      "inverter_data_overview.html":"data_overview",
      "inverter_faults.html":"faults",
      "maintenance.html":"maintenance",
      "index.html":"meter"
    };
    var key = Object.keys(map).find(k=>path.endsWith("/"+k)) || "meter.v2.html";
    var tab = map[key];
    document.querySelectorAll(".tabs a").forEach(a=>{
      var t = a.getAttribute("data-tab");
      if(t===tab){ a.classList.add("active"); }
    });
  }catch(e){}
})();
