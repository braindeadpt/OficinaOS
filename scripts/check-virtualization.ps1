# check-virtualization.ps1 — deteta se o PC consegue correr Docker Desktop/WSL2.
# Locale-independent: le flags CIM directamente.
# Exit codes: 0 = virtualizacao OK | 1 = suportada mas desativada na BIOS | 2 = CPU sem suporte
$ErrorActionPreference = "SilentlyContinue"

$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor

# Um hypervisor ja a correr (Hyper-V/WSL2 ativo) = Docker funciona,
# mesmo que o firmware flag venha escondido do OS.
if ($cs.HypervisorPresent) { exit 0 }

# Flags do CPU: VirtualizationFirmwareEnabled = ligado na BIOS;
# VMMonitorModeExtensions = o CPU suporta virtualizacao de todo.
if ($cpu.VMMonitorModeExtensions) {
    if ($cpu.VirtualizationFirmwareEnabled) { exit 0 }
    exit 1
}
exit 2
