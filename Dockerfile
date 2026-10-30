FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV DATA_DIR=/app/data PORT=3000
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "start"]
