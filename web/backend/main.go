package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
	Filename string `json:"filename"`
	Count    int    `json:"count"`
	Mode     int    `json:"mode"`
	Alpha    int    `json:"alpha"`
}

type ProcessResponse struct {
	JobID string `json:"jobId"`
}

type ProgressUpdate struct {
	JobID     string  `json:"jobId"`
	Progress  int     `json:"progress"`
	Total     int     `json:"total"`
	Score     float64 `json:"score"`
	Completed bool    `json:"completed"`
	Error     string  `json:"error,omitempty"`
}

var jobs = make(map[string]*Job)

type Job struct {
	ID       string
	Status   string
	Progress int
	Total    int
	Score    float64
	Error    string
	Result   string
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

	// Create uploads directory
	os.MkdirAll("uploads", 0755)
	os.MkdirAll("results", 0755)

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
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	// Generate unique filename
	filename := fmt.Sprintf("%d_%s", time.Now().Unix(), header.Filename)
	filepath := filepath.Join("uploads", filename)

	// Save file
	out, err := os.Create(filepath)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to save file"})
		return
	}
	defer out.Close()

	_, err = io.Copy(out, file)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to save file"})
		return
	}

	c.JSON(200, gin.H{"filename": filename})
}

func handleProcess(c *gin.Context) {
	var req ProcessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}

	// Generate job ID
	jobID := fmt.Sprintf("job_%d", time.Now().Unix())
	
	// Create job
	job := &Job{
		ID:     jobID,
		Status: "processing",
		Total:  req.Count,
	}
	jobs[jobID] = job

	// Start processing in goroutine
	go processImage(jobID, req)

	c.JSON(200, ProcessResponse{JobID: jobID})
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

	c.File(job.Result)
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

func processImage(jobID string, req ProcessRequest) {
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

	// Load input image
	inputPath := filepath.Join("uploads", req.Filename)
	input, err := primitive.LoadImage(inputPath)
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

	// Output path
	outputPath := filepath.Join("results", fmt.Sprintf("%s.png", jobID))
	job.Result = outputPath

	// Process shapes
	for i := 0; i < req.Count; i++ {
		// Add shape
		model.Step(primitive.ShapeType(req.Mode), req.Alpha, 0)
		
		// Update progress
		job.Progress = i + 1
		job.Score = model.Score
		
		// Broadcast progress
		broadcastProgress(ProgressUpdate{
			JobID:    jobID,
			Progress: i + 1,
			Total:    req.Count,
			Score:    model.Score,
		})

		// Save intermediate result every 10 shapes
		if (i+1)%10 == 0 || i == req.Count-1 {
			primitive.SavePNG(outputPath, model.Context.Image())
		}
	}

	// Final save
	err = primitive.SavePNG(outputPath, model.Context.Image())
	if err != nil {
		job.Status = "error"
		job.Error = "Failed to save result"
		return
	}

	job.Status = "completed"
	broadcastProgress(ProgressUpdate{
		JobID:     jobID,
		Progress:  req.Count,
		Total:     req.Count,
		Score:     job.Score,
		Completed: true,
	})
}
