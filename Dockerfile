FROM node:20-slim

WORKDIR /app

# Install openssl (some dependencies might need it)
RUN apt-get update -y && apt-get install -y openssl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Create data directory for persistent volume
RUN mkdir -p /app/data

# Build the project (TypeScript to JavaScript)
RUN npm run build

# Default environment variables (can be overridden in Railway)
ENV DB_PATH=/app/data/db.json

# Command to start the bot
CMD ["npm", "run", "start"]
