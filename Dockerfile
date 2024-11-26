FROM node:20.18-alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm globally
RUN npm install -g pnpm

# Install dependencies including dev dependencies
RUN pnpm install --production

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]