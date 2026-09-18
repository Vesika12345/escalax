# escalaX

Ferramenta de automação de edição em massa de reels/vídeos curtos.

## O que faz
- Upload direto do navegador pro Cloudflare R2 (com barra de progresso real), suporta lote de até 100 vídeos.
- Corta e centraliza automaticamente para o formato 1080x1920 (9:16, formato correto de Reels).
- Inverte o vídeo horizontalmente (opcional).
- Overlay estilo "post": logo + nome + @ (transparente) + título, tudo posicionado sobre o vídeo.
- Marca d'água em massa com um clique (posição e opacidade configuráveis).
- Template exportável/importável em `.json`.
- Exporta um vídeo por vez ou todos de uma vez em `.zip`.

## Deploy no Render
1. Suba todos esses arquivos no repositório do GitHub (mantendo as pastas `src/` e `public/`).
2. No Render: **New > Web Service** > conecta o repositório `escalax`.
3. Runtime: **Docker** (o Render vai detectar o `Dockerfile` automaticamente).
4. Em **Environment**, adiciona as variáveis:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET` = `escalax-videos`
   - `MAX_CONCURRENT_JOBS` = `2` (aumenta depois se o plano aguentar)
5. Deploy. O Render builda a imagem Docker (que já instala FFmpeg) e sobe o serviço.

## Rodar local (opcional, se tiver Node instalado)
```
npm install
cp .env.example .env   # preenche com as chaves do R2
npm start
```
Abre `http://localhost:3000`.

## Por que não deu erro no upload de 100 vídeos
- O vídeo vai DIRETO do navegador pro R2 (URL assinada), sem passar pelo servidor Node — então não trava por causa de payload grande.
- Cada vídeo vira um job separado numa fila (`MAX_CONCURRENT_JOBS` define quantos processam ao mesmo tempo). Se um vídeo falhar, só ele fica com erro — os outros continuam.
- Os arquivos temporários de cada job ficam isolados numa pasta própria e são apagados depois de processar.

## Limitações desta primeira versão (pra evoluir depois)
- A fila de jobs fica em memória: se o servidor reiniciar no meio do processamento, os jobs em andamento se perdem (os vídeos já enviados pro R2 continuam salvos). Dá pra evoluir pra Redis/BullMQ depois se precisar de mais robustez.
- O template de texto usa uma fonte padrão (DejaVu Sans Bold) — dá pra trocar por outra fonte depois.
