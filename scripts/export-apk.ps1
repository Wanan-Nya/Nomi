param(
  [string]$OutputDir = "apk"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot "android"
$artifactDir = Join-Path $projectRoot $OutputDir
$localProperties = Join-Path $androidRoot "local.properties"
$defaultSdkRoot = "D:\\Android_studio"
$gradleUserHome = Join-Path $projectRoot ".gradle-home"
$tempDir = Join-Path $projectRoot ".tmp"
$transformsDir = Join-Path $gradleUserHome "caches\\8.14.3\\transforms"

New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
New-Item -ItemType Directory -Force -Path $gradleUserHome | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
if (Test-Path $transformsDir) {
  try {
    Remove-Item -LiteralPath $transformsDir -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Host "Skipping stale Gradle transform cleanup: $($_.Exception.Message)"
  }
}

if (-not $env:ANDROID_HOME -and (Test-Path $defaultSdkRoot)) {
  $env:ANDROID_HOME = $defaultSdkRoot
}

if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}

if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
  throw "Android SDK not found. Set ANDROID_HOME/ANDROID_SDK_ROOT or install the SDK to D:\Android_studio."
}

$env:GRADLE_USER_HOME = $gradleUserHome
$env:TEMP = $tempDir
$env:TMP = $tempDir

$gradlew = Join-Path $androidRoot "gradlew.bat"
if (-not (Test-Path $gradlew)) {
  throw "Gradle wrapper not found at $gradlew."
}

$sdkDirLine = "sdk.dir=$($env:ANDROID_HOME -replace '\\','/')"
$sdkDirLine = $sdkDirLine -replace '^sdk\.dir=([A-Za-z]):/+', 'sdk.dir=$1:/'
Set-Content -LiteralPath $localProperties -Value $sdkDirLine -Encoding ASCII

$releaseDir = Join-Path $androidRoot "app\\build\\outputs\\apk\\release"

Push-Location $androidRoot
try {
  Write-Host "Using Android SDK: $($env:ANDROID_HOME)"
  Write-Host "Building release APK from $androidRoot ..."
  & $gradlew "assembleRelease" "--stacktrace" "--no-daemon"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $apk = Get-ChildItem -Path $releaseDir -Filter *.apk -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($apk) {
    $targetName = "nomi-mobile-0.3.4-release.apk"
    $targetPath = Join-Path $artifactDir $targetName
    Copy-Item -LiteralPath $apk.FullName -Destination $targetPath -Force
    Write-Host "APK ready: $targetPath"
  } else {
    throw "Build finished, but no APK was found in $releaseDir."
  }
}
finally {
  Pop-Location
}
