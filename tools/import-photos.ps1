# Resizes field-survey photos into assets/photos/<cafe id>/ and writes their paths into data/cafes.csv.
# Usage: powershell -ExecutionPolicy Bypass -File tools\import-photos.ps1 -Src <folder with one subfolder per cafe>
param([Parameter(Mandatory = $true)][string]$Src, [int]$MaxSize = 1280, [long]$Quality = 80)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$map = [IO.File]::ReadAllText((Join-Path $root "tools\photo-map.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$cropFile = Join-Path $root "tools\photo-crops.json"
$crops = if (Test-Path $cropFile) { [IO.File]::ReadAllText($cropFile, [Text.Encoding]::UTF8) | ConvertFrom-Json } else { $null }
$excludeFile = Join-Path $root "tools\photo-exclude.json"
$exclude = if (Test-Path $excludeFile) { @([IO.File]::ReadAllText($excludeFile, [Text.Encoding]::UTF8) | ConvertFrom-Json) } else { @() }
$blurFile = Join-Path $root "tools\photo-blurs.json"
$blurs = if (Test-Path $blurFile) { [IO.File]::ReadAllText($blurFile, [Text.Encoding]::UTF8) | ConvertFrom-Json } else { $null }
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$enc = New-Object Drawing.Imaging.EncoderParameters 1
$enc.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), $Quality
$paths = @{}
foreach ($p in $map.PSObject.Properties) {
  $dir = Join-Path $Src $p.Name; $id = $p.Value
  if (-not (Test-Path $dir)) { "missing folder: $($p.Name)"; continue }
  $outDir = Join-Path $root "assets\photos\$id"
  New-Item -ItemType Directory -Force $outDir | Out-Null
  Get-ChildItem $outDir -File | Remove-Item -Confirm:$false
  $i = 0; $list = @()
  foreach ($f in Get-ChildItem $dir -File -Include *.jpg, *.jpeg, *.png -Recurse | Sort-Object Name) {
    if ($exclude -contains "$($p.Name)/$($f.Name)") { continue }   # e.g. photos we don't have rights to publish
    $i++
    $img = [Drawing.Image]::FromFile($f.FullName)
    # Apply EXIF orientation so phone photos are upright
    if ($img.PropertyIdList -contains 0x0112) {
      switch ([BitConverter]::ToUInt16($img.GetPropertyItem(0x0112).Value, 0)) {
        3 { $img.RotateFlip('Rotate180FlipNone') } 6 { $img.RotateFlip('Rotate90FlipNone') } 8 { $img.RotateFlip('Rotate270FlipNone') }
      }
    }
    # Optional pixelation of rectangles [x, y, w, h] in source pixels, e.g. bystanders' faces
    $blurKey = "$($p.Name)/$($f.Name)"
    if ($blurs -and $blurs.PSObject.Properties[$blurKey]) {
      $gi = [Drawing.Graphics]::FromImage($img)
      $gi.InterpolationMode = 'NearestNeighbor'; $gi.PixelOffsetMode = 'Half'
      foreach ($rc in $blurs.$blurKey) {
        $bx, $by, $bw, $bh = [int]$rc[0], [int]$rc[1], [int]$rc[2], [int]$rc[3]
        # Coarse blocks (about 3 rows) so faces and plate numbers can't be read
        $block = [math]::Max(24, [int]([math]::Min($bw, $bh) / 3))
        $sw = [math]::Max(1, [int]($bw / $block)); $sh = [math]::Max(1, [int]($bh / $block))
        $small = New-Object Drawing.Bitmap $sw, $sh
        $gs = [Drawing.Graphics]::FromImage($small)
        $gs.DrawImage($img, (New-Object Drawing.Rectangle 0, 0, $sw, $sh), (New-Object Drawing.Rectangle $bx, $by, $bw, $bh), [Drawing.GraphicsUnit]::Pixel)
        $gs.Dispose()
        $gi.DrawImage($small, (New-Object Drawing.Rectangle $bx, $by, $bw, $bh), (New-Object Drawing.Rectangle 0, 0, $sw, $sh), [Drawing.GraphicsUnit]::Pixel)
        $small.Dispose()
      }
      $gi.Dispose()
    }
    # Optional crop (fraction of width to keep from the left), e.g. to cut out bystanders
    $keep = 1.0
    $cropKey = "$($p.Name)/$($f.Name)"
    if ($crops -and $crops.PSObject.Properties[$cropKey]) { $keep = [double]$crops.$cropKey }
    $srcW = [int]($img.Width * $keep)
    $scale = [math]::Min([double]1, [double]$MaxSize / [math]::Max($srcW, $img.Height))
    $w = [int]($srcW * $scale); $h = [int]($img.Height * $scale)
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($img, (New-Object Drawing.Rectangle 0, 0, $w, $h), (New-Object Drawing.Rectangle 0, 0, $srcW, $img.Height), [Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $name = "$i.jpg"; $bmp.Save((Join-Path $outDir $name), $jpeg, $enc)   # re-encoding also drops EXIF (location data)
    $bmp.Dispose(); $img.Dispose()
    $list += "assets/photos/$id/$name"
  }
  $paths[$id] = $list -join '|'
  "{0} -> {1}: {2} photos" -f $p.Name, $id, $i
}
$csvPath = Join-Path $root "data\cafes.csv"
$rows = Import-Csv $csvPath -Encoding UTF8
foreach ($r in $rows) { if ($paths.ContainsKey($r.id)) { $r.photos = $paths[$r.id] } }
[IO.File]::WriteAllLines($csvPath, ($rows | ConvertTo-Csv -NoTypeInformation), (New-Object Text.UTF8Encoding $true))
$total = (Get-ChildItem (Join-Path $root "assets\photos") -Recurse -File | Measure-Object Length -Sum).Sum
"total size: {0:N1} MB" -f ($total / 1MB)
