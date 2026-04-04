import dynamic from 'next/dynamic'
import type { CSSProperties, PointerEventHandler, ReactElement } from 'react'

const Excalidraw = dynamic(() => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw), { ssr: false })

type LessonStyledExcalidrawProps = {
  className?: string
  style?: CSSProperties
  hideMainMenu?: boolean
  topToolbarOffsetY?: number
  bottomToolbarOffsetY?: number
  onPointerDownCapture?: PointerEventHandler<HTMLDivElement>
  onPointerMoveCapture?: PointerEventHandler<HTMLDivElement>
  onPointerUpCapture?: PointerEventHandler<HTMLDivElement>
  onPointerCancelCapture?: PointerEventHandler<HTMLDivElement>
  excalidrawAPI?: (api: any) => void
  initialData?: any
  onChange?: (elements: any[], appState: any, files: any) => void
  zenModeEnabled?: boolean
  viewModeEnabled?: boolean
  gridModeEnabled?: boolean
  UIOptions?: any
  renderTopRightUI?: (...args: any[]) => ReactElement | null
}

export default function LessonStyledExcalidraw({
  className = '',
  style,
  hideMainMenu = false,
  topToolbarOffsetY = 0,
  bottomToolbarOffsetY = 0,
  onPointerDownCapture,
  onPointerMoveCapture,
  onPointerUpCapture,
  onPointerCancelCapture,
  excalidrawAPI,
  initialData,
  onChange,
  zenModeEnabled = false,
  viewModeEnabled = false,
  gridModeEnabled = false,
  UIOptions,
  renderTopRightUI,
}: LessonStyledExcalidrawProps) {
  const topRightUiRenderer = renderTopRightUI as any

  return (
    <div
      className={`relative h-full w-full philani-excalidraw-bottom-toolbar ${hideMainMenu ? 'philani-excalidraw-hide-main-menu' : ''} ${className}`.trim()}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={onPointerCancelCapture}
      style={{
        ['--philani-exc-top-y' as any]: `${topToolbarOffsetY}px`,
        ['--philani-exc-bottom-y' as any]: `${bottomToolbarOffsetY}px`,
        touchAction: 'none',
        ...style,
      }}
    >
      <Excalidraw
        excalidrawAPI={excalidrawAPI}
        initialData={initialData}
        onChange={onChange}
        zenModeEnabled={zenModeEnabled}
        viewModeEnabled={viewModeEnabled}
        gridModeEnabled={gridModeEnabled}
        UIOptions={UIOptions}
        renderTopRightUI={topRightUiRenderer}
      />
    </div>
  )
}