param(
  [string[]]$Pages = @(
    "meter.v2.html",
    "inverter_analytics.html",
    "inverter_data_overview.html",
    "inverter_faults.html",
    "maintenance.html"
  )
)

$enc1252   = [System.Text.Encoding]::GetEncoding(1252)
$encUtf8NB = New-Object System.Text.UTF8Encoding($false)

foreach($p in $Pages){
  if(!(Test-Path $p)){ Write-Host "skip $p" -ForegroundColor DarkYellow; continue }

  # Load as text that’s currently mojibake
  $t = Get-Content $p -Raw

  # Re-interpret as 1252 bytes, re-decode as UTF-8 (undoes Ã¢â‚¬… style junk)
  $bytes = $enc1252.GetBytes($t)
  $fixed = [System.Text.Encoding]::UTF8.GetString($bytes)

  # Normalize common punctuation and collapse stray NBSPs
  $fixed = $fixed `
    -replace '—|–','-' `
    -replace '[“”]','"' `
    -replace '[‘’]',"'" `
    -replace '\u00A0',' '

  # If anything stubborn remains, strip non-ASCII in visible text between tags
  $fixed = [regex]::Replace($fixed, '(>)([^<]*?)(<)', {
      $left,$txt,$right = $args[0].Groups[1].Value,$args[0].Groups[2].Value,$args[0].Groups[3].Value
      $txt = $txt -replace '[^\x09\x0A\x0D\x20-\x7E]',''
      return $left + $txt + $right
  })

  # Ensure proper charset
  if($fixed -notmatch '(?i)<meta\s+charset="?utf-8"?'){
    $fixed = [regex]::Replace($fixed,'(?i)<head>','<head>'+"`n  <meta charset=""utf-8"">",1)
  }

  [System.IO.File]::WriteAllText((Resolve-Path $p), $fixed, $encUtf8NB)
  Copy-Item $p (Join-Path .\dist (Split-Path $p -Leaf)) -Force
  Write-Host "cleaned $p" -ForegroundColor Green
}
