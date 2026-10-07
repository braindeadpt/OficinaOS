; oficinaos.iss — instalador Windows do OficinaOS (Inno Setup 6)
;
; Em CI: iscc /DMyAppVersion=<tag> /DSourceDir=<stage> installer/oficinaos.iss
; O stage tem de conter: app\ bun\ pgsql\ tools\ (setup-service.ps1, backup.ps1,
; OficinaOS.exe=WinSW, OficinaOS.xml, OficinaOSTray.exe) e OficinaOS.ico.

#define MyAppName "OficinaOS"
#ifndef MyAppVersion
  #define MyAppVersion "dev"
#endif
#ifndef SourceDir
  #define SourceDir "stage"
#endif

[Setup]
AppId={{7E4A2F1B-9C3D-4E5F-A6B7-8D9E0F1A2B3C}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=OficinaOS
AppPublisherURL=https://oficinaos.app
AppSupportURL=https://oficinaos.app/docs/
DefaultDirName={autopf}\OficinaOS
DefaultGroupName={#MyAppName}
OutputDir=..\dist
; Nome estável (sem versão) para o deep-link releases/latest/download/OficinaOS-Setup.exe
OutputBaseFilename=OficinaOS-Setup
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=OficinaOS.ico
UninstallDisplayIcon={app}\OficinaOS.ico
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\Portuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion
Source: "{#SourceDir}\bun\*"; DestDir: "{app}\bun"; Flags: recursesubdirs ignoreversion
Source: "{#SourceDir}\pgsql\*"; DestDir: "{app}\pgsql"; Flags: recursesubdirs ignoreversion
Source: "{#SourceDir}\tools\*"; DestDir: "{app}\tools"; Flags: recursesubdirs ignoreversion
Source: "OficinaOS.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Abrir OficinaOS"; Filename: "http://oficinaos.local:4000"; IconFilename: "{app}\OficinaOS.ico"
Name: "{group}\Desinstalar OficinaOS"; Filename: "{uninstallexe}"; IconFilename: "{app}\OficinaOS.ico"

[Registry]
; icone na bandeja arranca com cada sessao — gere o servico sem consola
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\Run"; \
  ValueName: "OficinaOSTray"; ValueType: string; \
  ValueData: """{app}\tools\OficinaOSTray.exe"""; Flags: uninsdeletevalue

[Run]
Filename: "http://localhost:4000"; Description: "Abrir o OficinaOS"; \
  Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\setup-service.ps1"" -Uninstall"; \
  Flags: waituntilterminated runhidden; RunOnceId: "RemoveServices"

[UninstallDelete]
; ficheiros criados em runtime (.env, logs, app.prev de updates) ficam fora do
; manifesto do instalador — sem isto sobrava lixo em Program Files\OficinaOS
Type: filesandordirs; Name: "{app}"

[Code]
var
  PostInstallFailed: Boolean;

// Setup correu até ao fim mas a configuracao pos-install falhou — o chamador
// (ATUALIZAR.bat / deploy silencioso) tem de distinguir "ficheiros copiados,
// servico falhou" de sucesso real.
function GetCustomSetupExitCode: Integer;
begin
  if PostInstallFailed then
    Result := 1
  else
    Result := 0;
end;

// Antes de copiar ficheiros num upgrade: parar os serviços para libertar locks.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\tools\setup-service.ps1')) then
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\tools\setup-service.ps1') + '" -Stop',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Com o tray aberto, a copia por cima falhava com exit 5 (ficheiro em uso).
  Exec('taskkill.exe', '/F /IM OficinaOSTray.exe',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Pós-instalação: corre setup-service.ps1 com exit code visível — se falhar,
// o utilizador fica a saber onde está o log em vez de falhar calado.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    WizardForm.StatusLabel.Caption :=
      'A configurar a base de dados e os serviços (pode demorar alguns minutos)...';
    WizardForm.StatusLabel.Update;
    if not Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\tools\setup-service.ps1') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then begin
      PostInstallFailed := True;
      // SuppressibleMsgBox respeita /SUPPRESSMSGBOXES — com MsgBox a instalacao
      // silenciosa ficava pendurada à espera de um clique que nunca vinha.
      SuppressibleMsgBox(
        'A configuração do OficinaOS não terminou corretamente.' + #13#10 +
        'Registo: ' + ExpandConstant('{commonappdata}') +
        '\OficinaOS\logs\setup.log' + #13#10 +
        'Volte a correr o instalador ou contacte o suporte.',
        mbError, MB_OK, IDOK);
    end;
  end;
end;

// No fim do desinstalar: perguntar se apaga também os dados da loja.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then begin
    DataDir := ExpandConstant('{commonappdata}\OficinaOS');
    if DirExists(DataDir) then begin
      // Silencioso: SuppressibleMsgBox devolve IDNO — dados da loja ficam.
      if SuppressibleMsgBox(
        'Desinstalar concluído.' + #13#10 + #13#10 +
        'Apagar também TODOS os dados da loja em ' + DataDir +
        ' (base de dados, backups, uploads)?' + #13#10 +
        'Esta ação não pode ser anulada.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
