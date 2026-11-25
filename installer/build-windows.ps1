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

# Inno Setup grava os campos de texto de VS_VERSION_INFO em slots fixos do
# SetupLdr.e32 com padding de espacos a direita (ex.: "OficinaOS     ").
# Este helper termina esses campos com NUL in-place (mantendo wLength, offsets
# de recursos e payload intactos) e recalcula o checksum PE, permitindo
# verificacoes exatas (sem Trim) alinhadas com as restricoes da SignPath.
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class PeVersionInfoTrimmer
{
    [DllImport("imagehlp.dll", SetLastError = true)]
    private static extern IntPtr CheckSumMappedFile(
        IntPtr baseAddress, uint fileLength, out uint headerSum, out uint checkSum);

    private static int Align4(int n) { return (n + 3) & ~3; }

    private static string ReadUtf16Z(byte[] buf, int pos, int limit, out int nextPos)
    {
        var sb = new StringBuilder();
        while (pos + 1 < limit)
        {
            char c = (char)BitConverter.ToUInt16(buf, pos);
            pos += 2;
            if (c == '\0') break;
            sb.Append(c);
        }
        nextPos = pos;
        return sb.ToString();
    }

    private static int RvaToOffset(byte[] buf, int secTableOff, int numSections, uint rva)
    {
        for (int i = 0; i < numSections; i++)
        {
            int s = secTableOff + i * 40;
            if (s + 40 > buf.Length) break;
            uint vSize = BitConverter.ToUInt32(buf, s + 8);
            uint vAddr = BitConverter.ToUInt32(buf, s + 12);
            uint rawSize = BitConverter.ToUInt32(buf, s + 16);
            uint rawPtr = BitConverter.ToUInt32(buf, s + 20);
            uint span = Math.Max(vSize, rawSize);
            if (rva >= vAddr && rva < vAddr + span)
                return (int)(rawPtr + (rva - vAddr));
        }
        throw new InvalidOperationException("RVA fora das seccoes PE: 0x" + rva.ToString("X"));
    }

    private static int FindChildDir(byte[] buf, int rsrcBase, int dirOff, uint? targetId, bool expectSubdir)
    {
        if (dirOff < 0 || dirOff + 16 > buf.Length)
            throw new InvalidOperationException("Diretoria de recursos PE fora dos limites.");
        ushort named = BitConverter.ToUInt16(buf, dirOff + 12);
        ushort idCount = BitConverter.ToUInt16(buf, dirOff + 14);
        int entriesOff = dirOff + 16;
        int total = named + idCount;
        for (int i = 0; i < total; i++)
        {
            int e = entriesOff + i * 8;
            if (e + 8 > buf.Length) break;
            uint nameOrId = BitConverter.ToUInt32(buf, e);
            uint dataOff = BitConverter.ToUInt32(buf, e + 4);
            if (targetId.HasValue)
            {
                if ((nameOrId & 0x80000000u) != 0 || nameOrId != targetId.Value) continue;
            }
            bool isSubdir = (dataOff & 0x80000000u) != 0;
            if (isSubdir != expectSubdir) continue;
            return rsrcBase + (int)(dataOff & 0x7FFFFFFFu);
        }
        throw new InvalidOperationException("Recurso RT_VERSION nao encontrado no PE.");
    }

    public static int TrimTrailingSpacesInPlace(string path)
    {
        byte[] buf = File.ReadAllBytes(path);
        if (buf.Length < 64 || buf[0] != 'M' || buf[1] != 'Z')
            throw new InvalidOperationException("Ficheiro nao e um PE valido.");

        int peOff = BitConverter.ToInt32(buf, 0x3C);
        if (peOff < 0 || peOff + 24 > buf.Length ||
            buf[peOff] != 'P' || buf[peOff + 1] != 'E' || buf[peOff + 2] != 0 || buf[peOff + 3] != 0)
            throw new InvalidOperationException("Cabecalho PE invalido.");

        int numSections = BitConverter.ToUInt16(buf, peOff + 6);
        int optSize = BitConverter.ToUInt16(buf, peOff + 20);
        int optOff = peOff + 24;
        if (optOff + optSize > buf.Length || optSize < 120)
            throw new InvalidOperationException("Optional header PE invalido.");

        ushort magic = BitConverter.ToUInt16(buf, optOff);
        int dataDirOff = optOff + (magic == 0x20B ? 112 : 96);
        int secTableOff = optOff + optSize;

        uint rsrcRva = BitConverter.ToUInt32(buf, dataDirOff + 2 * 8);
        if (rsrcRva == 0)
            throw new InvalidOperationException("PE sem seccao de recursos.");

        int rsrcBase = RvaToOffset(buf, secTableOff, numSections, rsrcRva);
        int typeDir = FindChildDir(buf, rsrcBase, rsrcBase, 16u, true);
        int nameDir = FindChildDir(buf, rsrcBase, typeDir, null, true);
        int dataEntry = FindChildDir(buf, rsrcBase, nameDir, null, false);
        if (dataEntry < 0 || dataEntry + 8 > buf.Length)
            throw new InvalidOperationException("Entrada de dados RT_VERSION fora dos limites.");

        uint verRva = BitConverter.ToUInt32(buf, dataEntry);
        int verLen = (int)BitConverter.ToUInt32(buf, dataEntry + 4);
        int verOff = RvaToOffset(buf, secTableOff, numSections, verRva);
        int verEnd = verOff + verLen;
        if (verOff < 0 || verLen < 6 || verEnd > buf.Length)
            throw new InvalidOperationException("Bloco RT_VERSION fora dos limites.");

        int rootLen = BitConverter.ToUInt16(buf, verOff);
        int fixedLen = BitConverter.ToUInt16(buf, verOff + 2);
        int afterKey;
        string rootKey = ReadUtf16Z(buf, verOff + 6, verEnd, out afterKey);
        if (rootKey != "VS_VERSION_INFO")
            throw new InvalidOperationException("Bloco raiz inesperado: " + rootKey);

        int childPos = verOff + Align4(afterKey - verOff) + Align4(fixedLen);
        int rootEnd = Math.Min(verEnd, verOff + rootLen);
        int trimmedFields = 0;

        while (childPos + 6 <= rootEnd)
        {
            int blkLen = BitConverter.ToUInt16(buf, childPos);
            if (blkLen < 6) break;
            int blkEnd = Math.Min(rootEnd, childPos + blkLen);
            int keyEnd;
            string blkKey = ReadUtf16Z(buf, childPos + 6, blkEnd, out keyEnd);

            if (blkKey == "StringFileInfo")
            {
                int tblPos = verOff + Align4(keyEnd - verOff);
                while (tblPos + 6 <= blkEnd)
                {
                    int tblLen = BitConverter.ToUInt16(buf, tblPos);
                    if (tblLen < 6) break;
                    int tblEnd = Math.Min(blkEnd, tblPos + tblLen);
                    int tblKeyEnd;
                    ReadUtf16Z(buf, tblPos + 6, tblEnd, out tblKeyEnd);

                    int strPos = verOff + Align4(tblKeyEnd - verOff);
                    while (strPos + 6 <= tblEnd)
                    {
                        int strLen = BitConverter.ToUInt16(buf, strPos);
                        ushort valChars = BitConverter.ToUInt16(buf, strPos + 2);
                        ushort valType = BitConverter.ToUInt16(buf, strPos + 4);
                        if (strLen < 6) break;
                        int strEnd = Math.Min(tblEnd, strPos + strLen);
                        int sKeyEnd;
                        ReadUtf16Z(buf, strPos + 6, strEnd, out sKeyEnd);

                        if (valType == 1 && valChars > 0)
                        {
                            int valOff = verOff + Align4(sKeyEnd - verOff);
                            int maxChars = Math.Min((int)valChars, Math.Max(0, (strEnd - valOff) / 2));
                            int curLen = 0;
                            while (curLen < maxChars && BitConverter.ToUInt16(buf, valOff + curLen * 2) != 0)
                                curLen++;

                            int newLen = curLen;
                            while (newLen > 0 && BitConverter.ToUInt16(buf, valOff + (newLen - 1) * 2) == 0x0020)
                                newLen--;

                            if (newLen < curLen)
                            {
                                for (int c = newLen; c < maxChars; c++)
                                {
                                    buf[valOff + c * 2] = 0;
                                    buf[valOff + c * 2 + 1] = 0;
                                }
                                ushort updatedChars = (ushort)(newLen + 1);
                                buf[strPos + 2] = (byte)(updatedChars & 0xFF);
                                buf[strPos + 3] = (byte)((updatedChars >> 8) & 0xFF);
                                trimmedFields++;
                            }
                        }
                        int nextStrPos = verOff + Align4(strEnd - verOff);
                        if (nextStrPos <= strPos) break;
                        strPos = nextStrPos;
                    }
                    int nextTblPos = verOff + Align4(tblEnd - verOff);
                    if (nextTblPos <= tblPos) break;
                    tblPos = nextTblPos;
                }
            }
            int nextChildPos = verOff + Align4(blkEnd - verOff);
            if (nextChildPos <= childPos) break;
            childPos = nextChildPos;
        }

        if (trimmedFields > 0)
        {
            GCHandle handle = GCHandle.Alloc(buf, GCHandleType.Pinned);
            try
            {
                uint headerSum, checkSum;
                IntPtr res = CheckSumMappedFile(handle.AddrOfPinnedObject(), (uint)buf.Length, out headerSum, out checkSum);
                if (res == IntPtr.Zero)
                    throw new InvalidOperationException("CheckSumMappedFile falhou.");
                byte[] csBytes = BitConverter.GetBytes(checkSum);
                Buffer.BlockCopy(csBytes, 0, buf, optOff + 64, 4);
            }
            finally
            {
                handle.Free();
            }
            File.WriteAllBytes(path, buf);
        }

        return trimmedFields;
    }

    public static void AssertChecksumValid(string path)
    {
        byte[] buf = File.ReadAllBytes(path);
        GCHandle handle = GCHandle.Alloc(buf, GCHandleType.Pinned);
        try
        {
            uint headerSum, checkSum;
            IntPtr res = CheckSumMappedFile(handle.AddrOfPinnedObject(), (uint)buf.Length, out headerSum, out checkSum);
            if (res == IntPtr.Zero)
                throw new InvalidOperationException("CheckSumMappedFile falhou.");
            if (headerSum != checkSum)
                throw new InvalidOperationException(string.Format("Checksum PE invalido em {0}: header=0x{1:X} calculado=0x{2:X}", path, headerSum, checkSum));
        }
        finally
        {
            handle.Free();
        }
    }
}
"@

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

$setupExe = (Resolve-Path "dist\OficinaOS-Setup.exe").Path
$sizeBefore = (Get-Item $setupExe).Length
$trimmed = [PeVersionInfoTrimmer]::TrimTrailingSpacesInPlace($setupExe)
$sizeAfter = (Get-Item $setupExe).Length
if ($sizeAfter -ne $sizeBefore) {
    throw "TrimTrailingSpacesInPlace alterou o tamanho de ${setupExe}: $sizeBefore -> $sizeAfter"
}
if ($trimmed -gt 0) {
    [PeVersionInfoTrimmer]::AssertChecksumValid($setupExe)
}
Write-Host "${setupExe}: $trimmed campo(s) VS_VERSION_INFO normalizado(s) in-place; checksum PE valido."

foreach ($exe in @((Resolve-Path $trayOut).Path, $setupExe)) {
    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    $fileNum = "$($vi.FileMajorPart).$($vi.FileMinorPart).$($vi.FileBuildPart).$($vi.FilePrivatePart)"
    $prodNum = "$($vi.ProductMajorPart).$($vi.ProductMinorPart).$($vi.ProductBuildPart).$($vi.ProductPrivatePart)"
    Write-Host "${exe}: ProductName='$($vi.ProductName)' ProductVersion='$($vi.ProductVersion)' FileVersion='$($vi.FileVersion)' CompanyName='$($vi.CompanyName)' numeric=$fileNum/$prodNum"
    if ($vi.ProductName -cne "OficinaOS") { throw "${exe}: ProductName='$($vi.ProductName)' (esperado exatamente 'OficinaOS')" }
    if ($vi.CompanyName -cne "OficinaOS") { throw "${exe}: CompanyName='$($vi.CompanyName)' (esperado exatamente 'OficinaOS')" }
    if ($vi.ProductVersion -cne $v) { throw "${exe}: ProductVersion='$($vi.ProductVersion)' (esperado exatamente '$v')" }
    if ($vi.FileVersion -cne $numVer) { throw "${exe}: FileVersion='$($vi.FileVersion)' (esperado exatamente '$numVer')" }
    if ($fileNum -ne $numVer) { throw "${exe}: numeric FileVersion='$fileNum' (esperado '$numVer')" }
    if ($prodNum -ne $numVer) { throw "${exe}: numeric ProductVersion='$prodNum' (esperado '$numVer')" }
}
