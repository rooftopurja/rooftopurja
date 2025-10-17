# unify-ui.ps1 — single topbar + clean headers

# --- A) Unified nav files ---
@"
<header class=""topbar"">
  <div class=""container"">
    <nav aria-label=""Primary"">
      <a href=""meter.v2.html"">Meter</a>
      <a href=""inverter_analytics.html"">Inverter Analytics</a>
      <a href=""inverter_data_overview.html"">Inverter Data Overview</a>
      <a href=""inverter_faults.html"">Inverter Faults</a>
      <a href=""maintenance.html"">Maintenance</a>
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
    const here=(location.pathname.split('/').pop()||'').toLowerCase();
    document.querySelectorAll('.topbar a').forEach(a=>{
      const target=(a.getAttribute('href')||'').toLowerCase();
      if(target && here===target) a.classList.add('active');
      if((!here || here==='index.html') && target==='meter.v2.html') a.classList.add('active');
    });
  }catch(e){}
})();
"@ | Set-Content -LiteralPath .\nav.js -Encoding utf8

# --- B) Helper to ensure links and header ---
function Ensure-HeadBits([string]$html, [int]$cb){
  # styles.css (cache-busted)
  if($html -match 'styles\.css'){
    $html = [regex]::Replace($html,'(?i)href=["'']styles\.css[^"'']*["'']',"href=""styles.css?v=$cb""",1)
  } else {
    $html = [regex]::Replace($html,'(?i)</head>',"<link rel=""stylesheet"" href=""styles.css?v=$cb"">`n</head>",1)
  }
  # nav bits once
  if($html -notmatch 'nav\.css'){
    $html = [regex]::Replace($html,'(?i)</head>',"<link rel=""stylesheet"" href=""nav.css?v=$cb"">`n</head>",1)
  }
  if($html -notmatch 'nav\.js'){
    $html = [regex]::Replace($html,'(?i)</head>',"<script src=""nav.js?v=$cb"" defer></script>`n</head>",1)
  }
  return $html
}

# --- C) Patch a page with single topbar + theme + container ---
function Patch-Common([string]$file){
  $cb = [int][double]::Parse((Get-Date -UFormat %s))
  if(!(Test-Path $file)){ Write-Host "SKIP: $file" -ForegroundColor DarkYellow; return $false }
  $h = Get-Content $file -Raw
  $o = $h

  # scrub stray leading slashes/CRs
  $h = $h -replace '^\s*\\+',''
  $h = $h -replace '^\s*\\r',''

  # head links
  $h = Ensure-HeadBits $h $cb

  # normalize body class
  if($h -match '(?i)<body[^>]*class='){
    if($h -notmatch '(?i)theme-meter'){
      $h = [regex]::Replace($h,'(?i)<body([^>]*)class="([^"]*)','<body$1class="theme-meter $2',1)
    }
  } else {
    $h = [regex]::Replace($h,'(?i)<body([^>]*)>','<body class="theme-meter"$1>',1)
  }

  # replace ANY existing <header>…</header> with nav.html
  $nav = Get-Content .\nav.html -Raw
  if($h -match '(?is)<header[^>]*>.*?</header>'){
    $safe = [regex]::Escape($nav) -replace '\\n',"`n"
    $h = [regex]::Replace($h,'(?is)<header[^>]*>.*?</header>',$safe,1)
  } else {
    $h = [regex]::Replace($h,'(?i)<body([^>]*)>','<body$1>'+"`n$nav",1)
  }

  # wrap first <main> with .container if page lacks any container (handle both quote styles)
  $hasContainerDouble = $h -match '(?i)class="[^"]*\bcontainer\b'
  $hasContainerSingle = $h -match "(?i)class='[^']*\bcontainer\b"
  if(($h -match '(?is)<main[^>]*>') -and -not ($hasContainerDouble -or $hasContainerSingle)){
    $h = [regex]::Replace($h,'(?is)<main([^>]*)>','<main$1><div class="container">',1)
    $h = [regex]::Replace($h,'(?is)</main>','</div></main>',1)
  }

  if($h -ne $o){ Set-Content $file $h -Encoding utf8; Write-Host "PATCHED: $file" -ForegroundColor Green; return $true }
  Write-Host "OK: $file" -ForegroundColor Gray; return $false
}

# --- D) Special clean for inverter_analytics: remove the duplicated pill-row header ---
function Patch-InverterAnalytics(){
  $file = 'inverter_analytics.html'
  if(!(Test-Path $file)){ Write-Host "SKIP: $file" -ForegroundColor DarkYellow; return $false }
  $h = Get-Content $file -Raw
  $o = $h

  # remove the “Solar Plant Dashboard + pill links” bar row inside .wrap (before filters)
  $h = [regex]::Replace($h,'(?is)<div class="bar">\s*<h3[^>]*>.*?Solar\s*Plant\s*Dashboard.*?</div>','',1)
  # in case the structure is slightly different, remove any bar with those section links
  $h = [regex]::Replace($h,'(?is)<div class="bar">(?:(?!</div>).)*(Meter|Inverter\s*Analytics|Data\s*Overview|Faults|Maintenance)(?:(?!</div>).)*</div>','',1)

  # then run common normalizer
  $changedCommon = Patch-Common $file
  if($h -ne (Get-Content $file -Raw)){
    # common already rewrote file; reload and re-apply bar removal once more just in case
    $h2 = Get-Content $file -Raw
    $h2 = [regex]::Replace($h2,'(?is)<div class="bar">\s*<h3[^>]*>.*?Solar\s*Plant\s*Dashboard.*?</div>','',1)
    $h2 = [regex]::Replace($h2,'(?is)<div class="bar">(?:(?!</div>).)*(Meter|Inverter\s*Analytics|Data\s*Overview|Faults|Maintenance)(?:(?!</div>).)*</div>','',1)
    Set-Content $file $h2 -Encoding utf8
    Write-Host "CLEANED extra pill-row: $file" -ForegroundColor Green
    return $true
  } else {
    if($h -ne $o){ Set-Content $file $h -Encoding utf8; Write-Host "CLEANED pill-row: $file" -ForegroundColor Green; return $true }
  }
  return $changedCommon
}

# --- E) Apply patches ---
$any = $false
$any = (Patch-Common 'meter.v2.html') -or $any
$any = (Patch-InverterAnalytics) -or $any
$any = (Patch-Common 'inverter_data_overview.html') -or $any
$any = (Patch-Common 'inverter_faults.html') -or $any
$any = (Patch-Common 'maintenance.html') -or $any

# --- F) Rebuild dist and push ---
if(Test-Path .\build.sh){
  $raw = (Get-Content .\build.sh -Raw) -replace "`r`n","`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText("$PWD/build.sh",$raw,$utf8NoBom)
  git update-index --chmod=+x build.sh
}
if (Get-Command bash -ErrorAction SilentlyContinue) { bash ./build.sh } else { Write-Host "bash not found; skipping build.sh" -ForegroundColor Yellow }

git add -A
git commit -m "UI: unify topbar (nav.html/css/js); remove duplicate headers; ensure container/theme; normalize build.sh" | Out-Null
git push origin main
