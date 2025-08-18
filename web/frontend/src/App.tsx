import { useState, useRef, useEffect } from 'react'



interface ProgressUpdate {
  jobId: string
  progress: number
  total: number
  score: number
  completed: boolean
  error?: string
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

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
          setProcessing(false)
          if (!update.error) {
            setResultUrl(`http://localhost:8081/api/download/${update.jobId}`)
          } else {
            setError(update.error)
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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setResultUrl(null)
      setError(null)
      setProgress(null)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setUploading(true)
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
    } finally {
      setUploading(false)
    }
  }

  const startProcessing = async (jobId: string) => {
    setProcessing(true)
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
      setProcessing(false)
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Primitive Pictures Web</h1>
      <p>Upload an image and convert it to geometric primitives</p>

      {/* File Upload */}
      <div style={{ marginBottom: '20px' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || processing}
        >
          {selectedFile ? selectedFile.name : 'Select Image'}
        </button>
      </div>

      {/* Parameters */}
      {selectedFile && (
        <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px' }}>
          <h3>Parameters</h3>
          
          <div style={{ marginBottom: '10px' }}>
            <label>Shape Count: {shapeCount}</label>
            <input
              type="range"
              min="10"
              max="200"
              value={shapeCount}
              onChange={(e) => setShapeCount(Number(e.target.value))}
              disabled={processing}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Shape Type: </label>
            <select
              value={shapeMode}
              onChange={(e) => setShapeMode(Number(e.target.value))}
              disabled={processing}
            >
              {SHAPE_MODES.map(mode => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Alpha: {alpha}</label>
            <input
              type="range"
              min="32"
              max="255"
              value={alpha}
              onChange={(e) => setAlpha(Number(e.target.value))}
              disabled={processing}
              style={{ width: '100%' }}
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || processing || !selectedFile}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: processing ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              cursor: processing ? 'not-allowed' : 'pointer'
            }}
          >
            {uploading ? 'Uploading...' : processing ? 'Processing...' : 'Process Image'}
          </button>
        </div>
      )}

      {/* Original Image Preview */}
      {selectedFile && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Original Image</h3>
          <img 
            src={URL.createObjectURL(selectedFile)} 
            alt="Original"
            style={{ maxWidth: '400px', height: 'auto' }}
          />
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Progress</h3>
          <div style={{ width: '100%', backgroundColor: '#f0f0f0', height: '20px' }}>
            <div 
              style={{ 
                width: `${(progress.progress / progress.total) * 100}%`,
                backgroundColor: '#007bff',
                height: '100%',
                transition: 'width 0.3s'
              }}
            />
          </div>
          <p>
            {progress.progress} / {progress.total} shapes 
            {progress.score && ` | Score: ${progress.score.toFixed(6)}`}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '10px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Result */}
      {resultUrl && (
        <div>
          <h3>Result</h3>
          <img 
            src={resultUrl} 
            alt="Processed"
            style={{ maxWidth: '400px', height: 'auto' }}
          />
          <br />
          <a 
            href={resultUrl} 
            download
            style={{ 
              display: 'inline-block',
              marginTop: '10px',
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              textDecoration: 'none'
            }}
          >
            Download Result
          </a>
        </div>
      )}
    </div>
  )
}

export default App