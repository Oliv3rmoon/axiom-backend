FROM node:20-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY server.js .
COPY brain.js .
COPY .env* ./
EXPOSE 3000
CMD ["node", "server.js"]
