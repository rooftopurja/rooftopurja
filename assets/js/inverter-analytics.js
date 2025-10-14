/* Inverter Analytics charts – talks to /api/inverter/analytics */
(function(){
  // DOM helpers (robust fallbacks)
  const $ = s => document.querySelector(s);
  const plantSel   = document.querySelector('#plantSelect') || document.querySelector('[data-plant-select]');
  const dateInput  = document.querySelector('#dateInput')  || document.querySelector('[data-date-input]');
  const btnDay     = document.querySelector('#btnDay')     || document.querySelector('[data-view="day"]');
  const btnWeek    = document.querySelector('#btnWeek')    || document.querySelector('[data-view="week"]');
  const btnMonth   = document.querySelector('#btnMonth')   || document.querySelector('[data-view="month"]');
  const btnYear    = document.querySelector('#btnYear')    || document.querySelector('[data-view="year"]');
  const btnRefresh = document.querySelector('#btnRefresh') || document.querySelector('[data-refresh]');

  const kpiTotal   = document.querySelector('#kpiTotalYield') || document.querySelector('[data-kpi-total]');
  const kpiMeta    = document.querySelector('#kpiMeta')       || document.querySelector('[data-kpi-meta]');

  // Prefer explicit ids; else pick first two canvases on the page
  let powerCanvas  = document.getElementById('powerChart');
  let yieldCanvas  = document.getElementById('yieldChart');
  if (!powerCanvas || !yieldCanvas) {
    const cvs = document.querySelectorAll('canvas');
    if (!powerCanvas && cvs[0]) powerCanvas = cvs[0];
    if (!yieldCanvas && cvs[1]) yieldCanvas = cvs[1];
  }

  function yyyy_mm_dd(d){ return d.toISOString().slice(0,10); }
  let view = 'day';

  // Load Chart.js on-demand if not already present
  function ensureChartJs(){
    return new Promise((resolve) => {
      if (window.Chart) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  let powerChart, yieldChart;
  function ensureCharts(){
    if (!powerCanvas || !yieldCanvas) return;
    if (!powerChart) {
      powerChart = new Chart(powerCanvas, {
        type: 'line',
        data: { labels: [], datasets: [
          { label: 'AC Power (kW)', data: [], tension: 0.3, borderWidth: 2, pointRadius: 0 },
          { label: 'DC Power (kW)', data: [], tension: 0.3, borderWidth: 2, pointRadius: 0 }
        ]},
        options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true }}, plugins:{ legend:{ position:'bottom' } } }
      });
    }
    if (!yieldChart) {
      yieldChart = new Chart(yieldCanvas, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Yield', data: [] }]},
        options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true }}, plugins:{ legend:{ display:false } } }
      });
    }
  }

  function setActive(tab){
    view = tab;
    [btnDay,btnWeek,btnMonth,btnYear].forEach(b => b && b.classList.toggle('active', (b.dataset?.view||'')===view));
  }

  async function fetchAnalytics(){
    const plantId = plantSel ? (plantSel.value || 'all') : 'all';
    const dateStr = dateInput ? (dateInput.value || yyyy_mm_dd(new Date())) : yyyy_mm_dd(new Date());
    const url = `/api/inverter/analytics?view=${encodeURIComponent(view)}&plantId=${encodeURIComponent(plantId)}&date=${encodeURIComponent(dateStr)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' }});
    if (!res.ok) throw new Error(`API ${res.status}`);
    return await res.json();
  }

  function render(data){
    if (kpiTotal) kpiTotal.textContent = `${data?.kpis?.total_yield ?? 0} ${data?.kpis?.unit ?? 'kWh'}`;
    if (kpiMeta)  kpiMeta.textContent  = `View: ${data?.parameters?.view} • Date: ${data?.parameters?.date}`;

    ensureCharts();

    if (powerChart) {
      if (view==='day') {
        const labels = (data.power||[]).map(p => new Date(p.t).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
        powerChart.data.labels = labels;
        powerChart.data.datasets[0].data = (data.power||[]).map(p=>p.ac||0);
        powerChart.data.datasets[1].data = (data.power||[]).map(p=>p.dc||0);
      } else {
        powerChart.data.labels = [];
        powerChart.data.datasets.forEach(d=>d.data=[]);
      }
      powerChart.update();
    }

    if (yieldChart) {
      const yLabels = (data.yield||[]).map(y=>y.label);
      const yValues = (data.yield||[]).map(y=>y.value||0);
      yieldChart.data.labels = yLabels;
      yieldChart.data.datasets[0].data = yValues;
      yieldChart.data.datasets[0].label =
        (view==='day')?'Daily Yield (kWh)':
        (view==='week')?'Last 7 days (kWh)':
        (view==='month')?'Last 6 months':
        'Year total';
      yieldChart.update();
    }
  }

  async function loadAnalytics(){
    const badge = document.querySelector('#loadingBadge');
    try {
      if (badge) badge.textContent = 'Loading...';
      const data = await fetchAnalytics();
      await ensureChartJs();
      render(data);
    } catch(e){
      console.error(e);
      if (kpiTotal) kpiTotal.textContent='0 kWh';
      if (kpiMeta)  kpiMeta.textContent='No data';
    } finally {
      if (badge) badge.textContent = '';
    }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    if (btnDay)   btnDay.dataset.view='day';
    if (btnWeek)  btnWeek.dataset.view='week';
    if (btnMonth) btnMonth.dataset.view='month';
    if (btnYear)  btnYear.dataset.view='year';

    [btnDay,btnWeek,btnMonth,btnYear].forEach(b=> b && b.addEventListener('click', ()=>{ setActive(b.dataset.view); loadAnalytics(); }));
    if (btnRefresh) btnRefresh.addEventListener('click', loadAnalytics);
    if (plantSel)   plantSel.addEventListener('change', loadAnalytics);
    if (dateInput)  dateInput.addEventListener('change', loadAnalytics);

    setActive('day');
    if (dateInput && !dateInput.value) dateInput.value = yyyy_mm_dd(new Date());
    loadAnalytics();
  });
})();
