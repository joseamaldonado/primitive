# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY web/frontend/package*.json ./
RUN npm ci
COPY web/frontend/ .
RUN npm run build

# Build backend
FROM golang:1.25-alpine AS backend-builder
WORKDIR /app
# Copy only the backend code
COPY web/backend/go.mod web/backend/go.sum ./
RUN go mod download
COPY web/backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Final stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/

# Copy the backend binary
COPY --from=backend-builder /app/main .

# Copy the frontend build
COPY --from=frontend-builder /app/frontend/dist ./static

EXPOSE 8081
CMD ["./main"]