# Converts an Overpass JSON dump into the compact street data used by the artifact build.
# Data (c) OpenStreetMap contributors, ODbL.
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-roads.ps1 -In osm_raw.json
param([Parameter(Mandatory = $true)][string]$In)
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$raw = [IO.File]::ReadAllText($In, [Text.Encoding]::UTF8) | ConvertFrom-Json
# Invoke-RestMethod decodes Overpass responses as Latin-1; undo that when needed
function FixName([string]$s) {
  if ($s -match '[À-ÿ]') { return [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(28591).GetBytes($s)) }
  return $s
}
$rank = @{ primary = 1; primary_link = 1; secondary = 1; secondary_link = 1; tertiary = 2; tertiary_link = 2; residential = 3; living_street = 3; pedestrian = 3; service = 4 }
$roads = @(); $campus = @()
foreach ($w in $raw.elements) {
  if ($w.type -ne 'way' -or -not $w.geometry) { continue }
  $pts = @($w.geometry | ForEach-Object { , @([math]::Round($_.lat, 5), [math]::Round($_.lon, 5)) })
  if ($w.tags.amenity -eq 'university') { $campus += , $pts; continue }
  $r = $rank[[string]$w.tags.highway]
  if (-not $r) { continue }
  $o = [ordered]@{ r = $r; c = $pts }
  if ($r -le 2 -and $w.tags.name) { $o.n = FixName ([string]$w.tags.name) }
  $roads += [pscustomobject]$o
}
$out = [ordered]@{ attribution = "OpenStreetMap"; roads = $roads; campus = $campus }
$json = $out | ConvertTo-Json -Depth 6 -Compress
[IO.File]::WriteAllText((Join-Path $root "data\osm-roads.json"), $json, (New-Object Text.UTF8Encoding $false))
"roads: $($roads.Count)  campus polygons: $($campus.Count)  size: $([math]::Round($json.Length / 1KB)) KB"
