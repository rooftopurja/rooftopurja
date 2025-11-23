(function(){
  try{
    var file = (location.pathname.split("/").pop() || "meter.v2.html").toLowerCase();
    var link = document.querySelector('.topbar .tabs a[data-page="'+file+'"]');
    if(link){ link.classList.add("active"); }
  }catch(e){}
})();