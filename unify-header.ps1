param(
  [string[]]$Pages = @(
    "meter.v2.html",
    "inverter_analytics.html",
    "inverter_data_overview.html",
    "inverter_faults.html",
    "maintenance.html"
  ),
  [string]$NavHtmlPath = "nav.html"
)

$encUtf8NB = New-Object System.Text.UTF8Encoding($false)
$navRaw    = (Get-Content $NavHtmlPath -Raw)
# Escape $ so regex replacement doesn't treat it as a backref
$navForReplace = $navRaw -replace '\$','$$'

foreach($p in $Pages){
  if(!(Test-Path $p)){ Write-Host "skip $p" -ForegroundColor DarkYellow; continue }
  $h = Get-Content $p -Raw
  $o = $h

  # add nav.css + nav.js (once)
  if($h -notmatch '(?i)href=["'']nav\.css'){
    $h = [regex]::Replace($h,'(?i)</head>','  <link rel="stylesheet" href="nav.css">'+"`n</head>",1)
  }
  if($h -notmatch '(?i)src=["'']nav\.js'){
    $h = [regex]::Replace($h,'(?i)</head>','  <script defer src="nav.js"></script>'+"`n</head>",1)
  }

  # remove any existing <header>…</header>
  $h = [regex]::Replace($h,'(?is)<header[^>]*>.*?</header>','')

  # ensure mount exists after <body>
  if($h -match '(?i)<body[^>]*>'){
    if($h -notmatch '(?i)id=["'']topnav["'']'){
      $mount = '<div id="topnav" data-active=""></div>'
      $h = [regex]::Replace($h,'(?i)<body([^>]*)>','<body$1>'+"`n$mount",1)
    }
    # insert raw nav.html after mount
    $replacement = '$1' + "`n" + $navForReplace
    $h = [regex]::Replace($h,'(?is)(<div\s+id=["'']topnav["''][^>]*>\s*</div>)', $replacement, 1)
  }

  if($h -ne $o){
    [System.IO.File]::WriteAllText((Resolve-Path $p), $h, $encUtf8NB)
    Copy-Item $p (Join-Path .\dist (Split-Path $p -Leaf)) -Force
    Write-Host "header fixed $p" -ForegroundColor Green
  } else {
    Write-Host "ok $p" -ForegroundColor Gray
  }
}
