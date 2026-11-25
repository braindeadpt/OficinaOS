param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$SourceDir = "stage"
)

$ErrorActionPreference = "Stop"

$v = $Version.TrimStart("v")
$numVer = if ($v -match "^(\d+\.\d+\.\d+)") { "$($Matches[1]).0" } else { "0.0.0.0" }
$stagePath = Join-Path "installer" $SourceDir
$trayOut = Join-Path $stagePath "tools\OficinaOSTray.exe"
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$verFile = Join-Path $tempRoot "OficinaOSTrayVersion.cs"

try {
    @"
using System.Reflection;
[assembly: AssemblyVersion("$numVer")]
[assembly: AssemblyFileVersion("$numVer")]
[assembly: AssemblyInformationalVersion("$v")]
"@ | Set-Content -Encoding utf8 $verFile

    $csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    & $csc /target:winexe /nologo `
        /win32icon:"installer\OficinaOS.ico" `
        /out:$trayOut `
        /r:System.Windows.Forms.dll /r:System.Drawing.dll `
        installer\tray\OficinaOSTray.cs $verFile
    if ($LASTEXITCODE -ne 0) { throw "csc falhou: $LASTEXITCODE" }
} finally {
    Remove-Item $verFile -Force -ErrorAction SilentlyContinue
}

& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" `
    "/DMyAppVersion=$v" "/DMyAppNumericVersion=$numVer" "/DSourceDir=$SourceDir" `
    /Q installer\oficinaos.iss
if ($LASTEXITCODE -ne 0) { throw "ISCC falhou: $LASTEXITCODE" }

foreach ($exe in @($trayOut, "dist\OficinaOS-Setup.exe")) {
    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo((Resolve-Path $exe))
    $prodName = ("$($vi.ProductName)").Trim()
    $prodVer = ("$($vi.ProductVersion)").Trim()
    $fileVer = ("$($vi.FileVersion)").Trim()
    $fileNum = "$($vi.FileMajorPart).$($vi.FileMinorPart).$($vi.FileBuildPart).$($vi.FilePrivatePart)"
    $prodNum = "$($vi.ProductMajorPart).$($vi.ProductMinorPart).$($vi.ProductBuildPart).$($vi.ProductPrivatePart)"
    Write-Host "${exe}: ProductName='$prodName' ProductVersion='$prodVer' FileVersion='$fileVer' numeric=$fileNum/$prodNum"
    if ($prodName -ne "OficinaOS") { throw "${exe}: ProductName='$prodName' (esperado 'OficinaOS')" }
    if ($prodVer -ne $v) { throw "${exe}: ProductVersion='$prodVer' (esperado '$v')" }
    if ($fileVer -ne $numVer) { throw "${exe}: FileVersion='$fileVer' (esperado '$numVer')" }
    if ($fileNum -ne $numVer) { throw "${exe}: numeric FileVersion='$fileNum' (esperado '$numVer')" }
    if ($prodNum -ne $numVer) { throw "${exe}: numeric ProductVersion='$prodNum' (esperado '$numVer')" }
}
