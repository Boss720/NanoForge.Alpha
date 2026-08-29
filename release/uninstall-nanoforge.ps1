<#
.SYNOPSIS
    NanoForge Clean Uninstaller
.DESCRIPTION
    Stops running NanoForge processes, removes Desktop and Start Menu shortcuts,
    cleans the installation folder from %LOCALAPPDATA%\NanoForge, cleans PATH,
    and unregisters Windows Add/Remove Programs entry.
.PARAMETER InstallDir
    Installation directory to clean. Default: %LOCALAPPDATA%\NanoForge
.PARAMETER Silent
    Run uninstallation without interactive prompts.
.PARAMETER Force
    Force kill processes without confirmation.
#>
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\NanoForge",
    [switch]$Silent,
    [switch]$Force
)

$ErrorActionPreference = "Continue"

function Write-Banner {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Magenta
    Write-Host "            NanoForge - Clean Uninstaller                 " -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Magenta
    Write-Host ""
}

function Remove-FromUserPath {
    param([string]$PathToRemove)

    try {
        $CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($CurrentPath) {
            $PathEntries = $CurrentPath -split ";"
            $FilteredEntries = $PathEntries | Where-Object { $_ -ne $PathToRemove -and $_ -ne "" }
            $NewPath = $FilteredEntries -join ";"
            [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
            Write-Host "  [+] Removed from User PATH: $PathToRemove" -ForegroundColor Green
        }
    } catch {
        Write-Warning "Could not update User PATH: $_"
    }
}

function Unregister-Uninstaller {
    $RegKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NanoForge"
    try {
        if (Test-Path $RegKeyPath) {
            Remove-Item -Path $RegKeyPath -Recurse -Force | Out-Null
            Write-Host "  [+] Removed Windows Add/Remove Programs entry" -ForegroundColor Green
        }
    } catch {
        Write-Warning "Could not remove registry key: $_"
    }
}

if (-not $Silent) {
    Write-Banner
    if (-not $Force) {
        $Confirmation = Read-Host "Are you sure you want to completely remove NanoForge from '$InstallDir'? (Y/N)"
        if ($Confirmation -ne "Y" -and $Confirmation -ne "y") {
            Write-Host "Uninstallation cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
}

Write-Host "[1/5] Terminating running NanoForge instances..." -ForegroundColor Cyan
try {
    Get-Process -Name "NanoForge" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch { /* ignore */ }

Write-Host "[2/5] Removing Desktop and Start Menu shortcuts..." -ForegroundColor Cyan
$DesktopDir = [Environment]::GetFolderPath("Desktop")
$DesktopShortcut = Join-Path $DesktopDir "NanoForge.lnk"
if (Test-Path $DesktopShortcut) {
    Remove-Item -Path $DesktopShortcut -Force -ErrorAction SilentlyContinue
    Write-Host "  [+] Removed Desktop shortcut" -ForegroundColor Green
}

$StartMenuPrograms = [Environment]::GetFolderPath("Programs")
$StartMenuNanoForge = Join-Path $StartMenuPrograms "NanoForge"
if (Test-Path $StartMenuNanoForge) {
    Remove-Item -Path $StartMenuNanoForge -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [+] Removed Start Menu shortcuts directory" -ForegroundColor Green
}

Write-Host "[3/5] Cleaning user PATH environment variable..." -ForegroundColor Cyan
Remove-FromUserPath -PathToRemove $InstallDir

Write-Host "[4/5] Unregistering from Windows..." -ForegroundColor Cyan
Unregister-Uninstaller

Write-Host "[5/5] Removing installation files from $InstallDir..." -ForegroundColor Cyan
if (Test-Path $InstallDir) {
    try {
        # Note: If uninstall is executed directly from inside $InstallDir,
        # self-deletion might require a scheduled background task or cleanup.
        $CurrentScript = $PSCommandPath
        $IsRunningFromInstallDir = $CurrentScript -and $CurrentScript.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)

        if ($IsRunningFromInstallDir) {
            # Delete everything in install dir except the current running script, then schedule directory removal
            Get-ChildItem -Path $InstallDir -Exclude (Split-Path $CurrentScript -Leaf) | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`"" -WindowStyle Hidden
        } else {
            Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Host "  [+] Removed installation directory" -ForegroundColor Green
    } catch {
        Write-Warning "Could not delete all files in $InstallDir`: $_"
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   NanoForge has been uninstalled from your system.       " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
