# Builds a single-file version of the app.
#   Claude artifact:  powershell -ExecutionPolicy Bypass -File tools\build-artifact.ps1 -Out <path.html>
#   Double-click file (no server, real street map, photos next to it):
#                     powershell -ExecutionPolicy Bypass -File tools\build-artifact.ps1 -Out <path.html> -Standalone
param([Parameter(Mandatory = $true)][string]$Out, [switch]$Standalone)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$utf8 = New-Object Text.UTF8Encoding $false
function ReadText($p) { [IO.File]::ReadAllText((Join-Path $root $p), [Text.Encoding]::UTF8) }

# Leaflet stylesheet must be inlined (artifacts only allow Google Fonts stylesheets)
$leafletCss = (Invoke-WebRequest -UseBasicParsing "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css").Content

$css = ReadText "styles.css"
$app = ReadText "app.js"
$regions = ReadText "data\regions.js"
$roads = ReadText "data\osm-roads.json"
$csvText = (ReadText "data\cafes.csv").TrimStart([char]0xFEFF)
$csvJson = ConvertTo-Json -InputObject $csvText -Compress
$logo = "data:image/svg+xml;base64," + [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root "assets\logo.svg")))

# Body markup from index.html, without its script tags
$index = ReadText "index.html"
$body = [regex]::Match($index, '(?s)<body>(.*?)<script').Groups[1].Value
$body = $body.Replace('src="assets/logo.svg"', "src=`"$logo`"").Replace('href="./"', 'href="#"')

# Keep the CSS free of "</style" just in case
$html = @"
<title>KAGONGPICK_TITLE</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap">
<style>
$leafletCss
$css
html, body { height: 100%; }
.app { height: 100%; }
</style>
$body
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
window.KAGONGPICK_NO_TILES = true;
window.KAGONGPICK_ROADS = $roads;
$regions
window.KAGONGPICK_INLINE_CSV = { "knu-north": $csvJson };
$app
</script>
"@
if ($Standalone) {
  # A normal web page: real map tiles, no street-data fallback, full document skeleton
  # Opened by double-click (file://) the OSM tile server may refuse images, so draw streets from data instead
  $html = $html.Replace("window.KAGONGPICK_NO_TILES = true;", "window.KAGONGPICK_NO_TILES = location.protocol === 'file:';")
  $html = "<!doctype html>`n<html lang=`"ko`">`n<head>`n<meta charset=`"utf-8`" />`n<meta name=`"viewport`" content=`"width=device-width, initial-scale=1, viewport-fit=cover`" />`n" +
    $html.Replace("$body", "</head>`n<body>`n$body") + "`n</body>`n</html>`n"
}
# Title text kept out of this ASCII-only script
$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("7Lm06rO17ZS9IOqyveu2geuMgCDrtoHrrLg="))
$html = $html.Replace("KAGONGPICK_TITLE", $title)
if ($Standalone -and ($html -notmatch "KAGONGPICK_NO_TILES = location.protocol")) { throw "standalone build is missing the file:// map fallback" }
[IO.File]::WriteAllText($Out, $html, $utf8)
"wrote $Out ($([math]::Round((Get-Item $Out).Length / 1KB)) KB)"
