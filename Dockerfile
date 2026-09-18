FROM node:20-bookworm-slim

# FFmpeg + fontes usadas no overlay de texto (nome, @, título)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV TMP_DIR=/app/tmp
RUN mkdir -p /app/tmp

EXPOSE 3000

CMD ["node", "server.js"]
