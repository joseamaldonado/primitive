import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import './index.css'

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

type AppState = 'initial' | 'processing' | 'completed'

function App() {
  const [appState, setAppState] = useState<AppState>('initial')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  // Parameters
  const [shapeCount, setShapeCount] = useState(100)
  const [shapeMode, setShapeMode] = useState(1) // Triangles
  const [alpha, setAlpha] = useState(128)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processImage = async () => {
    if (!selectedFile) return

    setAppState('processing')
    setError(null)

    try {
      // Create form data with file and parameters
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('count', shapeCount.toString())
      formData.append('mode', shapeMode.toString())
      formData.append('alpha', alpha.toString())

      // Send request and get processed image directly
      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      // Get the image blob and create URL for display
      const imageBlob = await response.blob()
      const imageUrl = URL.createObjectURL(imageBlob)
      
      setResultImageUrl(imageUrl)
      setAppState('completed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed')
      setAppState('initial')
    }
  }

  const handleFileSelect = (file: File) => {
    setSelectedFile(file)
    setResultImageUrl(null)
    setError(null)
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleUploadAreaClick = () => {
    if (appState === 'processing') return
    fileInputRef.current?.click()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (appState === 'processing') return
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

    if (appState === 'processing') return

    const files = Array.from(e.dataTransfer.files)
    const imageFile = files.find(file => file.type.startsWith('image/'))
    
    if (imageFile) {
      handleFileSelect(imageFile)
    }
  }

  const handleDownload = () => {
    if (!resultImageUrl) return

    // Create download link
    const link = document.createElement('a')
    link.href = resultImageUrl
    link.download = `primitive-${Date.now()}.jpg`
    
    // Trigger download
    document.body.appendChild(link)
    link.click()
    
    // Cleanup
    document.body.removeChild(link)
  }

  const handleReset = () => {
    setAppState('initial')
    setSelectedFile(null)
    setResultImageUrl(null)
    setError(null)
    if (resultImageUrl) {
      URL.revokeObjectURL(resultImageUrl)
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

        {/* Processing State: Show loading */}
        {appState === 'processing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {selectedFile && (
              <img 
                src={URL.createObjectURL(selectedFile)} 
                alt="Processing..."
                className="max-w-[90vw] max-h-[calc(100vh-180px)] shadow-2xl opacity-50 transition-opacity duration-300"
              />
            )}
            <div className="mt-5 space-y-2">
              <div className="w-[300px] h-1 bg-border overflow-hidden">
                <div className="h-full bg-white animate-pulse" />
              </div>
              <div className="text-sm text-muted-foreground">
                Processing your image with {shapeCount} {SHAPE_MODES.find(m => m.value === shapeMode)?.label.toLowerCase()}...
              </div>
            </div>
          </div>
        )}

        {/* Completed State: Show result */}
        {appState === 'completed' && resultImageUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <img 
              src={resultImageUrl}
              alt="Final result"
              className="max-w-[90vw] max-h-[calc(100vh-180px)] shadow-2xl transition-opacity duration-300"
            />
            <div className="mt-3 text-sm text-muted-foreground">
              Complete! Created with {shapeCount} {SHAPE_MODES.find(m => m.value === shapeMode)?.label.toLowerCase()}
            </div>
          </div>
        )}

        {/* File Selected State: Show original image */}
        {selectedFile && appState === 'initial' && (
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

      {/* Desktop Bottom Sidebar */}
      <div className="hidden md:block h-40 bg-card border-t border-border p-6">
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
                  min={50}
                  max={300}
                  step={5}
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
            <div className="flex-shrink-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">
                Actions
              </div>
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={handleUploadAreaClick}
                  disabled={appState === 'processing'}
                  size="sm"
                >
                  Upload
                </Button>
                <Button 
                  onClick={processImage}
                  disabled={appState === 'processing' || !selectedFile}
                  size="sm"
                >
                  {appState === 'processing' ? 'Processing...' : appState === 'completed' ? 'Process Again' : 'Process Image'}
                </Button>
                {appState === 'completed' && resultImageUrl && (
                  <Button
                    onClick={handleDownload}
                    variant="default"
                    size="sm"
                  >
                    Download
                  </Button>
                )}
                {appState === 'completed' && (
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    size="sm"
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-destructive text-destructive-foreground p-3 text-sm mt-4 max-w-6xl mx-auto">
              {error}
            </div>
          )}

        </div>

      {/* Mobile Bottom Menu */}
      <div className="md:hidden relative">
        {/* Mobile Menu Button */}
        <div className="h-16 bg-card border-t border-border flex items-center justify-center">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground"
          >
            <span>Settings</span>
            <div className={`transition-transform duration-200 ${isMobileMenuOpen ? 'rotate-180' : ''}`}>
              ▲
            </div>
          </button>
        </div>

        {/* Mobile Overlay Menu */}
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            
            {/* Menu Panel */}
            <div className="absolute bottom-16 left-0 right-0 bg-card border-t border-border shadow-lg z-50 max-h-[calc(100vh-16rem)] overflow-y-auto">
              <div className="p-4 space-y-6">
                
                {/* Shape Count */}
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">
                    Shape Count
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[shapeCount]}
                      onValueChange={(value) => setShapeCount(value[0])}
                      min={50}
                      max={300}
                      step={5}
                      disabled={appState === 'processing'}
                      className="flex-1"
                    />
                    <div className="min-w-[40px] text-right text-sm font-medium">
                      {shapeCount}
                    </div>
                  </div>
                </div>

                {/* Shape Type */}
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">
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
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">
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

                {/* Actions */}
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">
                    Actions
                  </div>
                  <div className="flex flex-col gap-3">
                    <Button 
                      variant="outline" 
                      onClick={handleUploadAreaClick}
                      disabled={appState === 'processing'}
                      size="sm"
                      className="w-full"
                    >
                      Upload
                    </Button>
                    <Button 
                      onClick={processImage}
                      disabled={appState === 'processing' || !selectedFile}
                      size="sm"
                      className="w-full"
                    >
                      {appState === 'processing' ? 'Processing...' : appState === 'completed' ? 'Process Again' : 'Process Image'}
                    </Button>
                    {appState === 'completed' && resultImageUrl && (
                      <Button
                        onClick={handleDownload}
                        variant="default"
                        size="sm"
                        className="w-full"
                      >
                        Download
                      </Button>
                    )}
                    {appState === 'completed' && (
                      <Button
                        onClick={handleReset}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </div>

                {/* Mobile Error Display */}
                {error && (
                  <div className="bg-destructive text-destructive-foreground p-3 text-sm">
                    {error}
                  </div>
                )}

              </div>
            </div>
          </>
        )}
      </div>

    </div>
  )
}

export default App