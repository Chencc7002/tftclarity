param(
  [string]$Source = (Join-Path $PSScriptRoot '..\assets\tray.png'),
  [string]$Output = (Join-Path $PSScriptRoot '..\assets\tray.ico')
)
# Format conversion only: preserve the project's existing artwork.
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
$iconFrames = @()
try {
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = [IO.MemoryStream]::new()
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $iconFrames += @{ Size = $size; Bytes = $stream.ToArray() }
    } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
  $file = [IO.File]::Create([IO.Path]::GetFullPath($Output))
  $writer = [IO.BinaryWriter]::new($file)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$iconFrames.Count)
    $offset = 6 + 16 * $iconFrames.Count
    foreach ($frame in $iconFrames) {
      $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
      $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
      $offset += $frame.Bytes.Length
    }
    foreach ($frame in $iconFrames) { $writer.Write([byte[]]$frame.Bytes) }
  } finally { $writer.Dispose(); $file.Dispose() }
} finally { $sourceImage.Dispose() }
Write-Output ([IO.Path]::GetFullPath($Output))
