$pages = @(
  "meter.v2.html",
  "inverter_analytics.html",
  "inverter_data_overview.html",
  "inverter_faults.html",
  "maintenance.html"
)

$cb  = [int][double]::Parse((Get-Date -UFormat %s))
$nav = Get-Content .\nav.html -Raw

# regex parts (note the doubled "" and escaped $-groups)
$hasContainer = "(?i)class=[""'][^""']*container"
$hasBodyClass = "(?i)<body[^>]*class="
$themeMeter   = "(?i)theme-meter"
$headClose    = "(?i)</head>"
$bodyOpen     = "(?i)<body([^>]*)>"
$headerBlock  = "(?is)<header[^>]*>.*?</header>"
$mainOpen     = "(?is)<main([^>]*)>"
$mainClose    = "(?is)</main>"
$topH1BeforeMain = "(?is)(<body[^>]*>.*?)(<h1[^>]*>.*?</h1>)(.*?<main\b)"

function Patch-Header([string]$file){
  if(!(Test-Path $file)){ Write-Host "SKIP: $file (missing)" -ForegroundColor DarkYellow; return $false }
  $html = Get-Content $file -Raw
  $orig = $html

  # 1) styles.css (cache-busted)
  if($html -match "styles\.css"){
    $html = [regex]::Replace($html,"(?i)href=[""']styles\.css[^""']*[""']","href=""styles.css?v=$cb""")
  } else {
    $html = [regex]::Replace($html,$headClose,"<link rel=""stylesheet"" href=""styles.css?v=$cb"">`n</head>")
  }

  # 2) nav.css + nav.js once
  if($html -notmatch "nav\.css"){ $html = [regex]::Replace($html,$headClose,"<link rel=""stylesheet"" href=""nav.css?v=$cb"">`n</head>") }
  if($html -notmatch "nav\.js"){  $html = [regex]::Replace($html,$headClose,"<script src=""nav.js?v=$cb"" defer></script>`n</head>") }

  # 3) replace <header>…</header> with nav.html; else inject after <body>
  if($html -match $headerBlock){
    $safe = [regex]::Escape($nav) -replace "\\n","`n"
    $html = [regex]::Replace($html,$headerBlock,$safe,1)
  } else {
    $html = [regex]::Replace($html,$bodyOpen,"<body`$1>`n$nav",1)
  }

  # 4) add body.theme-meter
  if($html -match $hasBodyClass){
    if($html -notmatch $themeMeter){
      $html = [regex]::Replace($html,"(?i)<body([^>]*)class=""([^""]*)","<body`$1class=""theme-meter `$2",1)
    }
  } else {
    $html = [regex]::Replace($html,$bodyOpen,"<body class=""theme-meter""`$1>",1)
  }

  # 5) remove lone top H1 before <main>
  $html = [regex]::Replace($html,$topH1BeforeMain,'${1}${3}',1)

  # 6) wrap <main> with .container if none anywhere
  if(($html -match $mainOpen) -and ($html -notmatch $hasContainer)){
    $html = [regex]::Replace($html,$mainOpen,'<main$1><div class="container">',1)
    $html = [regex]::Replace($html,$mainClose,'</div></main>',1)
  }

  if($html -ne $orig){ Set-Content $file $html -Encoding utf8; Write-Host "PATCHED: $file" -ForegroundColor Green; return $true }
  Write-Host "OK: $file" -ForegroundColor Gray; return $false
}

$any=$false; foreach($p in $pages){ if(Patch-Header $p){ $any=$true } }

if($any){
  # normalize build.sh (LF, no BOM) and make executable in git
  $raw = (Get-Content .\build.sh -Raw) -replace "`r`n","`n"
  [System.IO.File]::WriteAllText("$PWD/build.sh",$raw,[System.Text.UTF8Encoding]::new($false))
  git update-index --chmod=+x build.sh

  bash ./build.sh
  git add -A
  git commit -m "UX: unify header via nav.html + add nav.css/nav.js; normalize to Meter look"
  git push origin main
}else{
  Write-Host "No changes to commit." -ForegroundColor Cyan
}
