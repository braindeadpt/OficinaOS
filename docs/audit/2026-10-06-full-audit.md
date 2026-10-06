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
| App — UI/UX | 1 | 2 | vários | vários | ✅ commit `88dc25e` (+ parcial pendentes) |
| App — i18n | 0 | 13 chaves | 7 pt-BR/drift | ~68 chaves mortas | ✅ commit `87784b5` (mortos ⏳) |
| App — perf/PWA | 0 | 1 | 3 | — | ✅ commit `88dc25e` |
| Cloud | 0 | 3 | — | — | ✅ commit `9ad2de0` |
| Website SEO/a11y | 2 | 1 | — | — | ✅ commit `d7a6db6` |
| Instalação/portable | 0 | 1 | 3 | — | ✅ commit `6901f67` |
| Diag (.NET) | — | — | — | — | ⏳ relatório em curso |

**Totais:** ~1171 testes passam, typecheck e ultracite limpos, 5 commits
(`4b2f0a7`, `88dc25e`, `87784b5`, `6901f67` na app; `9ad2de0` na cloud;
`d7a6db6` no website).

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

**Pendentes conhecidos (⏳):** focus trap no POS, labels em alguns diálogos, `lang` estático no HTML, cleanup de timers de toast, bundle do Material Symbols (~4MB).

---

## 4. App — i18n ✅

- **13 chaves em falta** adicionadas (texto cru visível): `errors.sale_*`, `errors.trade_in_*`, `errors.return_claim_rework_job_required`, `validations.invalid_account/invalid_tax_name/valid_quantity/max_value`, `parts_board.status_OPEN`, `profile_activity_{payment_added,payment_deleted,quote_sent,quote_responded}`, `jobs_history_action_PAYMENT_{ADDED,DELETED}`.
- Hardcodes traduzidos: `Loading...` (ProtectedRoute), toasts do painel AI, erro do markdown renderer.
- pt-PT: "salvas"→"guardadas", "padrão"→"predefinida", "metamodelo"→"modelo Meta", "última peça"→"última reparação"; hint da password do gateway corrigido.
- es/fr: `remarketing_template_hint` estava em inglês.
- **⏳ Pendente:** ~68 chaves mortas em `en.json` (demo strings, `ai_agent_prompt_*` não usados, `profile_activity_*` impossíveis por construção, dias da semana, etc.) — remoção de baixo risco, fazer num commit próprio. `scan-i18n.ts` precisa de alargar cobertura (`i18n.t()`, server/shared, mais prefixos dinâmicos).
- **Nota:** `server/plugins/locale.ts` default `en` enquanto cliente/recibos default `pt` — inconsistente, baixo impacto.

---

## 5. App — Perf/PWA ✅

| Achado | Fix |
|---|---|
| `launchAutoHide: false` sem `@capacitor/splash-screen` instalado — splash eterno se o plugin for adicionado | removido de `capacitor.config.ts` |
| Dashboard subscrevia a store inteira | subscrição por selector |
| WS reconnect fixo 5s forever | backoff exponencial com jitter, reset em sucesso |
| `sw.js` cache `oficinaos-v1` acumulava assets hashed entre deploys | cache versionado + cleanup em activate |
| `.env.example` documentava `capacitor://localhost` mas o Capacitor 8 usa `https://localhost` | corrigido |

**⏳ Pendente:** `androidScheme: "https"` + `allowMixedContent: false` pode bloquear app Android a ligar a backend HTTP na LAN — precisa de decisão de deployment. Lazy-load de locales não-default e da câmara; `better-auth/client` no bundle.

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

**⏳ Pendente:** fallback do instalador quando não consegue build a partir do release zip; tratamento de exit codes do robocopy no updater; discrepâncias menores doc↔realidade no install.

---

## 9. Diag (.NET 8 WPF) — ⏳ em curso

Agente `368bfe59` a auditar: crash handling, privacidade dos logs, integridade de updates, UX dead-ends, integração com a app.

---

## 10. Verificações mecânicas (limpas)

- `scan-i18n` ✓ · `check-primitives` ✓ (dentro do budget) · `tsc` ✓
- TODO/FIXME: só `code-lockout.ts` (Redis multi-instance — aceite single-instance)
- Secrets commitados: nenhum · Migrações Prisma: 67 em dia
- Testes PostgreSQL-dependentes saltam no CI local (`test` user auth — problema de ambiente, não produto)

## Próximos passos sugeridos (por ordem de custo/impacto)

1. Limpar as ~68 chaves mortas de `en.json` + alargar `scan-i18n.ts`
2. Decidir Android `androidScheme` vs HTTP LAN (afeta deployment real)
3. Lazy-load de locales não-default + câmara + `better-auth/client`
4. Focus trap POS + labels de diálogos + `lang` dinâmico + Material Symbols
5. Relatório do agente diag → corrigir achados
6. Installer fallback + robocopy exit codes + docs de instalação
