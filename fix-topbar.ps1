# fix-topbar.ps1 — unify topbar, remove duplicate page headers, rebuild dist

# --- A) Write unified nav files ---
@"
<header class="topbar">
  <div class="container">
    <nav aria-label="Primary">
      <a href="meter.v2.html">Meter</a>
      <a href="inverter_analytics.html">Inverter Analytics</a>
      <a href="inverter_data_overview.html">Inverter Data Overview</a>
      <a href="inverter_faults.html">Inverter Faults</a>
      <a href="maintenance.html">Maintenance</a>
    </nav>
  </div>
</header>
"@ | Set-Content -LiteralPath .\nav.html -Encoding utf8

@"
.topbar{position:sticky;top:0;z-index:100;background:#fff;border-bottom:1px solid var(--line)}
.topbar .container{max-width:1200px;margin:0 auto;padding:10px 16px}
.topbar nav{display:flex;gap:10px;flex-wrap:wrap}
.topbar a{display:inline-block;padding:8px 12px;border-radius:12px;text-decoration:none;color:#334155}
.topbar a:hover,.topbar a.active{background:#eef2ff;color:#0b53e6}
"@ | Set-Content -LiteralPath .\nav.css -Encoding utf8

@"
(function(){
  try{
    const here = (location.pathname.split('/').pop() || '').toLowerCase();
    document.querySelectorAll('.topbar a').forEach(a=>{
      const target = (a.getAttribute('href')||'').toLowerCase();
      if (target && here === target) a.classList.add('active');
      if (!here || here==='index.html') {
        if (target==='meter.v2.html') a.classList.add('active');
      }
    });
  }catch(e){}
})();
"@ | Set-Content -LiteralPath .\nav.js -Encoding utf8

# --- B) Patch pages ---
$pages = @(
  'meter.v2.html',
  'inverter_analytics.html',
  'inverter_data_overview.html',
  'inverter_faults.html',
  'maintenance.html'
)

$cb = [int][double]::Parse((Get-Date -UFormat %s))

function Patch-Page([string]$file){
  if(!(Test-Path $file)){ Write-Host "SKIP (missing): $file" -ForegroundColor DarkYellow; return $false }

  $h = Get-Content $file -Raw
  $o = $h

  # scrub stray leading backslashes/CRs some files had
  $h = $h -replace '^\s*\\+',''
  $h = $h -replace '^\s*\\r',''

  # styles.css (cache-busted)
  if($h -match 'styles\.css'){
    $h = [regex]::Replace($h,'(?i)href=["'']styles\.css[^"'']*["'']',"href=""styles.css?v=$cb""",1)
  } else {
    $h = [regex]::Replace($h,'(?i)</head>',"<link rel=""stylesheet"" href=""styles.css?v=$cb"">`n</head>",1)
  }

  # nav.css + nav.js (once)
  if($h -notmatch 'nav\.css'){
    $h = [regex]::Replace($h,'(?i)</head>',"<link rel=""stylesheet"" href=""nav.css?v=$cb"">`n</head>",1)
  }
  if($h -notmatch 'nav\.js'){
    $h = [regex]::Replace($h,'(?i)</head>',"<script src=""nav.js?v=$cb"" defer></script>`n</head>",1)
  }

  # replace any <header>…</header> with our nav; otherwise inject after <body>
  $nav = Get-Content .\nav.html -Raw
  if($h -match '(?is)<header[^>]*>.*?</header>'){
    $safe = [regex]::Escape($nav) -replace '\\n',"`n"
    $h = [regex]::Replace($h,'(?is)<header[^>]*>.*?</header>',$safe,1)
  } else {
    $h = [regex]::Replace($h,'(?i)<body([^>]*)>','<body$1>'+"`n$nav",1)
  }

  # ensure body has theme class
  if($h -match '(?i)<body[^>]*class='){
    if($h -notmatch '(?i)theme-meter'){
      $h = [regex]::Replace($h,'(?i)<body([^>]*)class="([^"]*)','<body$1class="theme-meter $2',1)
    }
  } else {
    $h = [regex]::Replace($h,'(?i)<body([^>]*)>','<body class="theme-meter"$1>',1)
  }

  # remove first H1 before <main> (the big page title)
  $h = [regex]::Replace($h,'(?is)(<body[^>]*>.*?)(<h1[^>]*>.*?</h1>\s*)(.*?<main\b)','${1}${3}',1)

  # remove any row of tabs/links before <main> (double header)
  $linkNames = '(Meter|Inverter\s*Analytics|Inverter\s*Data\s*Overview|Inverter\s*Faults|Maintenance)'
  $h = [regex]::Replace($h,"(?is)(<body[^>]*>.*?)(?:\s*<a[^>]*>\s*$linkNames\s*</a>[^<]*){2,}\s*(.*?<main\b)",'${1}${2}',1)

  # wrap first <main> with .container if none on page
  if(($h -match '(?is)<main[^>]*>') -and ($h -notmatch '(?i)class=["''][^"']*container[^"']*["'']')){
    $h = [regex]::Replace($h,'(?is)<main([^>]*)>','<main$1><div class="container">',1)
    $h = [regex]::Replace($h,'(?is)</main>','</div></main>',1)
  }

  if($h -ne $o){
    Set-Content $file $h -Encoding utf8
    Write-Host "PATCHED: $file" -ForegroundColor Green
    return $true
  } else {
    Write-Host "OK: $file" -ForegroundColor Gray
    return $false
  }
}

$changed = $false
$pages | ForEach-Object { if(Patch-Page $_){ $changed = $true } }

# --- C) rebuild dist and push ---
# normalize build.sh to LF + no BOM
if(Test-Path .\build.sh){
  $raw = (Get-Content .\build.sh -Raw) -replace "`r`n","`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText("$PWD/build.sh",$raw,$utf8NoBom)
  git update-index --chmod=+x build.sh
}

if (Get-Command bash -ErrorAction SilentlyContinue) {
  bash ./build.sh
} else {
  Write-Host "bash not found; skipping build.sh" -ForegroundColor Yellow
}

git add -A
git commit -m "UI: single unified topbar (nav.html/nav.css/nav.js); remove duplicate page headers; tidy container/theme; normalize build.sh"
git push origin main
