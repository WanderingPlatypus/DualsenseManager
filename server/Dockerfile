FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
ENV PORT=8080 HTTPS_PORT=8443 DATA_DIR=/data
VOLUME /data
EXPOSE 8080 8443
CMD ["node", "--no-warnings", "server/server.js"]
