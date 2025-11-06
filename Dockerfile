FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY index.js ./

# Expose port
EXPOSE 3000

# Run the application
CMD ["npm", "start"]
