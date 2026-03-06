FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install
ARG CACHEBUST=1
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
