import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import './index.css'

interface ProgressUpdate {
  jobId: string
  progress: number
  total: number
  score: number
  completed: boolean
  error?: string
  imageData?: string // Base64 encoded JPEG
}

const SHAPE_MODES = [
  { value: 0, label: 'Combo' },
  { value: 1, label: 'Triangles' },
  { value: 2, label: 'Rectangles' },
  { value: 3, label: 'Ellipses' },
  { value: 4, label: 'Circles' },
  { value: 5, label: 'Rotated Rectangles' },
  { value: 6, label: 'Beziers' },
  { value: 7, label: 'Rotated Ellipses' },
  { value: 8, label: 'Polygons' }
]

type AppState = 'initial' | 'uploaded' | 'processing' | 'completed'

function App() {
  const [appState, setAppState] = useState<AppState>('initial')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  
  // Parameters
  const [shapeCount, setShapeCount] = useState(50)
  const [shapeMode, setShapeMode] = useState(1) // Triangles
  const [alpha, setAlpha] = useState(128)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const connectWebSocket = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:8081/ws')
      
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)
      
      ws.onopen = () => {
        clearTimeout(timeout)
        resolve(ws)
      }
      
      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket connection failed'))
      }
      
      ws.onmessage = (event) => {
        const update: ProgressUpdate = JSON.parse(event.data)
        setProgress(update)
        
        if (update.completed) {
          if (!update.error) {
            setResultUrl(`http://localhost:8081/api/download/${update.jobId}`)
            setAppState('completed')
          } else {
            setError(update.error)
            setAppState('uploaded')
          }
        }
      }
      
      ws.onclose = () => {
        // Connection closed - will reconnect when needed
      }
    })
  }

  useEffect(() => {
    // Initialize WebSocket connection on component mount
    connectWebSocket().then(ws => {
      wsRef.current = ws
    }).catch(() => {
      // Initial connection failed - will retry when processing starts
    })

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const handleFileSelect = (file: File) => {
    setSelectedFile(file)
    setAppState('uploaded')
    setResultUrl(null)
    setError(null)
    setProgress(null)
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleUploadAreaClick = () => {
    fileInputRef.current?.click()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const imageFile = files.find(file => file.type.startsWith('image/'))
    
    if (imageFile) {
      handleFileSelect(imageFile)
    }
  }

  const handleUploadDifferent = () => {
    setAppState('initial')
    setSelectedFile(null)
    setResultUrl(null)
    setError(null)
    setProgress(null)
  }

  const handleProcess = async () => {
    if (!selectedFile) return

    setAppState('processing')
    setError(null)

    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const response = await fetch('http://localhost:8081/api/upload', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) throw new Error('Upload failed')
      
      const data = await response.json()
      await startProcessing(data.jobId)
    } catch (err) {
      setError('Upload failed: ' + (err as Error).message)
      setAppState('uploaded')
    }
  }

  const startProcessing = async (jobId: string) => {
    setProgress(null)
    setResultUrl(null)

    try {
      // Ensure WebSocket is connected before processing
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        wsRef.current = await connectWebSocket()
      }

      const request = {
        jobId,
        count: shapeCount,
        mode: shapeMode,
        alpha
      }

      const response = await fetch('http://localhost:8081/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      })

      if (!response.ok) throw new Error('Processing failed')
    } catch (err) {
      setError('Failed to start processing: ' + (err as Error).message)
      setAppState('uploaded')
    }
  }

  const handleDownload = async () => {
    if (!resultUrl) return

    try {
      const response = await fetch(resultUrl)
      const blob = await response.blob()
      
      // Create download link
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `primitive-${Date.now()}.jpg`
      
      // Trigger download
      document.body.appendChild(link)
      link.click()
      
      // Cleanup
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('Download failed: ' + (err as Error).message)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Main Content Area */}
      <div 
        className="flex-1 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        
        {/* Initial State: Click anywhere to upload */}
        {appState === 'initial' && (
          <div 
            className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-all duration-200 ${
              isDragOver 
                ? 'bg-primary/10 border-2 border-dashed border-primary' 
                : 'hover:bg-white/[0.02]'
            }`}
            onClick={handleUploadAreaClick}
          >
            <div className="text-center">
              <div className="text-lg text-muted-foreground select-none">
                {isDragOver ? 'Drop your image here' : 'Click anywhere or drag & drop an image'}
              </div>
              {!isDragOver && (
                <div className="text-sm text-muted-foreground/70 mt-2 select-none">
                  Supports PNG, JPG, GIF, and other image formats
                </div>
              )}
            </div>
          </div>
        )}

        {/* Processing/Completed State: Show progress image */}
        {(appState === 'processing' || appState === 'completed') && progress && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {progress.imageData && (
              <img 
                src={`data:image/jpeg;base64,${progress.imageData}`}
                alt={appState === 'completed' ? 'Final result' : 'Processing'}
                className="max-w-[90vw] max-h-[calc(100vh-180px)] shadow-2xl transition-opacity duration-300"
              />
            )}
            <div className="mt-5 w-[300px] h-1 bg-border overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-300"
                style={{ width: `${(progress.progress / progress.total) * 100}%` }}
              />
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              {appState === 'completed' ? 'Complete!' : `${progress.progress} / ${progress.total} shapes • Score: ${progress.score?.toFixed(6)}`}
            </div>
          </div>
        )}

        {/* Uploaded State: Show original image */}
        {appState === 'uploaded' && selectedFile && (
          <div className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${
            isDragOver ? 'bg-primary/10 border-2 border-dashed border-primary' : ''
          }`}>
            {isDragOver ? (
              <div className="text-lg text-muted-foreground select-none">
                Drop to replace image
              </div>
            ) : (
              <img 
                src={URL.createObjectURL(selectedFile)} 
                alt="Original"
                className="max-w-[90vw] max-h-[calc(100vh-180px)] shadow-2xl"
              />
            )}
          </div>
        )}

      </div>

      {/* Bottom Sidebar - Always visible when file is selected */}
      {selectedFile && (
        <div className="h-40 bg-card border-t border-border p-6">
          <div className="flex items-center gap-8 h-full max-w-6xl mx-auto">
            
            {/* Shape Count */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">
                Shape Count
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  value={[shapeCount]}
                  onValueChange={(value) => setShapeCount(value[0])}
                  min={10}
                  max={200}
                  step={1}
                  disabled={appState === 'processing'}
                  className="flex-1"
                />
                <div className="min-w-[40px] text-right text-sm font-medium">
                  {shapeCount}
                </div>
              </div>
            </div>

            {/* Shape Type */}
            <div className="w-48">
              <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">
                Shape Type
              </div>
              <Select 
                value={shapeMode.toString()} 
                onValueChange={(value) => setShapeMode(Number(value))}
                disabled={appState === 'processing'}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHAPE_MODES.map(mode => (
                    <SelectItem key={mode.value} value={mode.value.toString()}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Alpha */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">
                Alpha
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  value={[alpha]}
                  onValueChange={(value) => setAlpha(value[0])}
                  min={32}
                  max={255}
                  step={1}
                  disabled={appState === 'processing'}
                  className="flex-1"
                />
                <div className="min-w-[40px] text-right text-sm font-medium">
                  {alpha}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={handleUploadDifferent}
                size="sm"
              >
                Upload Different
              </Button>
              <Button 
                onClick={handleProcess}
                disabled={appState === 'processing' || !selectedFile}
                size="sm"
              >
                {appState === 'processing' ? 'Processing...' : appState === 'completed' ? 'Process Again' : 'Process Image'}
              </Button>
              {appState === 'completed' && resultUrl && (
                <Button
                  onClick={handleDownload}
                  variant="default"
                  size="sm"
                >
                  Download
                </Button>
              )}
            </div>

          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-destructive text-destructive-foreground p-3 text-sm mt-4 max-w-6xl mx-auto">
              {error}
            </div>
          )}

        </div>
      )}
    </div>
  )
}

export default App