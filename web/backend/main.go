package main

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"os"
	"runtime"
	"strconv"

	"github.com/gin-gonic/gin"
	
	"github.com/fogleman/primitive/primitive"
	"github.com/nfnt/resize"
)

type ProcessRequest struct {
	Count int `json:"count"`
	Mode  int `json:"mode"`
	Alpha int `json:"alpha"`
}

func processImageSync(inputData []byte, count, mode, alpha int) ([]byte, error) {
	// Load input image from memory
	reader := bytes.NewReader(inputData)
	input, _, err := image.Decode(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to decode image: %v", err)
	}

	// Resize input for faster processing
	input = resize.Thumbnail(256, 256, input, resize.Bilinear)

	// Setup background color
	bg := primitive.MakeColor(primitive.AverageImageColor(input))

	// Create model with all CPU cores for maximum speed
	workers := runtime.NumCPU()
	model := primitive.NewModel(input, bg, 1024, workers) // Higher resolution output

	// Process shapes as fast as possible
	for i := 0; i < count; i++ {
		model.Step(primitive.ShapeType(mode), alpha, 0)
	}

	// Encode result to high-quality JPEG
	var buf bytes.Buffer
	opts := &jpeg.Options{Quality: 95}
	err = jpeg.Encode(&buf, model.Context.Image(), opts)
	if err != nil {
		return nil, fmt.Errorf("failed to encode result: %v", err)
	}

	return buf.Bytes(), nil
}

func main() {
	// Set Gin mode for production
	if os.Getenv("RAILWAY_ENVIRONMENT") != "" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()

	// CORS middleware for development
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		
		c.Next()
	})

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Serve static files from frontend build
	r.Static("/assets", "./static/assets")
	r.StaticFile("/", "./static/index.html")
	r.Static("/static", "./static")

	// Single API endpoint - upload and process in one shot
	r.POST("/api/process", handleProcessImage)

	// Get port from environment or default to 8081
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}

func handleProcessImage(c *gin.Context) {
	log.Printf("Received process request from %s", c.ClientIP())
	
	// Parse multipart form
	err := c.Request.ParseMultipartForm(32 << 20) // 32MB max
	if err != nil {
		log.Printf("Failed to parse multipart form: %v", err)
		c.JSON(400, gin.H{"error": "Failed to parse form"})
		return
	}

	// Get file
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		log.Printf("Failed to get file from form: %v", err)
		c.JSON(400, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()
	
	log.Printf("Received file: %s (%d bytes)", header.Filename, header.Size)

	// Read file into memory
	fileData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to read file"})
		return
	}

	// Parse parameters from form data
	req := ProcessRequest{
		Count: 100, // default
		Mode:  1,   // triangles default
		Alpha: 128, // default
	}

	if countStr := c.PostForm("count"); countStr != "" {
		if count, err := strconv.Atoi(countStr); err == nil {
			req.Count = count
		}
	}
	if modeStr := c.PostForm("mode"); modeStr != "" {
		if mode, err := strconv.Atoi(modeStr); err == nil {
			req.Mode = mode
		}
	}
	if alphaStr := c.PostForm("alpha"); alphaStr != "" {
		if alpha, err := strconv.Atoi(alphaStr); err == nil {
			req.Alpha = alpha
		}
	}

	log.Printf("Processing image: count=%d, mode=%d, alpha=%d", req.Count, req.Mode, req.Alpha)

	// Process image synchronously - no jobs, no WebSockets, just pure speed
	resultData, err := processImageSync(fileData, req.Count, req.Mode, req.Alpha)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	log.Printf("Processing complete, returning image (%d bytes)", len(resultData))

	// Return the processed image directly
	c.Data(200, "image/jpeg", resultData)
}
