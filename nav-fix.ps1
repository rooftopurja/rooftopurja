$ErrorActionPreference = "Stop"

# pages to patch
$pages = @('meter.v2.html','inverter_analytics.html','inverter_data_overview.html','inverter_faults.html','maintenance.html')
$cb    = [int][double]::Parse((Get-Date -UFormat %s))
$nav   = Get-Content .\nav.html -Raw
$navRepl = $nav -replace '\$','$$'   # neutralize $ in replacement strings

# regex patterns (kept in single-quoted literals so we don't fight escaping)
$pat_BadTopLine        = '^\s*\\.*\r?\n'
$pat_HeadClose         = '(?i)</head>'
$pat_HeaderBlock       = '(?is)<header[^>]*>.*?</header>'
$pat_BodyOpen          = '(?i)<body([^>]*)>'
$pat_HasBodyClass      = '(?i)<body[^>]*class='
$pat_ThemeMeter        = '(?i)theme-meter'
$pat_MainOpen          = '(?is)<main([^>]*)>'
$pat_MainClose         = '(?is)</main>'
$pat_ContainerAnywhere = '(?i)class\s*=\s*["''][^"'']*\bcontainer\b'
$pat_TopH1BeforeMain   = '(?is)(<body[^>]*>.*?)(<h1[^>]*>.*?</h1>)(.*?<main\b)'

foreach($p in $pages){
  if(!(Test-Path $p)){ Write-Host "SKIP: $p (missing)" -ForegroundColor DarkYellow; continue }
  $h = Get-Content $p -Raw
  $o = $h

  # 0) remove any stray backslash line at very top
  $h = [regex]::Replace($h, $pat_BadTopLine, "", [System.Text.RegularExpressions.RegexOptions]::Multiline)

  # 1) styles.css (cache-busted)
  if($h -match 'styles\.css'){
    $h = [regex]::Replace($h,'(?i)href=["'']styles\.css[^"'']*["'']',"href=""styles.css?v=$cb""")
  } else {
    $h = [regex]::Replace($h,$pat_HeadClose,"<link rel=""stylesheet"" href=""styles.css?v=$cb"">`n</head>")
  }

  # 2) nav.css + nav.js (once, cache-busted)
  if($h -notmatch 'nav\.css'){ $h = [regex]::Replace($h,$pat_HeadClose,"<link rel=""stylesheet"" href=""nav.css?v=$cb"">`n</head>") }
  if($h -notmatch 'nav\.js'){  $h = [regex]::Replace($h,$pat_HeadClose,"<script src=""nav.js?v=$cb"" defer></script>`n</head>") }

  # 3) replace <header>…</header> with RAW nav.html; else inject right after <body>
  if($h -match $pat_HeaderBlock){
    $h = [regex]::Replace($h,$pat_HeaderBlock,$navRepl,1)
  } else {
    $afterBody = '<body$1>' + "`n" + $navRepl
    $h = [regex]::Replace($h,$pat_BodyOpen,$afterBody,1)
  }

  # 4) ensure body has theme-meter (preserve existing classes)
  if($h -match $pat_HasBodyClass){
    if($h -notmatch $pat_ThemeMeter){
      $h = [regex]::Replace($h,'(?i)<body([^>]*)class="([^""]*)','<body$1class="theme-meter $2',1)
    }
  } else {
    $h = [regex]::Replace($h,$pat_BodyOpen,'<body class="theme-meter"$1>',1)
  }

  # 5) drop lone H1 before first <main>
  $h = [regex]::Replace($h,$pat_TopH1BeforeMain,'${1}${3}',1)

  # 6) wrap first <main> with .container if none exists anywhere
  if(($h -match $pat_MainOpen) -and ($h -notmatch $pat_ContainerAnywhere)){
    $h = [regex]::Replace($h,$pat_MainOpen,'<main$1><div class="container">',1)
    $h = [regex]::Replace($h,$pat_MainClose,'</div></main>',1)
  }

  if($h -ne $o){ Set-Content $p $h -Encoding utf8; Write-Host "PATCHED: $p" -ForegroundColor Green }
  else { Write-Host "OK: $p" -ForegroundColor Gray }
}

# normalize build.sh (LF, no BOM) and make executable for CI
$raw = (Get-Content .\build.sh -Raw) -replace "`r`n","`n"
[System.IO.File]::WriteAllText("$PWD/build.sh",$raw,[System.Text.UTF8Encoding]::new($false))
git update-index --chmod=+x build.sh

# rebuild dist and push
bash ./build.sh
git add -A
git commit -m "UX: header fix — inject raw nav.html, add nav.css/js, remove top H1, ensure container + theme"
git push origin main
