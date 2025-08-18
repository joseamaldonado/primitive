# Primitive Web Interface

A modern web interface for [Michael Fogleman's Primitive](https://github.com/fogleman/primitive) - reproducing images with geometric primitives.

## Features

- **Drag & drop** image upload
- **Real-time progress** with live preview
- **Shape controls**: count (50-300), type, transparency
- **Multiple formats**: triangles, rectangles, ellipses, circles, and more
- **Instant download** of results

## Stack

- **Frontend**: React + TypeScript + Vite + Shadcn + Tailwind CSS
- **Backend**: Go + Gin + WebSockets
- **Algorithm**: Original Primitive library

## Usage

1. **Backend**: `cd backend && go run main.go`
2. **Frontend**: `cd frontend && npm run dev`  
3. Open `http://localhost:5173`

## Inspiration

Built on the work of [Michael Fogleman's Primitive](https://github.com/fogleman/primitive).
