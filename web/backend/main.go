package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	
	"github.com/fogleman/primitive/primitive"
	"github.com/nfnt/resize"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for now
	},
}

type ProcessRequest struct {
	Count int `json:"count"`
	Mode  int `json:"mode"`
	Alpha int `json:"alpha"`
}

type ProcessResponse struct {
	JobID        string `json:"jobId"`
	InitialImage string `json:"initialImage"` // Base64 encoded initial background
}

type ProgressUpdate struct {
	JobID     string  `json:"jobId"`
	Progress  int     `json:"progress"`
	Total     int     `json:"total"`
	Score     float64 `json:"score"`
	Completed bool    `json:"completed"`
	Error     string  `json:"error,omitempty"`
	ImageData string  `json:"imageData,omitempty"` // Base64 encoded JPEG
}

var jobs = make(map[string]*Job)

type Job struct {
	ID         string
	Status     string
	Progress   int
	Total      int
	Score      float64
	Error      string
	ResultData []byte
	InputData  []byte
}

func generateInitialImage(inputData []byte) (string, error) {
	// Load input image from memory
	reader := bytes.NewReader(inputData)
	input, _, err := image.Decode(reader)
	if err != nil {
		return "", err
	}

	// Resize input
	input = resize.Thumbnail(256, 256, input, resize.Bilinear)

	// Setup background color
	bg := primitive.MakeColor(primitive.AverageImageColor(input))

	// Create model with just the background
	model := primitive.NewModel(input, bg, 512, 1)

	// Encode background to JPEG
	var buf bytes.Buffer
	opts := &jpeg.Options{Quality: 70}
	err = jpeg.Encode(&buf, model.Context.Image(), opts)
	if err != nil {
		return "", err
	}

	// Return base64 encoded image
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func main() {
	r := gin.Default()

	// CORS middleware
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

	// Serve static files from frontend dist
	r.Static("/assets", "../frontend/dist/assets")
	r.StaticFile("/", "../frontend/dist/index.html")

	// API routes
	api := r.Group("/api")
	{
		api.POST("/upload", handleUpload)
		api.POST("/process", handleProcess)
		api.GET("/status/:jobId", handleStatus)
		api.GET("/download/:jobId", handleDownload)
	}

	// WebSocket for progress updates
	r.GET("/ws", handleWebSocket)

	log.Println("Server starting on :8081")
	r.Run(":8081")
}

func handleUpload(c *gin.Context) {
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	// Read file into memory
	fileData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to read file"})
		return
	}

	// Generate job ID and store file data
	jobID := fmt.Sprintf("job_%d", time.Now().Unix())
	job := &Job{
		ID:        jobID,
		Status:    "uploaded",
		InputData: fileData,
	}
	jobs[jobID] = job

	c.JSON(200, gin.H{"jobId": jobID})
}

func handleProcess(c *gin.Context) {
	var req struct {
		JobID string `json:"jobId"`
		Count int    `json:"count"`
		Mode  int    `json:"mode"`
		Alpha int    `json:"alpha"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}

	// Get existing job with uploaded data
	job, exists := jobs[req.JobID]
	if !exists {
		c.JSON(404, gin.H{"error": "Job not found"})
		return
	}

	// Generate initial background image before starting processing
	initialImageData, err := generateInitialImage(job.InputData)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to generate initial image"})
		return
	}

	// Update job for processing
	job.Status = "processing"
	job.Total = req.Count

	// Start processing in goroutine
	go processImage(req.JobID, req.Count, req.Mode, req.Alpha)

	c.JSON(200, ProcessResponse{
		JobID:        req.JobID,
		InitialImage: initialImageData,
	})
}

func handleStatus(c *gin.Context) {
	jobID := c.Param("jobId")
	job, exists := jobs[jobID]
	if !exists {
		c.JSON(404, gin.H{"error": "Job not found"})
		return
	}

	c.JSON(200, gin.H{
		"status":    job.Status,
		"progress":  job.Progress,
		"total":     job.Total,
		"score":     job.Score,
		"error":     job.Error,
		"completed": job.Status == "completed",
	})
}

func handleDownload(c *gin.Context) {
	jobID := c.Param("jobId")
	job, exists := jobs[jobID]
	if !exists {
		c.JSON(404, gin.H{"error": "Job not found"})
		return
	}

	if job.Status != "completed" {
		c.JSON(400, gin.H{"error": "Job not completed"})
		return
	}

	if len(job.ResultData) == 0 {
		c.JSON(400, gin.H{"error": "No result data available"})
		return
	}

	// Serve JPEG image from memory
	c.Data(200, "image/jpeg", job.ResultData)
}

var wsClients = make(map[*websocket.Conn]bool)

func handleWebSocket(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

	wsClients[conn] = true
	defer delete(wsClients, conn)

	// Keep connection alive
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func broadcastProgress(update ProgressUpdate) {
	for conn := range wsClients {
		err := conn.WriteJSON(update)
		if err != nil {
			conn.Close()
			delete(wsClients, conn)
		}
	}
}

func processImage(jobID string, count, mode, alpha int) {
	job := jobs[jobID]
	
	defer func() {
		if r := recover(); r != nil {
			job.Status = "error"
			job.Error = fmt.Sprintf("Processing failed: %v", r)
			broadcastProgress(ProgressUpdate{
				JobID:     jobID,
				Completed: true,
				Error:     job.Error,
			})
		}
	}()

	// Load input image from memory
	reader := bytes.NewReader(job.InputData)
	input, _, err := image.Decode(reader)
	if err != nil {
		job.Status = "error"
		job.Error = "Failed to load image"
		return
	}

	// Resize input
	input = resize.Thumbnail(256, 256, input, resize.Bilinear)

	// Setup background color
	bg := primitive.MakeColor(primitive.AverageImageColor(input))

	// Create model
	model := primitive.NewModel(input, bg, 512, 1)
	job.Score = model.Score

	// Process shapes
	for i := 0; i < count; i++ {
		// Add shape
		model.Step(primitive.ShapeType(mode), alpha, 0)
		
		// Update progress
		job.Progress = i + 1
		job.Score = model.Score
		
		// Broadcast progress every 5 shapes (or last shape) with current image
		if (i+1)%5 == 0 || i+1 == count {
			// Encode current state to JPEG for progress update
			var buf bytes.Buffer
			opts := &jpeg.Options{
				Quality: 70, // Lower quality for faster encoding and smaller size
			}
			err := jpeg.Encode(&buf, model.Context.Image(), opts)
			var imageData string
			if err == nil {
				imageData = base64.StdEncoding.EncodeToString(buf.Bytes())
			}
			
			broadcastProgress(ProgressUpdate{
				JobID:     jobID,
				Progress:  i + 1,
				Total:     count,
				Score:     model.Score,
				ImageData: imageData,
			})
		}
		
	}

	// Encode result to memory as JPEG (much faster than PNG)
	var buf bytes.Buffer
	opts := &jpeg.Options{
		Quality: 90, // High quality but fast encoding
	}
	err = jpeg.Encode(&buf, model.Context.Image(), opts)
	if err != nil {
		job.Status = "error"
		job.Error = "Failed to encode result"
		return
	}

	job.ResultData = buf.Bytes()
	job.Status = "completed"
	
	// Include final image data in completion message for smooth transition
	finalImageData := base64.StdEncoding.EncodeToString(buf.Bytes())
	broadcastProgress(ProgressUpdate{
		JobID:     jobID,
		Progress:  count,
		Total:     count,
		Score:     job.Score,
		ImageData: finalImageData,
		Completed: true,
	})
}
