$ErrorActionPreference = "Stop"

$Repository = "qoherent/sigil"
$DefaultVersion = "__SIGIL_VERSION__"
$Version = if ($env:SIGIL_VERSION) { $env:SIGIL_VERSION } else { $DefaultVersion }
$InstallRoot = if ($env:SIGIL_INSTALL_DIR) { $env:SIGIL_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Sigil" }
$BinDir = if ($env:SIGIL_BIN_DIR) { $env:SIGIL_BIN_DIR } else { Join-Path $InstallRoot "bin" }
if (-not [Environment]::Is64BitOperatingSystem) { throw "Sigil supports only 64-bit Windows." }
if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "ARM64")) { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }

$Archive = $env:SIGIL_ARCHIVE_PATH
$Checksums = $env:SIGIL_CHECKSUMS_PATH
if ([bool]$Archive -xor [bool]$Checksums) { throw "SIGIL_ARCHIVE_PATH and SIGIL_CHECKSUMS_PATH must be supplied together." }
$Temp = Join-Path ([IO.Path]::GetTempPath()) "sigil-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  if (-not $Archive) {
    $Asset = "sigil-x86_64-pc-windows-msvc.zip"
    $Base = "https://github.com/$Repository/releases/download/cli-v$Version"
    $Archive = Join-Path $Temp $Asset
    $Checksums = Join-Path $Temp "checksums.txt"
    Invoke-WebRequest -Uri "$Base/$Asset" -OutFile $Archive
    Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile $Checksums
  } else {
    if (-not (Test-Path $Archive -PathType Leaf) -or -not (Test-Path $Checksums -PathType Leaf)) { throw "Local installer inputs do not exist." }
  }
  $Asset = [IO.Path]::GetFileName($Archive)
  $Line = Get-Content $Checksums | Where-Object { $_ -match "\s+$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $Line) { throw "Checksum entry for $Asset is missing." }
  $Expected = ($Line -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "Checksum verification failed for $Asset." }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($Entry in $Zip.Entries) {
      $Name = $Entry.FullName.Replace('\', '/')
      if ([IO.Path]::IsPathRooted($Name) -or $Name -match '(^|/)\.\.?(/|$)' -or $Name.Contains('//')) {
        throw "Archive contains an unsafe path: $Name"
      }
      if ($Name -ne "sigil-$Version" -and -not $Name.StartsWith("sigil-$Version/")) {
        throw "Archive contains an unexpected top-level path: $Name"
      }
      $UnixType = (($Entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($UnixType -eq 0xA000) { throw "Archive contains a symbolic link: $Name" }
    }
  } finally {
    $Zip.Dispose()
  }
  Expand-Archive -Path $Archive -DestinationPath $Temp
  $Source = Join-Path $Temp "sigil-$Version"
  $Executable = Join-Path $Source "bin\sigil.exe"
  $Compiler = Join-Path $Source "bin\sigilc.exe"
  if (-not (Test-Path $Executable -PathType Leaf)) { throw "Archive does not contain bin\sigil.exe." }
  if (-not (Test-Path $Compiler -PathType Leaf)) { throw "Archive does not contain bin\sigilc.exe." }
  if (Test-Path (Join-Path $Source "lib\sigil\runtime")) { throw "Archive contains obsolete runtime payloads." }
  if (Get-ChildItem $Source -Recurse -Force | Where-Object { $_.LinkType }) { throw "Archive contains a symbolic link." }
  $Prefix = $Actual.Substring(0, 16)
  $Versions = Join-Path $InstallRoot "versions"
  $Destination = Join-Path $Versions "$Version-$Prefix"
  New-Item -ItemType Directory -Force -Path $Versions, $BinDir | Out-Null
  if (Test-Path $Destination) {
    $Files = @(Get-ChildItem $Source -File -Recurse -Force)
    $Existing = @(Get-ChildItem $Destination -File -Recurse -Force)
    if ($Files.Count -ne $Existing.Count -or (Get-ChildItem $Destination -Recurse -Force | Where-Object { $_.LinkType })) { throw "Existing installation differs from verified archive." }
    foreach ($File in $Files) {
      $Relative = $File.FullName.Substring($Source.Length).TrimStart('\', '/')
      $InstalledFile = Join-Path $Destination $Relative
      if (-not (Test-Path $InstalledFile -PathType Leaf) -or (Get-FileHash $InstalledFile -Algorithm SHA256).Hash -ne (Get-FileHash $File.FullName -Algorithm SHA256).Hash) { throw "Existing installation differs from verified archive: $Relative" }
    }
  } else {
    Move-Item $Source $Destination
  }
  $LanguageVersion = & (Join-Path $Destination "bin\sigil.exe") --version
  if ($LASTEXITCODE -ne 0 -or $LanguageVersion -ne $Version) { throw "Language executable version check failed." }
  & (Join-Path $Destination "bin\sigilc.exe") --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Native compiler failed; existing installation remains selected." }
  $Names = @("sigil", "sigilc")
  foreach ($Name in $Names) {
    $Wrapper = Join-Path $BinDir "$Name.cmd"
    $WrapperTemp = "$Wrapper.$PID.tmp"
    $Body = "@echo off`r`n@chcp 65001 >nul`r`n`"$(Join-Path $Destination "bin\$Name.exe")`" %*`r`n"
    [IO.File]::WriteAllText($WrapperTemp, $Body, [Text.UTF8Encoding]::new($false))
  }
  foreach ($Name in $Names) {
    $Wrapper = Join-Path $BinDir "$Name.cmd"
    Move-Item -Force "$Wrapper.$PID.tmp" $Wrapper
  }
  $ClaimsWrapper = Join-Path $BinDir "sigil-claims.cmd"
  if (Test-Path $ClaimsWrapper -PathType Leaf) {
    $ClaimsBody = [IO.File]::ReadAllText($ClaimsWrapper)
    $ManagedClaimsWrapper = '(?s)\A@echo off\r\n@chcp 65001 >nul\r\n"[^"\r\n]+[\\/]versions[\\/][^\\/\r\n"]+[\\/]bin[\\/]sigil-claims\.exe" %\*\r\n\z'
    if ($ClaimsBody -match $ManagedClaimsWrapper) { Remove-Item -Force $ClaimsWrapper }
  }
  Write-Host "Installed Sigil $Version to $Destination"
} finally {
  if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }
}
