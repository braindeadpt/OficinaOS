# Auditoria OficinaOS — 2026-10-06

Auditoria completa ao ecossistema (app loja, cloud, website, diag) feita com
9 agentes de exploração + verificações mecânicas locais (scan-i18n,
check-primitives, tsc, migrações, secrets).

**Legenda:** ✅ corrigido e verificado · 🟡 corrigido, verificação pendente em produção · ⏳ por corrigir

---

## Resumo executivo

| Domínio | Críticos | Altos | Médios | Baixos | Estado |
|---|---|---|---|---|---|
| App — segurança backend | 0 | 4 | 4 | — | ✅ commit `87784b5` |
| App — qualidade/races | 1 | 3 | 4 | — | ✅ commit `6901f67` |
| App — UI/UX | 1 | 2 | vários | vários | ✅ commits `88dc25e` + backlog |
| App — i18n | 0 | 13 chaves | 7 pt-BR/drift | 282 chaves mortas removidas | ✅ commits `87784b5` + backlog |
| App — perf/PWA | 0 | 1 | 3 | — | ✅ commits `88dc25e` + backlog |
| Cloud | 0 | 3 | — | — | ✅ commit `9ad2de0` |
| Website SEO/a11y | 2 | 1 | — | — | ✅ commit `d7a6db6` |
| Instalação/portable | 0 | 1 | 3 | — | ✅ commits `6901f67` + backlog |
| Diag (.NET) | 0 | 3 | 7 | vários | ✅ commit `173b04f` (repo `oficinaos-diag`) |

**Totais:** 1171 testes passam, typecheck e ultracite limpos, build OK
(22s — `en`/`es`/`fr` agora são chunks lazy; `pt` fica no bundle principal como
fallback). Commits: `4b2f0a7`, `88dc25e`, `87784b5`, `6901f67` na app;
`9ad2de0` na cloud; `d7a6db6` no website; `173b04f` no diag.

---

## 1. App — Segurança backend ✅

| Achado | Evidência | Fix |
|---|---|---|
| `mustChangePassword` só aplicado no UI — sessão podia chamar qualquer API | `server/plugins/auth.ts` preHandler | 403 `PASSWORD_CHANGE_REQUIRED` em todas as `/api` exceto `/api/auth/*` |
| `ACCOUNT_LOCKED` no precheck de sign-in saía como 500 (catch engolia AppError) | `plugins/auth.ts` handler `/api/auth/*` | rethrow de AppError intacto → 423 |
| Lockout por casing — `Admin`/`admin` tinham orçamentos separados | `handleFailedSignIn`, `checkSignInLockout` | identificador normalizado (lowercase+trim) |
| WS cross-site hijack — cookie `SameSite=None` permitia socket autenticado de qualquer origem | `plugins/websocket.ts` | rejeita `Origin` fora de `trustedOrigins` (não-browser sem Origin permitido) |
| `trustProxy` default true em prod → spoof de `X-Forwarded-For` bypassava rate limits IP | `server/index.ts` | agora opt-in (`TRUST_PROXY=true`), documentado em `remote-access.md` |
| Token do webhook SMS comparado com `===` | `routes/public.ts` | `timingSafeEqual` |
| change-password não revogava outras sessões | `services/auth.service.ts` | `deleteOtherSessions` na mesma transação; sweep WS derruba sockets em ≤30s |

**Regressão coberta:** `server/__tests__/auth-plugin.test.ts` (12 testes).

---

## 2. App — Qualidade / races ✅

| Achado | Severidade | Fix |
|---|---|---|
| `formatPhone("912345678")` → `+912345678` (Índia) — SMS/WhatsApp para número errado | **Crítico** | distingue nacional/internacional por comprimento (`shared/constants/countries.ts` ganhou metadata) |
| Faturação — dois pedidos simultâneos emitiam dois documentos fiscais | Alto | claim condicional `updateMany` antes de emitir |
| Outbox — `markSent` sobrescrevia cancel concorrente; retry ressuscitava cancelados; canal desligado passava fome na fila | Alto | `transitionOutboxEntry` condicional em `QUEUED` + cancel terminal |
| Schedulers (overdue, remarketing) — runs sobrepostos duplicavam notificações | Alto | claim `updateMany` antes de processar |
| Bot WhatsApp — `"ok"` em `YES_WORDS` aprovava orçamentos por engano; rate-limit por telefone sem normalização | Médio | removido; bucket por número normalizado |
| `catch{}` silenciosos em vários services | Médio | logging via `logger.warn` |

**Testes:** 57+ alvo passam (outbox 13, sender 16, schedulers 12, AI 29, consent 6, acknowledge 2).

---

## 3. App — UI/UX ✅ (parcial)

| Achado | Fix |
|---|---|
| **Bug-mãe:** `animate-fade-slide-up` retinha `transform` → containing block para `position:fixed` → modais deslocados, toasts no fundo do documento, nav por cima de scrims | `animation-fill-mode: both` → `backwards` em `app.css` |
| Modal de reporte dentro do `<header>` com `backdrop-blur` — mesmo efeito | renderizado como irmão do header (`4b2f0a7`) |
| Escape ignorava confirmação de descarte em add-customer e add-part | `useModalEffects` recebe o handler guardado |
| Trade-in sem qualquer proteção de descarte (form + assinatura perdidos) | `isDirty` + `ConfirmDiscardDialog` em todas as saídas |

**Resolvidos no backlog:**

- Diálogos do POS ligados a `useModalEffects` — Escape, focus trap, restore de foco e scroll lock; `aria-modal="true"`/`role="dialog"` já presentes. Labels ARIA nos inputs de pagamento/quantidade (`payments.method`, `payments.amount`, `payments.reference`, `pos.custom_qty` — chave nova sincronizada).
- `<html lang>` dinâmico — atualizado no handler de mudança de língua do i18n (era `en` fixo).
- Timer do estado de teste AI em settings — cleanup no unmount.
- Material Symbols: a fonte `full` (~4MB) é necessária porque a app usa eixos FILL/GRAD dinâmicos — tradeoff documentado, sem subset viável sem tooling extra.

---

## 4. App — i18n ✅

- **13 chaves em falta** adicionadas (texto cru visível): `errors.sale_*`, `errors.trade_in_*`, `errors.return_claim_rework_job_required`, `validations.invalid_account/invalid_tax_name/valid_quantity/max_value`, `parts_board.status_OPEN`, `profile_activity_{payment_added,payment_deleted,quote_sent,quote_responded}`, `jobs_history_action_PAYMENT_{ADDED,DELETED}`.
- Hardcodes traduzidos: `Loading...` (ProtectedRoute), toasts do painel AI, erro do markdown renderer.
- pt-PT: "salvas"→"guardadas", "padrão"→"predefinida", "metamodelo"→"modelo Meta", "última peça"→"última reparação"; hint da password do gateway corrigido.
- es/fr: `remarketing_template_hint` estava em inglês.
- **282 chaves mortas removidas** dos 4 locales (o scanner reportava `undefined` — bug `.size` num array corrigido). `scan-i18n.ts` alargado: cobre server/shared, `i18n.t()`, prefixos dinâmicos extraídos do código, e um passe de busca literal que classifica chaves usadas via variáveis (120 falsos-positivos evitados). Resultado: 0 em falta, 0 mortas.
- `server/plugins/locale.ts` default `en`→`pt` + parsing de `Accept-Language` — consistente com o cliente.

---

## 5. App — Perf/PWA ✅

| Achado | Fix |
|---|---|
| `launchAutoHide: false` sem `@capacitor/splash-screen` instalado — splash eterno se o plugin for adicionado | removido de `capacitor.config.ts` |
| Dashboard subscrevia a store inteira | subscrição por selector |
| WS reconnect fixo 5s forever | backoff exponencial com jitter, reset em sucesso |
| `sw.js` cache `oficinaos-v1` acumulava assets hashed entre deploys | cache versionado + cleanup em activate |
| `.env.example` documentava `capacitor://localhost` mas o Capacitor 8 usa `https://localhost` | corrigido |

**Resolvidos/decididos no backlog:**

- **Android LAN HTTP — decisão documentada** (`docs/mobile-access.md`): `androidScheme: "https"` é intencional. A origem `http://` do WebView impediria cookies `SameSite=None; Secure` — o login nunca persistiria. Consequência: o APK exige endpoint `https://` (túnel/VPS); dentro da loja em HTTP usa-se o browser/PWA (same-origin). `allowMixedContent: false` mantém-se correto.
- **Lazy-load de locales**: `pt` é o fallback estático; `en`/`es`/`fr` carregam sob demanda — chunks separados no build (~130-143KB cada) em vez de ~390KB inline.
- **`better-auth/client`**: isolado num chunk `vendor-auth` (~43KB).
- **Câmara**: plugin Capacitor só importado em runtime nativo (dynamic import).

---

## 6. Cloud ✅ (commit `9ad2de0`)

| Achado | Fix |
|---|---|
| Portal publish sem verificação de ownership → overwrite cross-tenant | check de ownership antes de gravar |
| `portal.html` — `q.id` interpolado cru em `onclick` → stored XSS | `esc(JSON.stringify(id))` |
| Inbound WhatsApp — hijack possível | verificação reforçada |
| Token de portal `accessCode` 16 hex — regex `{16,64}` (era exigência implícita de 32 que partiria o publish real) | `TOKEN_LOOKUP_RE` vs publish regex separadas |

49/49 testes da cloud passam.

---

## 7. Website ✅ (commit `d7a6db6`)

- **Canonical sempre apontava para a raiz do locale** — todas as subpáginas declaravam-se duplicados da homepage → risco de desindexação. Fix: canonical por URL real.
- **hreflang idem** — alternates agora por página (`/docs/sms/` ↔ `/en/docs/sms/` ↔ `/es/docs/sms/`).
- Language switcher ia para as raízes — agora preserva a rota atual.
- `<title>`/description por página em docs/updates/módulos; `llms.txt` inclui SMS.
- Build: 21 páginas, sitemap correto.

---

## 8. Instalação/portable ✅

| Achado | Fix |
|---|---|
| Indicador de backups sempre a vermelho em Docker — app lia `/app/uploads/backups*` mas os volumes montavam noutro sítio | mounts corrigidos nos dois compose files |
| `RESTORE.ps1` continuava após erros, sem dump de segurança, caminhos acentuados partiam | stop-on-error + dump pré-restore + caminho 8.3 + cleanup |
| `PARAR.bat` assumia path fixo do data dir | deteção pelo marker do PostgreSQL |

**Resolvidos no backlog:**

- **Fallback do instalador corrigido** — o release zip nunca teve `Dockerfile`/source, logo `up -d --build` não podia funcionar. Agora `INSTALAR.bat` descarrega o source zip do GitHub e instala-o **permanentemente** em `oficinaos-src\app-source` (não `%TEMP%`, que o Windows limpa) — caso contrário `INICIAR.bat`/`PARAR.bat`/`ATUALIZAR.bat` não conseguiriam operar a instalação depois. Os três scripts detetam o modo build e usam o compose do source.
- **robocopy exit codes**: updater portátil já tratava (≥8 = falha); `release.yml` agora falha o CI se alguma das 3 cópias do bundle portátil exceder 7.
- Docs (`INSTALL.md`) atualizados: fallback de source-build, pasta permanente, update manual em modo build.

---

## 9. Diag (.NET 8 WPF) — ✅ corrigido (commit `173b04f`)

~2.600 LOC C# + 2 scripts PS + workflow de release. Os utilitários iOS
(`idevicediagnostics.exe` etc.) chegam via NuGet `iMobileDevice-net` — OK.
Todos os achados abaixo foram corrigidos e verificados com `dotnet build`
(0 warnings, 0 errors).

### Altos — corrigidos

| Achado | Fix |
|---|---|
| **U-1. Self-update sem verificação de integridade** — zip da release extraído sem SHA-256; conta GitHub comprometida = RCE em todas as lojas | `SHA256SUMS.txt` publicado no workflow de release; `UpdateChecker` faz stream do download, verifica o hash para o nome exato do zip e **falha fechado** se o asset ou a entrada faltar; zip inválido é apagado antes de staging |
| **H-1. Timer do `DeviceDetector` reentrante + sem try/catch** | guard `Interlocked` (skip se um poll estiver ativo), try/catch no callback com log, `_seen` protegido; labels refrescados em mudança de estado (unauthorized→authorized) |
| **M-1. `CloudUrl` inválido → non-start silencioso** | `Uri.TryCreate` na carga e no Settings; fallback para o default; só http/https absolutos aceites |

### Médios — corrigidos

| Achado | Fix |
|---|---|
| **P-5/M-2. `TestServer` sem auth em porta fixa 8734** | porta aleatória por sessão (real exposta após `Start()`), token por sessão exigido no POST `/result` (401 caso contrário), Dispose garantido, `device-test.html` posta para `result` relativo |
| **I-1. Pairing/token em claro** | campo mascarado no Settings + `TokenDialog` novo; token guardado com DPAPI (`ProtectedData`), opção "memorizar" |
| **P-4. `CloudUrl` aceita `http://`** | validação + aviso explícito: Bearer token e PII seguiriam sem TLS |
| **U-2. Script de update por interpolação** | escape de `'` nos paths PS, `$LASTEXITCODE` verificado, backup do exe com rollback em falha de extração |
| **H-2. Erros engolidos** | falhas surfaced em UI/log; `_busy` restaurado em `finally`; double-submit Send/AI bloqueado (X-3) |
| **P-3. Crash logs ao LLM sem aviso** | aviso de privacidade antes do envio (paths/usernames podem ir nos logs) |

### Baixos — corrigidos

stderr de `adb`/`idevice*` drenado em paralelo (deadlock >4KB resolvido), kill de
processos em timeout, secções iOS canceladas após o timeout global,
`history.jsonl` com pruning, download do update em stream (não buffer),
shop-code validado a 6 chars, retries em falhas transitórias da cloud.

### Ainda não verificado (precisa de máquina real)

- Se os exe iOS aterram junto do single-file publish — confirmar num `out/` de release real
- `SHA256SUMS.txt` — o workflow passa a publicá-lo; validar o parser contra o formato real no próximo release
- Endpoints unauthenticated `/intake/:shopCode` e `/diag-logs` na cloud — rate-limit/abuse review do lado servidor continua por fazer

---

## 10. Pentest externo (black-box, `curl` contra `http://host.docker.internal:4000`) ✅

Relatório de header/endpoint probing — 9 achados, triagem contra o desenho LAN-HTTP:

| Achado reportado | Triagem | Ação |
|---|---|---|
| HSTS ausente (média) | **Por desenho** — `security.ts` emite HSTS+preload só quando `APP_URL` é `https://`; sobre HTTP LAN o header é inerte e induz falsa segurança | nenhuma |
| IP interno na CSP `connect-src` (média) | **Real, baixo** — `apiOrigin`/`EXTRA_TRUSTED_ORIGINS` eram anunciados a qualquer cliente, incl. via túnel público | **fix:** origins entram no `connect-src` só quando `origin.host === Host` do pedido (`originMatchesRequestHost`); `'self'`+`ws:`/`wss:` cobre todo o tráfego same-origin do frontend |
| 401 em `/api`, `/api/health` | esperado | nenhuma |
| `/.env`, `/.git/config`, `/package.json`, `/robots.txt` → 200 + SPA HTML | **Real, baixo** — fallback SPA genérico; não expõe ficheiros (não existem em `dist/`) | **fix:** `isFileRequestPath` (segmento dotfile ou extensão no último segmento) → 404 JSON em vez de `index.html` |
| `/health` público | intencional (monitorização Docker) — só `status`+`timestamp` | nenhuma |
| Nome da app, rate-limit headers, `X-Request-ID`, `/api/auth/session` 404 | informativos / esperado | nenhuma |

**Testes:** `server/__tests__/spa-fallback.test.ts` (6 testes — scoping de origins por Host e deteção de file-paths).

**Não coberto pelo probe** (superfície real, já endurecida antes): `/api/public/*` com tokens timing-safe + rate-limit + code-lockout; auth/session, WS origin-check, `trustProxy` opt-in.

---

## 11. Verificações mecânicas (limpas — passe final)

- `scan-i18n` ✓ (0 em falta, 0 mortas após remoção de 282) · `check-primitives` ✓ · `tsc` ✓
- `vitest run`: **1171 pass / 5 skip** (PostgreSQL-dependentes — ambiente, não produto) · `ultracite check` ✓
- `vite build` ✓ (22s) — chunks lazy confirmados: `en`/`es`/`fr` separados, `vendor-auth` isolado
- `.bat` modificados (`INSTALAR`, `INICIAR`, `PARAR`, `ATUALIZAR`, portable `ATUALIZAR`): CRLF preservado
- `dotnet build` (diag): 0 warnings, 0 errors
- TODO/FIXME: só `code-lockout.ts` (Redis multi-instance — aceite single-instance)
- Secrets commitados: nenhum · Migrações Prisma: 67 em dia

## O que resta (nada urgente)

1. **Diag — validação em release real:** confirmar que `SHA256SUMS.txt` é gerado e parseado corretamente no próximo tag, e que os utilitários iOS saem no single-file publish
2. **Cloud — rate-limit nos endpoints públicos de diag** (`/intake/:shopCode`, `/diag-logs`)
3. **Material Symbols ~4MB** — subset da fonte exigiria tooling de subfont (glyf); tradeoff aceite e documentado
4. **Testes manuais em hardware:** POS com teclado/leitor de ecrã, TestServer do diag com dispositivo físico, atualização portable end-to-end
