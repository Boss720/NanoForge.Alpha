<#
.SYNOPSIS
    NanoForge Windows Distribution Installer
.DESCRIPTION
    Installs NanoForge into %LOCALAPPDATA%\NanoForge, creates Desktop and Start Menu
    shortcuts, adds NanoForge to the user PATH, and configures the uninstaller entry.
.PARAMETER InstallDir
    Target installation directory. Default: %LOCALAPPDATA%\NanoForge
.PARAMETER Silent
    Run installation without interactive prompts or pauses.
.PARAMETER NoShortcuts
    Do not create Desktop or Start Menu shortcuts.
.PARAMETER NoPath
    Do not add the installation directory to user PATH.
#>
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\NanoForge",
    [switch]$Silent,
    [switch]$NoShortcuts,
    [switch]$NoPath
)

$ErrorActionPreference = "Stop"

function Write-Banner {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "         NanoForge - Autonomous Swarm Platform            " -ForegroundColor Yellow
    Write-Host "               Windows Installer v0.6.0                   " -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Create-Shortcut {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$Arguments = "",
        [string]$WorkingDirectory = "",
        [string]$Description = "NanoForge Autonomous Swarm Platform",
        [string]$IconLocation = ""
    )

    try {
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = $TargetPath
        if ($Arguments) { $Shortcut.Arguments = $Arguments }
        if ($WorkingDirectory) { $Shortcut.WorkingDirectory = $WorkingDirectory }
        if ($Description) { $Shortcut.Description = $Description }
        if ($IconLocation -and (Test-Path $IconLocation)) { $Shortcut.IconLocation = $IconLocation }
        $Shortcut.Save()
        Write-Host "  [+] Created shortcut: $ShortcutPath" -ForegroundColor Green
    } catch {
        Write-Warning "Failed to create shortcut at $ShortcutPath`: $_"
    }
}

function Add-ToUserPath {
    param([string]$PathToAdd)

    try {
        $CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $PathEntries = if ($CurrentPath) { $CurrentPath -split ";" } else { @() }

        if ($PathEntries -notcontains $PathToAdd) {
            $NewPath = ($PathEntries + $PathToAdd) -join ";"
            [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
            $env:Path = "$env:Path;$PathToAdd"
            Write-Host "  [+] Added to User PATH: $PathToAdd" -ForegroundColor Green
        } else {
            Write-Host "  [i] PATH already contains: $PathToAdd" -ForegroundColor Gray
        }
    } catch {
        Write-Warning "Could not update User PATH: $_"
    }
}

function Register-Uninstaller {
    param(
        [string]$InstallLocation,
        [string]$Version = "0.6.0"
    )

    $RegKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NanoForge"
    try {
        if (-not (Test-Path $RegKeyPath)) {
            New-Item -Path $RegKeyPath -Force | Out-Null
        }

        $UninstallCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallLocation\uninstall-nanoforge.ps1`""
        $QuietUninstallCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallLocation\uninstall-nanoforge.ps1`" -Silent"

        Set-ItemProperty -Path $RegKeyPath -Name "DisplayName" -Value "NanoForge Swarm Platform" -Force
        Set-ItemProperty -Path $RegKeyPath -Name "DisplayVersion" -Value $Version -Force
        Set-ItemProperty -Path $RegKeyPath -Name "Publisher" -Value "NanoForge" -Force
        Set-ItemProperty -Path $RegKeyPath -Name "InstallLocation" -Value $InstallLocation -Force
        Set-ItemProperty -Path $RegKeyPath -Name "UninstallString" -Value $UninstallCmd -Force
        Set-ItemProperty -Path $RegKeyPath -Name "QuietUninstallString" -Value $QuietUninstallCmd -Force
        Set-ItemProperty -Path $RegKeyPath -Name "NoModify" -Value 1 -Type DWord -Force
        Set-ItemProperty -Path $RegKeyPath -Name "NoRepair" -Value 1 -Type DWord -Force

        $ExeTarget = Join-Path $InstallLocation "NanoForge.exe"
        if (Test-Path $ExeTarget) {
            Set-ItemProperty -Path $RegKeyPath -Name "DisplayIcon" -Value $ExeTarget -Force
        }

        Write-Host "  [+] Registered Windows Add/Remove Programs entry" -ForegroundColor Green
    } catch {
        Write-Warning "Could not register uninstall registry entry: $_"
    }
}

# --- Main Installation Logic ---

if (-not $Silent) {
    Write-Banner
}

Write-Host "[1/5] Target installation directory: $InstallDir" -ForegroundColor Cyan
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$SourceDir = $PSScriptRoot
# If run from bundle, source is current folder. If run from repo root, check bundle/release/dist
if (Test-Path (Join-Path $SourceDir "bundle")) {
    $SourceDir = Join-Path $SourceDir "bundle"
}

Write-Host "[2/5] Copying platform distribution assets from $SourceDir..." -ForegroundColor Cyan

# Copy binaries and scripts
$FilesToCopy = @(
    "NanoForge.exe",
    "NanoForge.bat",
    "nanoforge-launcher.cjs",
    "launcher.cjs",
    "server.mjs",
    "agent-host.mjs",
    "package.json",
    "README.txt",
    "install-nanoforge.ps1",
    "install-nanoforge.bat",
    "uninstall-nanoforge.ps1"
)

foreach ($File in $FilesToCopy) {
    $SrcFile = Join-Path $SourceDir $File
    if (-not (Test-Path $SrcFile)) {
        # Check parent folder or release folder if not directly in source
        $Alternative = Join-Path (Join-Path $PSScriptRoot "..") "scripts\$File"
        if (Test-Path $Alternative) { $SrcFile = $Alternative }
    }
    if (Test-Path $SrcFile) {
        Copy-Item -Path $SrcFile -Destination (Join-Path $InstallDir $File) -Force
    }
}

# Copy dist web UI
$DistSrc = Join-Path $SourceDir "dist"
if (-not (Test-Path $DistSrc)) {
    $DistSrc = Join-Path $PSScriptRoot "dist"
}
if (-not (Test-Path $DistSrc)) {
    $DistSrc = Join-Path (Join-Path $PSScriptRoot "..") "dist"
}

if (Test-Path $DistSrc) {
    $DistDest = Join-Path $InstallDir "dist"
    if (Test-Path $DistDest) { Remove-Item -Path $DistDest -Recurse -Force }
    Copy-Item -Path $DistSrc -Destination $DistDest -Recurse -Force
    Write-Host "  [+] Copied Web UI static files to $DistDest" -ForegroundColor Green
} else {
    Write-Warning "Could not find 'dist' static directory in $SourceDir."
}

# Generate uninstall helper wrapper in install directory
$UninstallBat = Join-Path $InstallDir "uninstall.bat"
$UninstallBatContent = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0uninstall-nanoforge.ps1`" %*"
Set-Content -Path $UninstallBat -Value $UninstallBatContent -Encoding ASCII

Write-Host "[3/5] Setting up shortcuts..." -ForegroundColor Cyan
if (-not $NoShortcuts) {
    $MainTarget = Join-Path $InstallDir "NanoForge.exe"
    if (-not (Test-Path $MainTarget)) {
        $MainTarget = Join-Path $InstallDir "NanoForge.bat"
    }

    # Start Menu
    $StartMenuPrograms = [Environment]::GetFolderPath("Programs")
    $StartMenuNanoForge = Join-Path $StartMenuPrograms "NanoForge"
    if (-not (Test-Path $StartMenuNanoForge)) {
        New-Item -ItemType Directory -Path $StartMenuNanoForge -Force | Out-Null
    }
    Create-Shortcut -ShortcutPath (Join-Path $StartMenuNanoForge "NanoForge.lnk") `
                    -TargetPath $MainTarget `
                    -WorkingDirectory $InstallDir `
                    -Description "NanoForge Autonomous Swarm Platform"

    Create-Shortcut -ShortcutPath (Join-Path $StartMenuNanoForge "Uninstall NanoForge.lnk") `
                    -TargetPath "powershell.exe" `
                    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall-nanoforge.ps1`"" `
                    -WorkingDirectory $InstallDir `
                    -Description "Uninstall NanoForge"

    # Desktop Shortcut
    $DesktopDir = [Environment]::GetFolderPath("Desktop")
    Create-Shortcut -ShortcutPath (Join-Path $DesktopDir "NanoForge.lnk") `
                    -TargetPath $MainTarget `
                    -WorkingDirectory $InstallDir `
                    -Description "NanoForge Autonomous Swarm Platform"
} else {
    Write-Host "  [i] Skipping shortcut creation (-NoShortcuts)." -ForegroundColor Gray
}

Write-Host "[4/5] Configuring environment PATH..." -ForegroundColor Cyan
if (-not $NoPath) {
    Add-ToUserPath -PathToAdd $InstallDir
} else {
    Write-Host "  [i] Skipping PATH modification (-NoPath)." -ForegroundColor Gray
}

Write-Host "[5/5] Registering uninstaller..." -ForegroundColor Cyan
Register-Uninstaller -InstallLocation $InstallDir

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "    NanoForge was installed successfully to:             " -ForegroundColor Green
Write-Host "    $InstallDir" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "To launch NanoForge:" -ForegroundColor Cyan
Write-Host "  - Double-click the NanoForge icon on your Desktop" -ForegroundColor White
Write-Host "  - Or run 'NanoForge' from any PowerShell/Command Prompt" -ForegroundColor White
Write-Host ""
