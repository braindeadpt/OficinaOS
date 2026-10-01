# OficinaOS em telemóveis e tablets

A app é totalmente responsiva e funciona em qualquer dispositivo com browser —
sem instalar nada. Há três formas de usar no móvel, por ordem de simplicidade:

| Forma | Esforço | Experiência |
|---|---|---|
| **Browser na rede da loja** | zero | abre num separador |
| **Ícone no ecrã principal (PWA)** | 10 segundos | app em ecrã cheio, ícone próprio |
| **APK Android** | build único | app instalada, câmara nativa |

## 1. Browser na rede da loja

Com o telemóvel/tablet ligado à Wi-Fi da loja, abre o mesmo endereço do PC:

```
http://192.168.1.33:4000        # o IP que está em APP_URL
```

Funciona em Chrome, Safari, Edge — em Android, iPhone, iPad e tablets Windows.

## 2. Ícone no ecrã principal (PWA)

O OficinaOS é uma PWA — podes "instalá-lo" para ficar com ícone próprio e abrir
em ecrã cheio, sem barra do browser.

### iPhone / iPad (Safari)

1. Abre o endereço da app no **Safari**
2. Toca em **Partilhar** (o quadrado com a seta)
3. **"Adicionar ao ecrã principal"** → Adicionar
4. Fica um ícone OficinaOS que abre em modo app (ecrã cheio)

Funciona na rede da loja em HTTP — não precisa de HTTPS para o ícone.

### Android (Chrome)

- **Na loja (HTTP):** menu ⋮ → "Adicionar ao ecrã principal" → fica um atalho
  que abre no browser.
- **Com acesso remoto HTTPS** ([tunnel](remote-access.md)): o Chrome oferece
  "Instalar aplicação" — instala como app real, com ícone adaptativo.

## 3. App Android nativa (opcional)

O projeto inclui configuração Capacitor (`appId: com.oficinaos.app`, plugins de
Câmara para fotos nas fichas e SplashScreen). Para gerar o APK sem Play Store:

```bash
# no repo, numa máquina com Android Studio
bun install
VITE_API_BASE_URL=https://oficina.minhaloja.pt bun run build   # ou o IP da LAN
bunx cap sync android
bunx cap open android   # → Build → Build APK → distribui o .apk
```

Notas:

- O `VITE_API_BASE_URL` fica gravado no APK — usa o URL do túnel se quiseres
  que a app funcione dentro e fora da loja
- Atualizações são manuais (distribuir novo `.apk`) — sem loja não há auto-update
- Para iOS não há caminho sem App Store/conta de developer — usa a opção PWA

## O servidor continua a ser o PC da loja

Os telemóveis são clientes — a base de dados e a app correm sempre no PC onde
instalaste. Se o PC desligar, os dispositivos perdem a ligação até ele voltar
(os dados ficam seguros nos volumes Docker).
