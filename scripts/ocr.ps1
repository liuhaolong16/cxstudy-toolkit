# Windows OCR wrapper (pure ASCII on purpose)
#
# Why PowerShell: this machine has Windows.Media.Ocr with en-US and zh-Hans-CN
# recognizers installed. It works fully offline, costs nothing, and needs no
# language pack download. tesseract is not installed and would need a ~4MB model.
#
# Why ASCII only: Windows PowerShell 5.1 reads .ps1 with $OutputEncoding (us-ascii
# here). Any non-ASCII byte corrupts the parser. Comments and output stay English.
#
# Usage:
#   powershell -STA -ExecutionPolicy Bypass -File scripts\ocr.ps1 -ImagePath C:\tmp\captcha.png
#
# Output: the recognized text on one line (newlines collapsed, whitespace trimmed).
# Exit 0 on success with text (may be empty), 1 on failure.

param(
  [Parameter(Mandatory = $true)][string]$ImagePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ImagePath)) {
  Write-Error "image not found: $ImagePath"
  exit 1
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Generic AsTask bridge: PowerShell 5.1 cannot `await`, so WinRT IAsyncOperation
# has to be converted to a .NET Task and waited on.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

if (-not $asTaskGeneric) {
  Write-Error "AsTask bridge not found - WindowsRuntime interop unavailable"
  exit 1
}

function Await($op, $resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null

try {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) {
    Write-Error "no OCR engine available for user profile languages"
    exit 1
  }

  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  # Collapse to a single line so the caller can parse it easily.
  $text = $result.Text -replace '\s+', ' '
  Write-Output $text.Trim()
  exit 0
} catch {
  Write-Error ("ocr failed: " + $_.Exception.Message)
  exit 1
}
