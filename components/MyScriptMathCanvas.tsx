import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    iink?: {
      Editor: {
        load: (element: HTMLElement, editorType: string, options?: unknown) => Promise<any>
      }
    }
  }
}

type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error'

const SCRIPT_ID = 'myscript-iink-ts-loader'
const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/iink-ts@3.0.2/dist/iink.min.js'

let scriptPromise: Promise<void> | null = null

function loadIinkRuntime(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MyScript iink runtime can only load in a browser context.'))
  }

  if (window.iink) {
    return Promise.resolve()
  }

  if (scriptPromise) {
    return scriptPromise
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null

    const handleLoad = () => {
      console.log('MyScript iink script loaded successfully')
      resolve()
    }

    const handleError = () => {
      console.error('Failed to load MyScript iink script')
      reject(new Error('Failed to load the MyScript iink runtime.'))
    }

    if (existing) {
      console.log('MyScript script already exists in DOM')
      if (existing.getAttribute('data-loaded') === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', handleLoad, { once: true })
      existing.addEventListener('error', handleError, { once: true })
      return
    }

    console.log('Creating new MyScript script element')
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.addEventListener(
      'load',
      () => {
        console.log('MyScript script load event fired')
        script.setAttribute('data-loaded', 'true')
        resolve()
      },
      { once: true }
    )
    script.addEventListener('error', handleError, { once: true })
    document.head.appendChild(script)
  })
    .catch(err => {
      scriptPromise = null
      throw err
    })
    .then(() => {
      scriptPromise = null
    })

  return scriptPromise ?? Promise.resolve()
}

type MyScriptMathCanvasProps = {
  gradeLabel?: string
}

const missingKeyMessage = 'Missing MyScript credentials. Set NEXT_PUBLIC_MYSCRIPT_APPLICATION_KEY and NEXT_PUBLIC_MYSCRIPT_HMAC_KEY.'

export default function MyScriptMathCanvas({ gradeLabel }: MyScriptMathCanvasProps) {
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const editorInstanceRef = useRef<any>(null)
  const [status, setStatus] = useState<CanvasStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [latexOutput, setLatexOutput] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [canClear, setCanClear] = useState(false)
  const [isConverting, setIsConverting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const host = editorHostRef.current

    if (!host) {
      return
    }

    const appKey = process.env.NEXT_PUBLIC_MYSCRIPT_APPLICATION_KEY
    const hmacKey = process.env.NEXT_PUBLIC_MYSCRIPT_HMAC_KEY
    const scheme = process.env.NEXT_PUBLIC_MYSCRIPT_SERVER_SCHEME || 'https'
    const websocketHost = process.env.NEXT_PUBLIC_MYSCRIPT_SERVER_HOST || 'cloud.myscript.com'

    if (!appKey || !hmacKey) {
      setStatus('error')
      setError(missingKeyMessage)
      return
    }

    setStatus('loading')
    setError(null)

    let resizeHandler: (() => void) | null = null
    const listeners: Array<{ type: string; handler: (event: any) => void }> = []

    loadIinkRuntime()
      .then(async () => {
        if (cancelled) return
        
        console.log('MyScript runtime loaded, window.iink:', window.iink)
        
        if (!window.iink?.Editor?.load) {
          throw new Error('MyScript iink runtime did not expose the expected API.')
        }

        const options = {
          configuration: {
            server: {
              scheme,
              host: websocketHost,
              applicationKey: appKey,
              hmacKey,
            },
            recognition: {
              type: 'MATH',
              math: {
                mimeTypes: ['application/x-latex', 'application/vnd.myscript.jiix'],
                solver: {
                  enable: true,
                },
              },
            },
          },
        }

        console.log('Loading MyScript editor with options:', options)
        
        const editor = await window.iink.Editor.load(host, 'INTERACTIVEINKSSR', options)
        
        console.log('MyScript editor loaded:', editor)
        
        if (cancelled) {
          editor.destroy?.()
          return
        }

        editorInstanceRef.current = editor
        setStatus('ready')

        const handleChanged = (evt: any) => {
          setCanUndo(Boolean(evt.detail?.canUndo))
          setCanRedo(Boolean(evt.detail?.canRedo))
          setCanClear(Boolean(evt.detail?.canClear))
        }
        const handleExported = (evt: any) => {
          const exports = evt.detail || {}
          const latex = exports['application/x-latex'] || ''
          setLatexOutput(typeof latex === 'string' ? latex : '')
          setIsConverting(false)
        }
        const handleError = (evt: any) => {
          const message = evt?.detail?.message || evt?.message || 'Unknown error from MyScript editor.'
          setError(message)
          setStatus('error')
        }

        listeners.push({ type: 'changed', handler: handleChanged })
        listeners.push({ type: 'exported', handler: handleExported })
        listeners.push({ type: 'error', handler: handleError })

        listeners.forEach(({ type, handler }) => {
          editor.event.addEventListener(type, handler)
        })

        resizeHandler = () => {
          editor.resize()
        }
        window.addEventListener('resize', resizeHandler)
      })
      .catch(err => {
        if (cancelled) return
        console.error('MyScript initialization failed', err)
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })

    return () => {
      cancelled = true
      listeners.forEach(({ type, handler }) => {
        try {
          editorInstanceRef.current?.event?.removeEventListener(type, handler)
        } catch (err) {
          // ignore during teardown
        }
      })
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
      }
      if (editorInstanceRef.current) {
        try {
          editorInstanceRef.current.destroy?.()
        } catch (err) {
          // ignore during teardown
        }
        editorInstanceRef.current = null
      }
    }
  }, [])

  const handleClear = () => {
    if (!editorInstanceRef.current) return
    editorInstanceRef.current.clear()
    setLatexOutput('')
  }

  const handleUndo = () => {
    if (!editorInstanceRef.current) return
    editorInstanceRef.current.undo()
  }

  const handleRedo = () => {
    if (!editorInstanceRef.current) return
    editorInstanceRef.current.redo()
  }

  const handleConvert = () => {
    if (!editorInstanceRef.current) return
    setIsConverting(true)
    editorInstanceRef.current.convert()
  }

  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className="border rounded bg-white relative overflow-hidden">
          <div ref={editorHostRef} className="w-full h-[24rem]" style={{ minHeight: '384px' }} />
          {(status === 'loading' || status === 'idle') && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-white/70">
              Preparing collaborative canvas…
            </div>
          )}
          {status === 'error' && error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 bg-white/80 text-center px-4">
              {error}
            </div>
          )}
          {status === 'ready' && (
            <div className="absolute top-2 right-2 text-xs text-green-600 bg-white/80 px-2 py-1 rounded">
              Ready
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={handleUndo} disabled={!canUndo || status !== 'ready'}>
            Undo
          </button>
          <button className="btn" type="button" onClick={handleRedo} disabled={!canRedo || status !== 'ready'}>
            Redo
          </button>
          <button className="btn" type="button" onClick={handleClear} disabled={!canClear || status !== 'ready'}>
            Clear
          </button>
          <button className="btn btn-primary" type="button" onClick={handleConvert} disabled={status !== 'ready'}>
            {isConverting ? 'Converting…' : 'Convert to LaTeX'}
          </button>
        </div>

        {gradeLabel && (
          <p className="text-xs muted">Canvas is scoped to the {gradeLabel} cohort.</p>
        )}

        {latexOutput && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500 mb-1">Latest LaTeX export</p>
            <pre className="text-sm bg-slate-100 border rounded p-3 overflow-auto whitespace-pre-wrap">{latexOutput}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
