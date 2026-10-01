# Usar o OficinaOS no telemóvel ou tablet

Guia simples para a equipa — não precisas de perceber de tecnologia.
São 2 minutos e faz-se uma única vez.

## Dentro da loja (Wi-Fi)

Precisas de 3 coisas que quem instalou a app te dá:

1. **Wi-Fi da loja** — o telemóvel tem de estar ligado à mesma rede do
   computador onde a app está instalada (não funciona com dados móveis)
2. **O endereço** — parecido com `http://192.168.1.33:4000`
3. **O teu utilizador e palavra-passe**

Depois:

1. Abre o browser — **Safari** no iPhone, **Chrome** no Android
2. Escreve o endereço na barra de cima e toca para ir
3. Faz login — está pronto a usar

> 💡 O endereço é sempre o mesmo. Guarda nos favoritos ou instala o ícone
> (passo seguinte) e nunca mais precisas de o escrever.

## Instalar o ícone no ecrã (recomendado)

Fica com um ícone próprio e abre em ecrã cheio, como uma app normal.

### iPhone / iPad

1. Abre o endereço no **Safari**
2. Toca no botão **Partilhar** (o quadrado com a seta para cima)
3. Faz scroll e toca em **"Adicionar ao ecrã principal"**
4. Toca em **Adicionar** — aparece o ícone OficinaOS

### Android

1. Abre o endereço no **Chrome**
2. Toca nos **três pontos (⋮)** no canto superior direito
3. Toca em **"Adicionar ao ecrã principal"**
4. Confirma — aparece o ícone

> Se a loja tiver o acesso remoto ligado (secção seguinte), no Android o
> Chrome pode dizer **"Instalar aplicação"** — ainda melhor, instala como
> app verdadeira.

## Fora da loja (em casa, na rua)

Só funciona se a loja tiver o **acesso remoto** ativado — pergunta a quem
instalou a app (o guia está em [remote-access.md](remote-access.md)).

1. Usa o **endereço de internet** que te deram — parecido com
   `https://oficina.nomedaloja.pt` (começa por `https`, não tem números)
2. Login com o **mesmo** utilizador e palavra-passe
3. Podes instalar o ícone no ecrã da mesma maneira

> ⚠️ **Importante:** a app mora no computador da loja. Se esse computador
> estiver desligado, ninguém acede — nem dentro nem fora da loja.

## Algo não funciona?

| O que acontece | O que fazer |
|---|---|
| A página não abre na loja | Confirma que estás na **Wi-Fi da loja** (desliga os dados móveis e tenta outra vez) |
| A página não abre fora da loja | Pergunta se o **computador da loja está ligado** e se o acesso remoto está ativo |
| "Endereço inválido" ou erro de segurança | Estás a usar o endereço errado — dentro da loja é o que tem números (`http://192.168...`), fora é o `https://` com o nome da loja |
| Pediu login outra vez | Normal de vez em quando — entra com o teu utilizador |

---

### Nota para quem instala (opcional, não precisas de ler)

Também existe a possibilidade de gerar um **APK Android nativo** via
Capacitor para distribuir fora da Play Store — detalhes técnicos:
`capacitor.config.ts` + `VITE_API_BASE_URL` apontado ao URL público (túnel)
ou ao IP da LAN. Na maioria dos casos a PWA chega — sobretudo porque em
iOS não há caminho sem App Store, e a experiência via ícone é equivalente.
