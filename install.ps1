$ErrorActionPreference = "Stop"

$Repository = "qoherent/sigil"
$DefaultVersion = "__SIGIL_VERSION__"
$Version = if ($env:SIGIL_VERSION) { $env:SIGIL_VERSION } else { $DefaultVersion }
$InstallRoot = if ($env:SIGIL_INSTALL_DIR) { $env:SIGIL_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Sigil" }
$BinDir = if ($env:SIGIL_BIN_DIR) { $env:SIGIL_BIN_DIR } else { Join-Path $InstallRoot "bin" }

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Sigil supports only 64-bit Windows."
}
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "x86")) {
  throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE"
}

$Asset = "sigil-x86_64-pc-windows-msvc.zip"
$Base = "https://github.com/$Repository/releases/download/cli-v$Version"
$Temp = Join-Path ([IO.Path]::GetTempPath()) "sigil-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $Temp | Out-Null

try {
  Invoke-WebRequest -Uri "$Base/$Asset" -OutFile (Join-Path $Temp $Asset)
  Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile (Join-Path $Temp "checksums.txt")
  $Line = Get-Content (Join-Path $Temp "checksums.txt") | Where-Object { $_ -match "\s+$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $Line) { throw "Checksum entry for $Asset is missing." }
  $Expected = ($Line -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash (Join-Path $Temp $Asset) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "Checksum verification failed for $Asset." }

  Expand-Archive -Path (Join-Path $Temp $Asset) -DestinationPath $Temp
  $Source = Join-Path $Temp "sigil-$Version"
  $Executable = Join-Path $Source "bin\sigil.exe"
  if (-not (Test-Path $Executable -PathType Leaf)) { throw "Archive does not contain bin\sigil.exe." }

  $Versions = Join-Path $InstallRoot "versions"
  $Destination = Join-Path $Versions $Version
  New-Item -ItemType Directory -Force -Path $Versions, $BinDir | Out-Null
  $Replacement = Join-Path $Versions ".sigil-$Version-$PID"
  if (Test-Path $Replacement) { Remove-Item -Recurse -Force $Replacement }
  Move-Item $Source $Replacement
  if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
  Move-Item $Replacement $Destination

  $Wrapper = Join-Path $BinDir "sigil.cmd"
  $WrapperTemp = "$Wrapper.$PID"
  Set-Content -Path $WrapperTemp -Encoding Ascii -Value "@echo off`r`n`"$Destination\bin\sigil.exe`" %*"
  Move-Item -Force $WrapperTemp $Wrapper

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $Parts = @($UserPath -split ";" | Where-Object { $_ })
  if ($Parts -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable("Path", (($Parts + $BinDir) -join ";"), "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "Added $BinDir to your user PATH. Open a new terminal to use it."
  }
  Write-Host "Installed Sigil $Version to $Destination"
  Write-Host "Run: sigil skill install"
}
finally {
  if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }
}
