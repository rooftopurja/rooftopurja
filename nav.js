(function(){
  try{
    const here=(location.pathname.split('/').pop()||'').toLowerCase();
    document.querySelectorAll('.topbar a').forEach(a=>{
      const target=(a.getAttribute('href')||'').toLowerCase();
      if(target && here===target) a.classList.add('active');
      if((!here || here==='index.html') && target==='meter.v2.html') a.classList.add('active');
    });
  }catch(e){}
})();
