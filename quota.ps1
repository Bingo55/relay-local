# Relay quota meter for PowerShell.
#
#   .\quota.ps1
#   .\quota.ps1 -Json
#   .\quota.ps1 -Set qoder -Limit 80
#   .\quota.ps1 -Set kilo -Limit 200 -Window day
#   .\quota.ps1 -Reset qoder
#   .\quota.ps1 -Reset all
#
# Calls the running Relay server at 127.0.0.1:7777. The bars show Relay-observed
# calls against editable local caps; the provider dashboards are authoritative.
[CmdletBinding()]
param(
  [string]$Url = 'http://127.0.0.1:7777',
  [string]$Set = '',
  [int]$Limit = -1,
  [ValidateSet('day', 'week', 'month', 'total')]
  [string]$Window = 'day',
  [string]$Reset = '',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$base = $Url.TrimEnd('/')

function ConvertTo-Ascii {
  param([string]$Text)
  # Windows PowerShell 5.1 consoles are often not UTF-8. Keep the dashboard
  # readable on those consoles without changing the JSON API.
  return ($Text -replace '[^\x20-\x7E]', '-')
}

function Invoke-QuotaApi {
  param([string]$Method, [string]$Path, $Body)
  $params = @{
    Uri = "$base$Path"
    Method = $Method
    TimeoutSec = 8
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 6)
  }
  Invoke-RestMethod @params
}

try {
  if ($Set) {
    if ($Limit -lt 0) { throw 'Use -Set <agent> -Limit <number>.' }
    $body = @{
      agent = $Set
      limit = $Limit
    }
    if ($PSBoundParameters.ContainsKey('Window')) { $body.window = $Window }
    $r = Invoke-QuotaApi -Method POST -Path '/api/quota/config' -Body $body
    if (-not $Json) { Write-Host "Set $(ConvertTo-Ascii $r.agent.label) local cap to $($r.agent.limit) $($r.agent.window) calls." -ForegroundColor Green }
  }

  if ($Reset) {
    $body = @{}
    if ($Reset -ne 'all') { $body.agent = $Reset }
    $r = Invoke-QuotaApi -Method POST -Path '/api/quota/reset' -Body $body
    if (-not $Json) {
      if ($Reset -eq 'all') { Write-Host 'Reset every quota counter.' -ForegroundColor Green }
      else { Write-Host "Reset $Reset quota counter." -ForegroundColor Green }
    }
  }

  $q = Invoke-QuotaApi -Method GET -Path '/api/quota'

  if ($Json) {
    $q | ConvertTo-Json -Depth 8
    exit 0
  }

  Write-Host ''
  Write-Host 'RELAY QUOTA' -ForegroundColor Green
  Write-Host '  Relay-observed calls vs. editable local caps. Provider dashboards win.' -ForegroundColor DarkGray

  if ($q.route) {
    $routeColor = switch ($q.route.level) {
      'green' { 'Green' }
      'orange' { 'Yellow' }
      'red' { 'Red' }
      'out' { 'White' }
      default { 'DarkGray' }
    }
    $routePct = if ($null -eq $q.route.percent) { 'n/a' } else { "$($q.route.percent)%" }
    Write-Host '  next route: ' -NoNewline -ForegroundColor DarkGray
    Write-Host "$(ConvertTo-Ascii $q.route.label) ($routePct)" -ForegroundColor $routeColor
  } else {
    Write-Host '  next route: none eligible (all cooling/out)' -ForegroundColor DarkGray
  }

  Write-Host ''
  $width = 20
  foreach ($a in @($q.agents)) {
    $pct = if ($null -eq $a.percent) { 0 } else { [int]$a.percent }
    $pctText = if ($null -eq $a.percent) { ' n/a' } else { '{0,3}%' -f $pct }
    $filled = [math]::Round(($pct / 100.0) * $width)
    $filled = [math]::Max(0, [math]::Min($width, $filled))

    $color = switch ($a.level) {
      'green' { 'Green' }
      'orange' { 'Yellow' }
      'red' { 'Red' }
      'out' { 'White' }
      default { 'DarkGray' }
    }

    $cap = if ($a.limit -gt 0) { "$($a.used)/$($a.limit) $($a.window)" } else { "$($a.used) calls" }
    $status = if ($a.disabled) { ' off' }
      elseif ($a.cooling) { ' cooling' }
      elseif ($a.out) { " out: $($a.outReason)" }
      elseif ($a.level -eq 'out') { ' out: 95%+' }
      else { '' }

    # ASCII bars render correctly in Windows PowerShell consoles that are not
    # UTF-8, and still look like a meter in Windows Terminal.
    $onBar = '#' * $filled
    $offBar = '-' * ($width - $filled)
    $label = ConvertTo-Ascii ([string]$a.label)
    if ($label.Length -gt 18) { $label = $label.Substring(0, 17) + '~' }
    $label = $label.PadRight(18)

    Write-Host ("  {0} " -f $label) -NoNewline
    Write-Host $onBar -NoNewline -ForegroundColor $color
    Write-Host $offBar -NoNewline -ForegroundColor DarkGray
    Write-Host (" {0}  {1}" -f $pctText, $cap) -NoNewline -ForegroundColor DarkGray
    if ($status) { Write-Host $status -NoNewline -ForegroundColor $color }
    Write-Host ''
  }

  Write-Host ''
  Write-Host '  green <50 | orange 50-79 | red 80-94 | white 95+ / out' -ForegroundColor DarkGray
  Write-Host '  set: .\quota.ps1 -Set <agent> -Limit <n>   reset: .\quota.ps1 -Reset <agent|all>' -ForegroundColor DarkGray
  Write-Host ''
}
catch {
  Write-Host "Relay quota unavailable: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Start Relay first: cd `"$PSScriptRoot`"; npm start" -ForegroundColor DarkGray
  exit 1
}
