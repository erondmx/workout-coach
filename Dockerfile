FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
# Volumes nomeados podem existir com dono root: ajusta a permissão e roda o app sem privilégios.
CMD ["sh", "-c", "chown -R node:node /data && exec su-exec node node server.js"]
