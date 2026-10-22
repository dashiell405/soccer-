# Works on Fly.io, Railway, Koyeb, Google Cloud Run, or any Docker host.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
