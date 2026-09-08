# Spirit CLI installer for Windows.
# Usage: irm https://spirit.dev/install.ps1 | iex
#
# Optional environment variables:
#   SPIRIT_HOME     Install root (default: %LOCALAPPDATA%\Spirit)
#   SPIRIT_VERSION  Version segment (default: latest)

$ErrorActionPreference = 'Stop'

$SpiritDownloadHost = if ($env:SPIRIT_DOWNLOAD_HOST) { $env:SPIRIT_DOWNLOAD_HOST } else { '__SPIRIT_DOWNLOAD_HOST__' }
$SpiritHome = if ($env:SPIRIT_HOME) { $env:SPIRIT_HOME } else { Join-Path $env:LOCALAPPDATA 'Spirit' }
$SpiritVersion = if ($env:SPIRIT_VERSION) { $env:SPIRIT_VERSION } else { 'latest' }

function Write-Info([string]$Message) {
  Write-Host "+ $Message"
}

function Write-Warn([string]$Message) {
  Write-Host "! $Message" -ForegroundColor Yellow
}

function Get-SpiritArch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  $archWow = $env:PROCESSOR_ARCHITEW6432

  if ($arch -eq 'ARM64' -or $archWow -eq 'ARM64') {
    return 'arm64'
  }
  if ($arch -eq 'AMD64' -or $archWow -eq 'AMD64') {
    return 'x64'
  }
  if ($arch -eq 'x86') {
    throw '32-bit Windows (x86) is not supported. Spirit CLI requires 64-bit Windows (x64 or ARM64).'
  }
  throw "Unsupported architecture: $arch (supported: x64, arm64)"
}

function Get-CliArchiveName([string]$Arch) {
  return "Spirit-CLI-windows-$Arch.zip"
}

function Get-CliDownloadUrl([string]$Arch, [string]$Version) {
  $fileName = Get-CliArchiveName -Arch $Arch
  return "https://$SpiritDownloadHost/cli/windows/$Arch/$Version/$fileName"
}

function Get-GithubChecksumsUrl([string]$Version) {
  if ($Version -eq 'latest') {
    return 'https://github.com/SpiritAgents/spirit/releases/latest/download/SHA256SUMS.txt'
  }
  return "https://github.com/SpiritAgents/spirit/releases/download/$Version/SHA256SUMS.txt"
}

function Get-GithubCliAssetName([string]$Arch, [string]$Version) {
  return "Spirit-CLI-$Version-windows-$Arch.zip"
}

function Get-ExpectedSha256FromSums([string]$Sums, [string]$Arch, [string]$Version) {
  $versionRe = '\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?'
  $nameRe = "^Spirit-CLI-$versionRe-windows-$([regex]::Escape($Arch))\.zip$"
  $pinnedName = Get-GithubCliAssetName -Arch $Arch -Version $Version
  $found = New-Object System.Collections.Generic.List[string]

  foreach ($rawLine in ($Sums -split '\r?\n')) {
    $line = $rawLine.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) {
      continue
    }

    $tokens = $line -split '\s+'
    if ($tokens.Count -lt 2) {
      continue
    }

    $hash = $tokens[0]
    $name = $tokens[$tokens.Count - 1].TrimStart('*')

    $isMatch = $false
    if ($Version -eq 'latest') {
      $isMatch = $name -match $nameRe
    } else {
      $isMatch = $name -eq $pinnedName
    }

    if ($isMatch) {
      [void]$found.Add($hash)
    }
  }

  if ($found.Count -eq 0) {
    if ($Version -eq 'latest') {
      throw "SHA256SUMS.txt has no CLI entry for windows/$Arch"
    }
    throw "SHA256SUMS.txt has no entry for $pinnedName"
  }
  if ($found.Count -gt 1) {
    throw "SHA256SUMS.txt has multiple CLI entries for windows/$Arch"
  }
  return $found[0]
}

function Ensure-UserPath([string]$BinDir) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) {
    $userPath = ''
  }

  $parts = $userPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' }
  $normalizedBin = [System.IO.Path]::GetFullPath($BinDir).TrimEnd('\')
  $alreadyPresent = $false
  foreach ($part in $parts) {
    try {
      $normalizedPart = [System.IO.Path]::GetFullPath($part).TrimEnd('\')
      if ([string]::Equals($normalizedPart, $normalizedBin, [System.StringComparison]::OrdinalIgnoreCase)) {
        $alreadyPresent = $true
        break
      }
    } catch {
      # Ignore malformed PATH entries.
    }
  }

  if ($alreadyPresent) {
    Write-Info "PATH already contains $BinDir"
  } else {
    $newPath = if ($userPath.Trim() -eq '') { $BinDir } else { "$userPath;$BinDir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Info "Added $BinDir to user PATH"
  }

  if ($env:Path -notlike "*$BinDir*") {
    $env:Path = "$BinDir;$env:Path"
  }
}

function Install-SpiritShim([string]$SourceExe, [string]$BinDir) {
  $destExe = Join-Path $BinDir 'spirit.exe'
  $destCmd = Join-Path $BinDir 'spirit.cmd'

  if (Test-Path -LiteralPath $destExe) {
    Remove-Item -LiteralPath $destExe -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $destCmd) {
    Remove-Item -LiteralPath $destCmd -Force -ErrorAction SilentlyContinue
  }

  # Prefer a symlink so `spirit` resolves to the real bundle binary (needed for
  # current_exe()-based node/packages lookup). Copying the .exe alone breaks that.
  try {
    New-Item -ItemType SymbolicLink -Path $destExe -Target $SourceExe | Out-Null
    Write-Info "Linked $destExe -> $SourceExe"
    return $destExe
  } catch {
    Write-Warn 'Symbolic link failed (may need Developer Mode); writing spirit.cmd shim'
  }

  $cmd = @"
@echo off
"%~dp0..\cli\current\bin\spirit.exe" %*
"@
  Set-Content -LiteralPath $destCmd -Value $cmd -Encoding ASCII
  Write-Info "Wrote shim $destCmd"
  return $destCmd
}

$arch = Get-SpiritArch
$url = Get-CliDownloadUrl -Arch $arch -Version $SpiritVersion
$checksumsUrl = Get-GithubChecksumsUrl -Version $SpiritVersion
$binDir = Join-Path $SpiritHome 'bin'
$cliDir = Join-Path $SpiritHome 'cli'
$currentDir = Join-Path $cliDir 'current'
$stagingDir = Join-Path $cliDir 'current.next'

Write-Info 'Installing Spirit CLI'
Write-Info "Platform: windows/$arch"
Write-Info "SPIRIT_HOME: $SpiritHome"
Write-Info "Version: $SpiritVersion"
Write-Info "Download: $url"
Write-Info "Checksums: $checksumsUrl"

Write-Info 'Fetching checksums...'
try {
  $sumsResponse = Invoke-WebRequest -Uri $checksumsUrl -UseBasicParsing
} catch {
  throw "failed to fetch SHA256SUMS.txt from GitHub ($checksumsUrl)"
}
$sums = [string]$sumsResponse.Content
if ([string]::IsNullOrWhiteSpace($sums)) {
  throw 'SHA256SUMS.txt from GitHub was empty'
}
$expected = Get-ExpectedSha256FromSums -Sums $sums -Arch $arch -Version $SpiritVersion

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("spirit-install-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $tmpRoot 'cli.zip'
$extractRoot = Join-Path $tmpRoot 'extract'

try {
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

  Write-Info 'Downloading...'
  Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing

  Write-Info 'Verifying checksum...'
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ($actual.ToLowerInvariant() -ne $expected.ToLowerInvariant()) {
    throw "SHA-256 mismatch for windows/$arch (expected $expected, got $actual)"
  }

  Write-Info 'Extracting...'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force

  $bundleRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
  if (-not $bundleRoot) {
    throw 'Archive did not contain a top-level directory'
  }

  $sourceExe = Join-Path $bundleRoot.FullName 'bin\spirit.exe'
  if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw 'Archive missing bin\spirit.exe'
  }

  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  New-Item -ItemType Directory -Path $cliDir -Force | Out-Null

  if (Test-Path -LiteralPath $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }
  Move-Item -LiteralPath $bundleRoot.FullName -Destination $stagingDir

  if (Test-Path -LiteralPath $currentDir) {
    Remove-Item -LiteralPath $currentDir -Recurse -Force
  }
  Move-Item -LiteralPath $stagingDir -Destination $currentDir

  $installedExe = Join-Path $currentDir 'bin\spirit.exe'
  $entryPoint = Install-SpiritShim -SourceExe $installedExe -BinDir $binDir

  Ensure-UserPath -BinDir $binDir

  Write-Info "Installed to $currentDir"
  Write-Info "Entry point: $entryPoint"

  try {
    $versionOutput = & $installedExe --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $versionOutput) {
      Write-Info "spirit --version: $versionOutput"
    } else {
      Write-Warn 'spirit is installed but --version failed; open a new terminal and retry'
    }
  } catch {
    Write-Warn 'spirit is installed but could not be executed yet; open a new terminal and retry'
  }

  Write-Host ''
  Write-Info 'Done. Open a new PowerShell window, or refresh PATH, then run:'
  Write-Host '  spirit --version'
} finally {
  if (Test-Path -LiteralPath $tmpRoot) {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
