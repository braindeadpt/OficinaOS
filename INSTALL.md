# Instalar o OficinaOS — passo a passo

Guia para Windows. Demora ~10 minutos na primeira vez.

## Requisitos

| Requisito | Detalhe |
|---|---|
| **PC** | Windows 10/11 **64-bit** — o PC que fica ligado na loja |
| **RAM** | 4 GB livres (o Docker usa ~1.5 GB) |
| **Disco** | ~5 GB livres (Docker + app + base de dados) |
| **Permissões** | Administrador, só durante a instalação do Docker |
| **Internet** | Só na **primeira instalação** — depois funciona offline na rede local |
| **Docker** | Instalado automaticamente pelo `INSTALAR.bat` — não precisas de saber o que é |
| **Outros dispositivos** | **Nada** — só um browser |

## Cenários de uso

| Cenário | Como funciona |
|---|---|
| **1. Um só PC** (o mais simples) | Instalas no PC do balcão e usas `http://localhost:4000` nesse mesmo PC |
| **2. PC-servidor + vários dispositivos** | O mesmo PC corre a app; tablets, telemóveis e outros PCs abrem `http://<IP>:4000` no browser — sem instalar nada. ⚠️ A app só funciona enquanto esse PC estiver ligado |
| **3. Máquina dedicada** | Um mini-PC ou NAS com Docker sempre ligado corre a app; todos acedem por browser. Ideal para não depender do PC do balcão |
| **4. Acesso pela internet** | Exige domínio + HTTPS (reverse proxy tipo Caddy) e cuidados extra de segurança/RGPD. **Não recomendado** para começar — os cenários 1–3 chegam para uso em loja |

## 1. Descarregar

1. Vai a **github.com/braindeadpt/OficinaOS**
2. Botão verde **Code** → **Download ZIP**
3. Extrai o ZIP para uma pasta, ex.: `C:\OficinaOS`

## 2. Instalar

1. Dentro da pasta, **duplo clique em `INSTALAR.bat`**
2. Se o Windows Defender SmartScreen avisar: **Mais informações → Executar mesmo assim**
3. O instalador faz tudo sozinho:
   - Instala o **Docker Desktop** se não existir (gratuito, oficial)
   - Gera as passwords e segredos automaticamente
   - **Descarrega a imagem pronta do GitHub** (segundos) — se falhar, constrói localmente (~5 min)
4. No fim, o browser abre automaticamente em `http://localhost:4000`

> **Se o Windows pedir para reiniciar** durante a instalação do Docker (é normal), reinicia o PC e volta a correr `INSTALAR.bat`.

## 3. Primeiro login

- **Utilizador:** `admin`
- **Palavra-passe:** `braindead`

No primeiro acesso a app **obriga a definir um novo nome de utilizador e uma nova palavra-passe** — escolhe os teus e guarda-os. Depois disso, `admin`/`braindead` deixa de funcionar.

## 4. Uso diário

| Ficheiro | Para quê |
|---|---|
| `INICIAR.bat` | Ligar o OficinaOS (duplo clique — abre o browser) |
| `PARAR.bat` | Desligar (os dados ficam guardados) |

**Outros dispositivos da loja** (tablet, telemóvel do técnico, outro PC): abrir `http://<IP-do-PC>:4000` — o endereço exato está no `PRIMEIRO-LOGIN.txt`. Não precisam de instalar nada.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| O firewall do Windows pergunta se permite o acesso | Escolher **Permitir** (rede privada) |
| Página em branco no browser | `Ctrl+F5`; se persistir, confirmar que usaste `http://` e não `https://` |
| "Invalid username or password" | O login é por **username** (`admin`), não email |
| O PC mudou de IP e os outros dispositivos deixaram de ligar | Apagar o ficheiro `.env`, correr `INSTALAR.bat` outra vez (gera config nova; os dados mantêm-se) |
| Desinstalar por completo | `docker compose down -v` na pasta + apagar a pasta (⚠️ apaga a base de dados) |

## Atualizar para uma versão nova

```bat
:: com imagem pré-construída (recomendado):
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d

:: ou, se instalaste a partir do código-fonte:
git pull
docker compose up -d --build
```
